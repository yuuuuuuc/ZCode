import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import {
  countByKey,
  createRepoRootStripper,
  findAbsolutePathLeaks,
  keyOf,
  normalizeMessage,
  parseDiagnostics,
  REPO_ROOT_PLACEHOLDER,
} from "../lib/desktop-main-type-baseline.mjs";

/**
 * 这些用例锁的是「基线跨机器稳定」这一条：换机器、改仓库目录名后，
 * 同一条存量错误必须归一化成同一个键，否则棘轮会把存量误报成新增。
 */

/** 同一个诊断在不同机器上的仓库根（长度刻意不同）。 */
const SHORT_ROOT = "D:/a/ZCode";
const NORMAL_ROOT = "D:/2_WorkProject/k-code/ZCode";
const LONG_ROOT = "D:/2_WorkProject-with-a-long-name/k-code/ZCode";

/** TS6059 会把 rootDir 的绝对路径原样打进消息。 */
function ts6059Message(root) {
  return (
    `File '${root}/packages/desktop/src/main/desktopCronScheduler.ts' is not under ` +
    `'rootDir' '${root}/packages/desktop/src/main'. 'rootDir' is expected to contain all source files.`
  );
}

function normalizeWith(root, message) {
  return normalizeMessage(message, createRepoRootStripper(root));
}

test("仓库根路径被替换成占位符，而不是原样冻进基线", () => {
  const normalized = normalizeWith(NORMAL_ROOT, ts6059Message(NORMAL_ROOT));

  expect(normalized).not.toContain(NORMAL_ROOT);
  expect(normalized).toContain(`${REPO_ROOT_PLACEHOLDER}/packages/desktop/src/main`);
});

test("同一条错误在不同仓库根下归一化成同一个键（长度差异不改变结果）", () => {
  // 旧实现只在**长于 60 字符的引号片段**上做 'X' 替换，rootDir 片段会随仓库根长短
  // 在「保留原文」和 'X' 之间横跳：LONG_ROOT 的片段 66 字符、NORMAL_ROOT 的 55 字符。
  const keys = [SHORT_ROOT, NORMAL_ROOT, LONG_ROOT].map((root) => {
    const [diagnostic] = parseDiagnostics(
      `packages/desktop/src/main/desktopCronScheduler.ts(1,1): error TS6059: ${ts6059Message(root)}`,
      createRepoRootStripper(root),
    );
    return keyOf(diagnostic);
  });

  expect(new Set(keys).size).toBe(1);
});

test("Windows 上盘符与目录大小写不同也算同一个仓库根", () => {
  const strip = createRepoRootStripper(NORMAL_ROOT, { caseInsensitive: true });

  expect(strip("d:/2_workproject/k-code/zcode/packages/desktop/src/main")).toBe(
    `${REPO_ROOT_PLACEHOLDER}/packages/desktop/src/main`,
  );
});

test("POSIX 上路径大小写敏感，不同大小写的不算仓库根", () => {
  const strip = createRepoRootStripper("/home/dev/ZCode", { caseInsensitive: false });

  expect(strip("/home/dev/zcode/packages/desktop/src/main")).toBe(
    "/home/dev/zcode/packages/desktop/src/main",
  );
});

test("反斜杠写法的仓库根同样被替换", () => {
  const strip = createRepoRootStripper("D:\\2_WorkProject\\k-code\\ZCode");

  expect(strip("D:\\2_WorkProject\\k-code\\ZCode\\packages\\desktop\\src\\main")).toBe(
    `${REPO_ROOT_PLACEHOLDER}\\packages\\desktop\\src\\main`,
  );
});

test("同前缀的兄弟目录不被误伤", () => {
  const strip = createRepoRootStripper("D:/2_WorkProject/k-code/ZCode");

  expect(strip("D:/2_WorkProject/k-code/ZCode2/packages/desktop/src/main")).toBe(
    "D:/2_WorkProject/k-code/ZCode2/packages/desktop/src/main",
  );
});

test("多行诊断只取首行，且 file 用正斜杠", () => {
  const diagnostics = parseDiagnostics(
    [
      `packages/desktop/src/main/desktopCronScheduler.ts(1,1): error TS2345: Argument of type 'X' is not`,
      "  assignable to parameter of type 'Y'.",
    ].join("\n"),
    createRepoRootStripper(NORMAL_ROOT),
  );

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].file).toBe("packages/desktop/src/main/desktopCronScheduler.ts");
  expect(diagnostics[0].message).toBe("Argument of type 'X' is not");
});

test("同一个键出现多次按条数累加", () => {
  const output = [
    `packages/desktop/src/main/a.ts(1,1): error TS2345: Argument of type 'X' is not assignable.`,
    `packages/desktop/src/main/a.ts(9,9): error TS2345: Argument of type 'X' is not assignable.`,
  ].join("\n");

  const counts = countByKey(parseDiagnostics(output, createRepoRootStripper(NORMAL_ROOT)));

  expect([...counts.values()]).toEqual([2]);
});

test("残留检测能认出漏掉的盘符路径（不能拿 stripper 自证）", () => {
  // 旧写法用 `stripRepoRoot(key) !== key` 判断残留：stripper 漏掉大小写变体时，
  // 它对这个键同样不匹配，于是漏报。检测必须独立于 stripper。
  const leaky = createRepoRootStripper(NORMAL_ROOT, { caseInsensitive: false });
  const [diagnostic] = parseDiagnostics(
    `packages/desktop/src/main/a.ts(1,1): error TS6059: ${ts6059Message("d:/2_workproject/k-code/zcode")}`,
    leaky,
  );

  expect(findAbsolutePathLeaks([keyOf(diagnostic)])).toHaveLength(1);
  expect(findAbsolutePathLeaks([keyOf(diagnostic)])[0]).toContain("d:/2_workproject");
});

test("正常归一化后的键不会被误判为残留", () => {
  const [diagnostic] = parseDiagnostics(
    `packages/desktop/src/main/a.ts(1,1): error TS6059: ${ts6059Message(NORMAL_ROOT)}`,
    createRepoRootStripper(NORMAL_ROOT),
  );

  expect(findAbsolutePathLeaks([keyOf(diagnostic)])).toEqual([]);
});

test("提交的基线里不含机器绝对路径", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("../../.desktop-main-type-baseline.json", import.meta.url), "utf8"),
  );
  const driveLetter = /[A-Za-z]:[\\/]/u;
  const offenders = baseline.errors.filter(
    (entry) => driveLetter.test(entry.message) || driveLetter.test(entry.file) || entry.file.startsWith("/"),
  );

  expect(offenders).toEqual([]);
});
