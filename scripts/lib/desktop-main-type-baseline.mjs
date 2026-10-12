/**
 * `scripts/check-desktop-main-type-baseline.mjs` 的纯函数部分：诊断解析与消息归一化。
 *
 * 单独成模块是为了让归一化规则能被单测直接覆盖
 * （`scripts/test/desktop-main-type-baseline.test.mjs`）——它决定了基线能否跨机器稳定。
 * 本文件不得有副作用，脚本的 tsc 调用与基线读写留在 CLI 里。
 */

/** 超过这个长度的引号片段视为「类型渲染」，归一化掉。 */
export const TYPE_RENDER_QUOTE_LENGTH = 60;
const TYPE_RENDER_QUOTE = new RegExp(`'[^']{${TYPE_RENDER_QUOTE_LENGTH},}'`, "gu");

/** 字符串字面量联合：`"a" | "b"`。tsc 会随无关改动重排短联合的打印顺序。 */
const STRING_LITERAL_UNION = /'((?:"[^"]*" \| )+"[^"]*")'/gu;

/** tsc 打印的绝对路径里，仓库根被替换成的占位符；跨机器、跨仓库目录名稳定。 */
export const REPO_ROOT_PLACEHOLDER = "<repo>";

/** 诊断首行：`<file>(<line>,<column>): error <code>: <message>`。 */
export const DIAGNOSTIC_LINE =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u;

/** 路径后不能紧跟这些字符，否则匹配到的是同前缀的兄弟目录（`…/ZCode2`）。 */
const PATH_CONTINUATION = "(?![A-Za-z0-9_])";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 生成「把仓库根绝对路径替换成 `<repo>`」的函数。
 *
 * 为什么需要：TS6059 / TS6307 这类诊断会把 rootDir、project 的**绝对路径**打进消息里。
 * 这些路径短于 `TYPE_RENDER_QUOTE_LENGTH`，不触发 `'X'` 归一化，于是被原样冻结进基线；
 * 换机器或改仓库目录名后同一条存量错误的消息文本漂移，棘轮就把存量误判成「新增」。
 *
 * 必须在长度归一化**之前**执行：否则同一条路径会因各机器上长度不同，分别落到「保留」
 * 和 `'X'` 两侧，仍然不稳定。
 *
 * @param {string} repoRoot 仓库根绝对路径。
 * @param {{caseInsensitive?: boolean}} [options] Windows 路径大小写不敏感（盘符大小写
 *   可能与 Node 解析出的不同），默认按平台判断。
 */
export function createRepoRootStripper(repoRoot, { caseInsensitive = process.platform === "win32" } = {}) {
  // tsc 在 Windows 上打印正斜杠，但别的来源可能给反斜杠，两种写法都要覆盖。
  const variants = [...new Set([repoRoot.replaceAll("\\", "/"), repoRoot.replaceAll("/", "\\")])]
    .filter((variant) => variant.length > 0)
    .map((variant) => `${escapeRegExp(variant)}${PATH_CONTINUATION}`);
  if (variants.length === 0) return (text) => text;

  const pattern = new RegExp(variants.join("|"), caseInsensitive ? "giu" : "gu");
  return (text) => text.replace(pattern, REPO_ROOT_PLACEHOLDER);
}

/** 归一化诊断消息：只留首行，抹掉仓库绝对路径与长引号片段，短字面量联合按字母序冻结。 */
export function normalizeMessage(message, stripRepoRoot) {
  const firstLine = message.split("\n")[0] ?? "";
  return stripRepoRoot(firstLine)
    .replace(TYPE_RENDER_QUOTE, "'X'")
    .replace(STRING_LITERAL_UNION, (_full, inner) => `'${inner.split(" | ").sort().join(" | ")}'`)
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * 解析 `tsc --pretty false` 输出。诊断可能跨多行（嵌套类型渲染），
 * 只有匹配 DIAGNOSTIC_LINE 的行才是新诊断的起点，其余行归入上一条并被丢弃。
 */
export function parseDiagnostics(output, stripRepoRoot) {
  const diagnostics = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const match = DIAGNOSTIC_LINE.exec(rawLine);
    if (!match?.groups) continue;
    diagnostics.push({
      file: stripRepoRoot(match.groups.file).replaceAll("\\", "/"),
      code: match.groups.code,
      message: normalizeMessage(match.groups.message, stripRepoRoot),
    });
  }
  return diagnostics;
}

/** 错误键 = (文件, TS 错误码, 规范化后的首行消息)。 */
export function keyOf(diagnostic) {
  return `${diagnostic.file}\u0000${diagnostic.code}\u0000${diagnostic.message}`;
}

/** @returns {Map<string, number>} 错误键 -> 条数 */
export function countByKey(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    const key = keyOf(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 与机器无关的绝对路径特征：Windows 盘符（`D:/`、`D:\`）。 */
const WINDOWS_ABSOLUTE_PATH = /[A-Za-z]:[\\/]/u;

/**
 * 找出归一化后仍残留绝对路径的错误键。
 *
 * 判据必须独立于 `createRepoRootStripper`：拿 stripper 自己去测自己的残留是自证循环——
 * 漏掉大小写/分隔符变体时两边一起漏，永远测不出来。所以这里只认「盘符 + 分隔符」这个
 * 与机器无关的特征；POSIX 的仓库根没有等价特征，改由单测覆盖。
 */
export function findAbsolutePathLeaks(keys) {
  return [...keys].filter((key) => WINDOWS_ABSOLUTE_PATH.test(key));
}
