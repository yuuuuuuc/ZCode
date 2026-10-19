// ============================================================
// Web Tools Port - 搜索后端的外部 I/O 边界
// ============================================================
// 存在的理由：`WebSearch` 目前只能靠 provider-native 的模型请求实现，非 Anthropic 兼容
// 端点直接不可用，且每次搜索都要付一次模型 token。DeepSeek 的 Search REST 接口按请求
// 计费、零模型 token、对任意模型可用，core 却看不见 provider 注册表也拿不到 Key。
//
// 端口只暴露「能不能用」和「搜一次」，Key、origin、限流与重试全部留在 adapter。
// 本轮只有 `search()`：WebFetch 的回退后端尚未实施，不在这里预留无实现的方法。

import type { TraceContext } from "../tracing/tracer.js";

/**
 * 后端可用性快照。**每次调用现问**，不缓存——用户中途增删 Key 之后，下一个 tool call
 * 必须立即看到新事实（与 ModelCatalogPort 的 stale registry 纪律同源）。
 */
export interface WebToolsBackendStatus {
  available: boolean;
  /**
   * 当前出网点（如 `https://api.deepseek.com`），仅在 `available` 时在场。
   *
   * 只用于网络状态事件与诊断：handler 拿它拼出真实请求 URL 上报，UI 才不会把这次搜索
   * 误以为是直连目标站点。**不得**包含任何凭据。
   */
  origin?: string;
}

export interface WebSearchToolRequest {
  query: string;
  /** 期望结果条数；缺席由 adapter 决定默认值。 */
  count?: number;
}

/**
 * 后端返回的单条结果。
 *
 * 注意这里是 **adapter 侧的原始结果**，比 `WebSearchResultItem` 宽：`summary` / `date` /
 * `authority` 只允许进模型可见文本，不得写入结构化 tool output（`WebSearchOutput` 的
 * strict schema 不接受未声明字段）。
 */
export interface WebSearchToolResult {
  url: string;
  title?: string;
  summary?: string;
  date?: string;
  siteName?: string;
  authority?: number;
}

export type WebToolsErrorCode =
  | "not_configured"
  | "unauthorized"
  | "insufficient_balance"
  | "blocked_by_policy"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "upstream_error"
  | "network_error";

/** 稳定错误码，供 handler 映射成模型可执行的提示；判断依据绝不放文本。 */
export class WebToolsPortError extends Error {
  readonly code: WebToolsErrorCode;
  /** 下游 HTTP 状态码；本地失败（超时、网络）时缺席。 */
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(details: {
    code: WebToolsErrorCode;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super(details.message);
    this.name = "WebToolsPortError";
    this.code = details.code;
    this.status = details.status;
    this.cause = details.cause;
  }
}

export function isWebToolsPortError(error: unknown): error is WebToolsPortError {
  return error instanceof WebToolsPortError;
}

export interface WebToolsSearchOptions {
  signal?: AbortSignal;
  trace?: TraceContext;
}

export interface WebToolsPort {
  /** 每次调用现读宿主事实；返回 `{ available: false }` 表示本轮没有可用后端。 */
  status(): WebToolsBackendStatus;
  /**
   * 执行一次搜索。失败一律抛 {@link WebToolsPortError}，由调用方决定如何呈现；
   * adapter 内部只对 429 做一次退避重试，不做静默降级。
   */
  search(request: WebSearchToolRequest, options?: WebToolsSearchOptions): Promise<WebSearchToolResult[]>;
}
