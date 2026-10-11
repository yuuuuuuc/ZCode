#!/usr/bin/env node
/**
 * desktop host/main 孤儿模块扫描 —— 抓「接线被删、模块还在」这类漏接线。
 *
 * 背景：开源化改造重写装配时，多次出现「模块完好但没有任何地方 import 它」的情况
 * （gen-ui 沙箱登记桥、hostNetworkCapture、WRC 回调），静态类型检查抓不到，
 * 只能靠运行时或人工比对。本脚本把这类文件变成可自动发现的信号。
 *
 * 判定：对 packages/desktop/src/{host,main} 下每个 git 跟踪的 .ts（排除 .test.ts），
 * 在 packages/** 与 apps/** 里找 `/<basename>.js"` 或 `/<basename>.js'` 形式的相对 import。
 * 一处都没有 = 孤儿。
 *
 * 已知误报：声明式清单（任何名为 module.ts 的文件，由架构治理按路径发现，
 * 故意不被 import）——直接按路径排除，不进基线。
 *
 * 基线：`.desktop-orphan-modules-baseline.json` 记录「已确认、暂时接受」的孤儿，
 * 只拒绝**新增**孤儿。基线每条必须带 reason —— 没有原因的豁免会让这份清单退化成
 * 永久垃圾场，所以缺 reason 直接判失败。
 *
 * 用法：
 *   node scripts/check-desktop-orphan-modules.mjs            # 检查，有新孤儿则退出码 1
 *   node scripts/check-desktop-orphan-modules.mjs --update   # 用当前结果重写基线
 *
 * 退出码：0 通过；1 有新增孤儿或基线缺 reason；2 参数/环境错误
 */
import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(repoRoot, ".desktop-orphan-modules-baseline.json");
const SCAN_ROOTS = ["packages/desktop/src/host", "packages/desktop/src/main"];
/** 声明式清单：按路径被架构治理发现，故意不被 import。 */
const DECLARATIVE_MANIFEST = /(^|\/)module\.ts$/u;

const args = process.argv.slice(2);
const update = args.includes("--update");
const unknown = args.filter((arg) => arg !== "--update");
if (unknown.length > 0) {
  console.error(`[orphan-scan] 未知参数：${unknown.join(" ")}`);
  process.exit(2);
}

async function git(gitArgs, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFile("git", gitArgs, {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (allowFailure && error.code === 1) return "";
    throw error;
  }
}

/** git 跟踪的扫描目标文件（相对仓库根、正斜杠）。 */
async function listScannedFiles() {
  const stdout = await git(["ls-files", "-z", "--", ...SCAN_ROOTS]);
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .filter((path) => !DECLARATIVE_MANIFEST.test(path))
    // 索引里可能还有「工作树已删除但尚未提交」的路径（未暂存的删除）；那些不是模块。
    .filter((path) => existsSync(join(repoRoot, path)))
    .sort();
}

/**
 * 全仓被 import 的 `.js` 说明符的 basename 集合。
 * 只看路径形式的 import（`./x.js` / `../x.js` / `@zcode/pkg/x.js`）：跨包公开入口
 * 不在此列，也不会出现「模块在、接线没了」。一次 git grep 收完，避免逐文件起进程。
 */
async function collectImportedBasenames() {
  const stdout = await git(
    ["grep", "-h", "-o", "-E", "['\"][^'\"]*\\.js['\"]", "--", "packages", "apps"],
    { allowFailure: true },
  );
  const names = new Set();
  for (const line of stdout.split("\n")) {
    const specifier = line.slice(1, -1);
    if (!specifier) continue;
    const basename = specifier.slice(specifier.lastIndexOf("/") + 1, -".js".length);
    if (basename) names.add(basename);
  }
  return names;
}

async function findOrphans() {
  const files = await listScannedFiles();
  const imported = await collectImportedBasenames();
  return files.filter((file) => {
    const basename = file.slice(file.lastIndexOf("/") + 1, -".ts".length);
    return !imported.has(basename);
  });
}

/** 读取基线，返回 path -> reason 的 Map。 */
function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    if (!Array.isArray(parsed.orphans)) throw new Error("orphans 不是数组");
    const entries = parsed.orphans.map((entry) => {
      if (typeof entry === "string") return [entry, ""];
      return [entry.path, entry.reason ?? ""];
    });
    return new Map(entries);
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    console.error(`[orphan-scan] 基线文件无法解析：${BASELINE_PATH}`);
    console.error(`  ${error.message}`);
    process.exit(2);
  }
}

/** 保留已有条目的 reason；新增条目留空，由人补写后才会通过。 */
function writeBaseline(orphans, existing) {
  const payload = {
    version: 1,
    // 判定规则：见 scripts/check-desktop-orphan-modules.mjs 头部说明。
    // 每条必须有 reason，否则会变成永久垃圾场（缺 reason 直接判失败）。
    orphans: orphans.map((path) => ({ path, reason: existing.get(path) ?? "" })),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

const orphans = await findOrphans();
const baseline = readBaseline();

if (update) {
  writeBaseline(orphans, baseline);
  console.log(
    `[orphan-scan] 基线已更新：${relative(repoRoot, BASELINE_PATH)}（${orphans.length} 项）`,
  );
  for (const orphan of orphans) {
    const reason = baseline.get(orphan);
    console.log(`  - ${orphan}${reason ? `  # ${reason}` : "  # 缺 reason，请补写"}`);
  }
  process.exit(0);
}

const newOrphans = orphans.filter((orphan) => !baseline.has(orphan));
const resolved = [...baseline.keys()].filter((orphan) => !orphans.includes(orphan));
const unexplained = [...baseline.keys()].filter((orphan) => !baseline.get(orphan));

if (unexplained.length > 0) {
  console.error("[orphan-scan] 基线里有条目没写 reason：\n");
  for (const orphan of unexplained) console.error(`  ✗ ${orphan}`);
  console.error(
    `\n请在 ${relative(repoRoot, BASELINE_PATH)} 里补上原因（为什么这个文件故意不被 import）。`,
  );
  process.exit(1);
}

if (newOrphans.length > 0) {
  console.error("[orphan-scan] 发现新增孤儿模块（零相对引用）：\n");
  for (const orphan of newOrphans) console.error(`  ✗ ${orphan}`);
  console.error(
    "\n这些文件没有任何 `/<name>.js` 形式的相对 import，通常是「接线被删、模块还在」。\n" +
      "请接线到调用点；若确认是故意不被 import 的（如声明式清单），加进 " +
      `${relative(repoRoot, BASELINE_PATH)} 并写明原因。`,
  );
  process.exit(1);
}

if (resolved.length > 0) {
  console.log(
    `[orphan-scan] 基线中有 ${resolved.length} 项已不再孤儿，可从基线移除：` +
      resolved.map((path) => `\n  - ${path}`).join(""),
  );
}

console.log(
  `[orphan-scan] 通过：扫描 ${SCAN_ROOTS.join(" / ")}，孤儿 ${orphans.length} 项（均在基线内）`,
);
