#!/usr/bin/env node
/**
 * desktop main 工程的类型棘轮。
 *
 * 背景：`pnpm typecheck` 只跑 `packages/desktop/tsconfig.host.json`，**不含
 * `packages/desktop/tsconfig.main.json`**。main 里有大量存量错误，于是 main 的改动
 * （漏传必填回调、漏 import 等）不会被类型门禁拦住 —— 3.15.5 的 WRC 崩溃就是这么漏到运行时的。
 *
 * 做法：不必先清存量。把当前错误冻结进基线，只拒绝**新增**：
 *   - 出现基线里没有的错误键 → 失败
 *   - 同一键的条数比基线多 → 失败
 *   - 基线里有、现在没有的键 → 提示（可从基线移除）
 *
 * 错误键 = (文件, TS 错误码, 规范化后的首行消息)。
 * 规范化会忽略行列号，并把**长于 60 字符的引号片段**替换成 `'X'`：tsc 打印的
 * union/object 类型渲染会随无关的窄化变化（实测同一处错误在加一个 if 分支前后
 * 渲染成不同文本），不归一化会让门禁在每次无关改动后误报。短的字符串字面量联合
 * （`"active" | "handoff"` 这种）也会被重排，按字母序再冻一次。
 *
 * 规范化还会把**仓库根绝对路径**替换成 `<repo>`：TS6059/TS6307 会把 rootDir、project
 * 的绝对路径打进消息，短路径不触发 `'X'` 替换，会被原样冻进基线，换机器或改仓库目录名
 * 就漂移。规则与单测见 `scripts/lib/desktop-main-type-baseline.mjs`。
 *
 * 用法：
 *   node scripts/check-desktop-main-type-baseline.mjs            # 检查
 *   node scripts/check-desktop-main-type-baseline.mjs --update   # 用当前错误重写基线
 *
 * 退出码：0 通过；1 有新增/增加；2 环境错误
 */
import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  countByKey,
  createRepoRootStripper,
  findAbsolutePathLeaks,
  keyOf,
  parseDiagnostics,
} from "./lib/desktop-main-type-baseline.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const TSC_PATH = require.resolve("typescript/bin/tsc");
const TSCONFIG = "packages/desktop/tsconfig.main.json";
const BASELINE_PATH = join(repoRoot, ".desktop-main-type-baseline.json");
const stripRepoRoot = createRepoRootStripper(repoRoot);

const args = process.argv.slice(2);
const update = args.includes("--update");
const unknown = args.filter((arg) => arg !== "--update");
if (unknown.length > 0) {
  console.error(`[main-types] 未知参数：${unknown.join(" ")}`);
  process.exit(2);
}

async function runTsc() {
  try {
    const { stdout } = await execFile(
      process.execPath,
      [TSC_PATH, "-p", TSCONFIG, "--noEmit", "--pretty", "false"],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch (error) {
    // tsc 有诊断时以非零码退出，诊断在 stdout。
    if (typeof error.stdout === "string") return error.stdout;
    console.error(`[main-types] 无法运行 tsc：${error.message}`);
    process.exit(2);
  }
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    if (!Array.isArray(parsed.errors)) throw new Error("errors 不是数组");
    return new Map(parsed.errors.map((entry) => [keyOf(entry), entry.count]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    console.error(`[main-types] 基线文件无法解析：${BASELINE_PATH}`);
    console.error(`  ${error.message}`);
    process.exit(2);
  }
}

function writeBaseline(counts) {
  const errors = [...counts.entries()]
    .map(([key, count]) => {
      const [file, code, message] = key.split("\u0000");
      return { file, code, message, count };
    })
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        // 这是存量错误的冻结基线，不是「允许新增」的名单。只允许随修复减少。
        // 重新生成：node scripts/check-desktop-main-type-baseline.mjs --update
        note: "packages/desktop/tsconfig.main.json 的存量类型错误基线；门禁只拒绝新增。",
        errors,
      },
      null,
      2,
    )}\n`,
  );
}

const current = countByKey(parseDiagnostics(await runTsc(), stripRepoRoot));

/**
 * 归一化后仍残留绝对路径，说明 stripRepoRoot 漏了某种写法，基线会随机器漂移。
 * 这时既不能检查也不能 --update：前者会把存量误报成「新增」，后者会把绝对路径写进基线、
 * 把漂移固化下来——正是本归一化要消灭的那种基线。
 */
function assertNoAbsolutePathLeak(counts) {
  const leaked = findAbsolutePathLeaks(counts.keys());
  if (leaked.length === 0) return;
  console.error(`[main-types] 归一化漏掉了绝对路径，基线会随机器漂移（${leaked.length} 个键）：`);
  for (const key of leaked.slice(0, 5)) console.error(`  ${describe(key)}`);
  console.error(
    "  请修 `createRepoRootStripper`（scripts/lib/desktop-main-type-baseline.mjs）" +
      "覆盖的分隔符与大小写变体，不要用 --update 绕过。",
  );
  process.exit(2);
}

assertNoAbsolutePathLeak(current);

if (update) {
  writeBaseline(current);
  const total = [...current.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `[main-types] 基线已更新：${TSCONFIG}（${current.size} 个键 / ${total} 条错误）`,
  );
  process.exit(0);
}

const baseline = readBaseline();
const added = [];
const increased = [];
for (const [key, count] of current) {
  const known = baseline.get(key);
  if (known === undefined) added.push({ key, count });
  else if (count > known) increased.push({ key, count, known });
}
const resolved = [...baseline.keys()].filter((key) => !current.has(key));

function describe(key) {
  const [file, code, message] = key.split("\u0000");
  return `${file} :: ${code}: ${message}`;
}

if (added.length > 0 || increased.length > 0) {
  console.error(`[main-types] ${TSCONFIG} 出现新增类型错误：\n`);
  for (const { key, count } of added) {
    console.error(`  ✗ 新增（${count} 条） ${describe(key)}`);
  }
  for (const { key, count, known } of increased) {
    console.error(`  ✗ 增加（${known} → ${count} 条） ${describe(key)}`);
  }
  console.error(
    "\nmain 工程不在 `pnpm typecheck` 门禁里，所以这里单独拦一道。\n" +
      "请修掉新增错误；确认是刻意接受的存量变化时，用 " +
      "`node scripts/check-desktop-main-type-baseline.mjs --update` 重写基线并说明原因。",
  );
  process.exit(1);
}

if (resolved.length > 0) {
  console.log(
    `[main-types] 有 ${resolved.length} 个键已无对应错误，可从基线移除：` +
      resolved.map((key) => `\n  - ${describe(key)}`).join(""),
  );
}

const total = [...current.values()].reduce((sum, count) => sum + count, 0);
console.log(
  `[main-types] 通过：${TSCONFIG} 存量 ${current.size} 个键 / ${total} 条错误，无新增`,
);
