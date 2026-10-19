// ============================================================
// WebSearch 搜索后端的输入改写与结果投影
// ============================================================
// 这一层只做纯函数：把 public input 改写成后端查询、把后端结果过滤成契约内的形状。
// 网络与限流在 adapters/web-tools；这里不发请求，便于单测。

import type { WebSearchInput, WebSearchResultItem } from "@zcode/contracts";
import type { WebSearchToolResult } from "@zcode/contracts";

/**
 * 把 domain 过滤翻译成搜索语法。
 *
 * `site:` 只是给检索的**建议**，服务端不保证真的过滤（它可能返回别的域），所以
 * {@link filterResultsByDomain} 的后置过滤才是契约生效的地方，两者必须一起用。
 */
export function applyDomainConstraintsToQuery(input: WebSearchInput): string {
  const clauses: string[] = [];
  const allowed = input.allowed_domains?.filter(nonEmpty) ?? [];
  const blocked = input.blocked_domains?.filter(nonEmpty) ?? [];

  if (allowed.length > 0) {
    clauses.push(allowed.map((domain) => `site:${domain}`).join(" OR "));
  }
  for (const domain of blocked) {
    clauses.push(`-site:${domain}`);
  }

  return clauses.length === 0 ? input.query : `${input.query} ${clauses.join(" ")}`.trim();
}

/** 按 hostname 后置过滤：`site:` 语法不可信，这里才是契约的实际执行点。 */
export function filterResultsByDomain(
  results: readonly WebSearchToolResult[],
  input: WebSearchInput,
): WebSearchToolResult[] {
  const allowed = input.allowed_domains?.filter(nonEmpty) ?? [];
  const blocked = input.blocked_domains?.filter(nonEmpty) ?? [];
  if (allowed.length === 0 && blocked.length === 0) return [...results];

  return results.filter((result) => {
    const hostname = hostnameOf(result.url);
    if (!hostname) return false;
    if (allowed.length > 0 && !allowed.some((domain) => hostMatches(hostname, domain))) {
      return false;
    }
    return !blocked.some((domain) => hostMatches(hostname, domain));
  });
}

/** 结构化 output 只保留契约声明的字段；summary/date/authority 只进模型可见文本。 */
export function toWebSearchResultItems(
  results: readonly WebSearchToolResult[],
): WebSearchResultItem[] {
  const seen = new Set<string>();
  const items: WebSearchResultItem[] = [];
  for (const result of results) {
    const key = result.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(result.title === undefined ? { url: result.url } : { url: result.url, title: result.title });
  }
  return items;
}

/**
 * 模型可见的后端结果块。
 *
 * 后端给出的 `summary` / `date` / `authority` 是这次搜索的主要价值，但 strict schema 不接受
 * 未声明字段，所以它们只能落在这里（`WebSearchOutput.summary`）——经过 `formatModelContent`
 * 之后成为普通 tool result 文本。
 */
export function formatBackendResultsSummary(
  results: readonly WebSearchToolResult[],
): string | undefined {
  if (results.length === 0) return undefined;

  const blocks = results.map((result, index) => {
    const header = [result.title ?? result.url, formatMeta(result)].filter(nonEmpty).join(" — ");
    const lines = [`${index + 1}. ${header}`, `   ${result.url}`];
    const summary = result.summary?.trim();
    if (summary) lines.push(indent(summary));
    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

/** 后端结果为空时的可执行提示；这不是错误，模型应当换个 query 而不是重试同一句。 */
export function formatEmptyBackendResultsNotice(input: WebSearchInput): string {
  const constraints =
    input.allowed_domains?.length || input.blocked_domains?.length
      ? " — the domain filters may have excluded every result"
      : "";
  return `No results were found for the query${constraints}. Refine the query or loosen the domain filters.`;
}

function formatMeta(result: WebSearchToolResult): string {
  const parts: string[] = [];
  if (result.date) parts.push(result.date);
  if (result.siteName) parts.push(result.siteName);
  if (result.authority !== undefined) parts.push(`authority ${result.authority}`);
  return parts.join(", ");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `   ${line}`))
    .join("\n");
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** 精确匹配，或作为子域匹配（`example.com` 覆盖 `docs.example.com`）。 */
function hostMatches(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
