// ============================================================
// DeepSeek Web Tools Adapter
// ============================================================
// 契约见 contracts/src/interfaces/web-tools.port.ts；设计见
// docs/design/v2/tool/13-websearch.md「DeepSeek REST 后端」。
//
// 职责边界：
//   - 本文件是唯一知道 DeepSeek Search 端点、鉴权头、限流与错误码映射的地方。
//   - 凭据由宿主经窄函数注入（`credentials.resolve()`），adapter 不 import bootstrap，
//     也不 import `@zcode/provider`：`adapters` 不依赖 `bootstrap`。
//   - 网络一律走 `HttpClientPort`，复用代理、`noProxy`、自定义 CA 与 trace header。

import {
  WebToolsPortError,
  type HttpClientPort,
  type TraceContext,
  type WebSearchToolRequest,
  type WebSearchToolResult,
  type WebToolsBackendStatus,
  type WebToolsPort,
  type WebToolsSearchOptions,
} from "@zcode/contracts";

/** 单次搜索期望的结果条数；10 条 summary 约 6–8 KB，落在 WebSearch 的 20 KB 模型预算内。 */
const DEFAULT_RESULT_COUNT = 10;
const MAX_RESULT_COUNT = 50;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** 账号级 QPS 为 5（Search 与 Fetch 各自独立），令牌桶按此速率补充。 */
const RATE_LIMIT_PER_SECOND = 5;
/** 429 只做一次退避重试；仍失败上抛，绝不静默降级到 provider-native。 */
const RATE_LIMIT_RETRY_DELAY_MS = 200;

/**
 * 凭据来源。宿主每次 `resolve()` 都必须现读 Provider Registry 的活视图——
 * 用户中途增删 Key 之后，下一个 tool call 就要看到新事实。
 */
export interface WebToolsCredentialSource {
  /** 返回 `undefined` 表示当前没有可用的 DeepSeek 配置。 */
  resolve(): { apiKey: string; baseUrl: string } | undefined;
}

export interface DeepSeekWebToolsAdapterOptions {
  credentials: WebToolsCredentialSource;
  httpClientPort: HttpClientPort;
}

export function createDeepSeekWebToolsAdapter(
  options: DeepSeekWebToolsAdapterOptions,
): WebToolsPort {
  const limiter = createTokenBucket(RATE_LIMIT_PER_SECOND);

  return {
    status(): WebToolsBackendStatus {
      const credential = options.credentials.resolve();
      if (!credential) return { available: false };
      // origin 推导失败（baseUrl 不合法）时按不可用处理：与其让下游拿一个拼不出的 URL
      // 去发请求，不如让 handler 直接走既有路径。
      const origin = tryOrigin(credential.baseUrl);
      return origin === undefined ? { available: false } : { available: true, origin };
    },

    async search(
      request: WebSearchToolRequest,
      searchOptions: WebToolsSearchOptions = {},
    ): Promise<WebSearchToolResult[]> {
      const credential = options.credentials.resolve();
      if (!credential) {
        throw new WebToolsPortError({
          code: "not_configured",
          message: "DeepSeek web tools are not configured",
        });
      }
      const origin = tryOrigin(credential.baseUrl);
      if (origin === undefined) {
        throw new WebToolsPortError({
          code: "not_configured",
          message: "DeepSeek provider baseUrl is not a valid URL",
        });
      }

      const url = `${origin}/v1/tools/search`;
      const body = JSON.stringify({
        query: request.query,
        count: clampCount(request.count),
      });
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
      };

      await limiter.acquire(searchOptions.signal);
      let response = await postSearch({
        httpClientPort: options.httpClientPort,
        url,
        headers,
        body,
        signal: searchOptions.signal,
        trace: searchOptions.trace,
      });
      if (response.status === 429) {
        await sleep(RATE_LIMIT_RETRY_DELAY_MS, searchOptions.signal);
        await limiter.acquire(searchOptions.signal);
        response = await postSearch({
          httpClientPort: options.httpClientPort,
          url,
          headers,
          body,
          signal: searchOptions.signal,
          trace: searchOptions.trace,
        });
      }

      if (response.status < 200 || response.status >= 300) {
        throw statusToError(response.status);
      }

      return parseSearchResults(decodeBody(response.body));
    },
  };
}

function clampCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_RESULT_COUNT;
  return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.trunc(count)));
}

function tryOrigin(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

async function postSearch(input: {
  httpClientPort: HttpClientPort;
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  trace?: TraceContext;
}) {
  try {
    return await input.httpClientPort.request(
      {
        url: input.url,
        method: "POST",
        headers: input.headers,
        body: new TextEncoder().encode(input.body),
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        ...(input.trace === undefined ? {} : { trace: input.trace }),
      },
      input.signal === undefined ? {} : { signal: input.signal },
    );
  } catch (error) {
    throw transportToError(error);
  }
}

/** 传输层失败：Host 侧只给稳定 code，映射到端口错误码后上抛。 */
function transportToError(error: unknown): WebToolsPortError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (code === "cancelled") {
    // 取消不算后端失败：交给 handler 按 tool 取消语义处理。
    throw error;
  }
  if (code === "timeout") {
    return new WebToolsPortError({
      code: "timeout",
      message: "DeepSeek Search request timed out",
      cause: error,
    });
  }
  return new WebToolsPortError({
    code: "network_error",
    message: "DeepSeek Search request failed",
    cause: error,
  });
}

function statusToError(status: number): WebToolsPortError {
  const mapping: Record<number, { code: WebToolsPortError["code"]; message: string }> = {
    400: { code: "invalid_request", message: "DeepSeek Search rejected the request" },
    401: { code: "unauthorized", message: "DeepSeek API Key is invalid" },
    402: { code: "insufficient_balance", message: "DeepSeek account balance is insufficient" },
    403: { code: "blocked_by_policy", message: "DeepSeek Search was blocked by policy" },
    404: { code: "not_found", message: "DeepSeek Search endpoint was not found" },
    408: { code: "timeout", message: "DeepSeek Search request timed out" },
    413: { code: "invalid_request", message: "DeepSeek Search request was too large" },
    429: { code: "rate_limited", message: "DeepSeek Search rate limit exceeded" },
    504: { code: "timeout", message: "DeepSeek Search gateway timed out" },
  };
  const known = mapping[status];
  if (known) return new WebToolsPortError({ ...known, status });
  if (status >= 500) {
    return new WebToolsPortError({
      code: "upstream_error",
      message: "DeepSeek Search upstream error",
      status,
    });
  }
  return new WebToolsPortError({
    code: "upstream_error",
    message: `DeepSeek Search returned HTTP ${status}`,
    status,
  });
}

function decodeBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 严格解析响应。未知字段忽略；缺 `results` 视为空数组（服务端把无结果表达为 200 + 空）。
 * 只有能构成 `{ url }` 的条目才是结果——没有 URL 的条目对 WebSearch 的契约没有意义。
 */
function parseSearchResults(payload: unknown): WebSearchToolResult[] {
  if (!isRecord(payload)) return [];
  const results = payload.results;
  if (!Array.isArray(results)) return [];

  const parsed: WebSearchToolResult[] = [];
  for (const raw of results) {
    if (!isRecord(raw)) continue;
    const url = stringValue(raw.url);
    if (!url) continue;
    parsed.push({
      url,
      title: stringValue(raw.title),
      summary: stringValue(raw.summary),
      date: stringValue(raw.date),
      siteName: stringValue(raw.site_name),
      authority: numberValue(raw.authority),
    });
  }
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 进程内令牌桶。仓库里没有可复用的实现（`WorkflowLimiter` 只做并发，
 * `bash-gh-rate-limit` 是冷却），所以这里按 QPS 直接写一个最小版本：
 * 容量 = 每秒补充量，允许一次突发，之后按 200 ms 间隔放行。
 */
function createTokenBucket(tokensPerSecond: number): { acquire(signal?: AbortSignal): Promise<void> } {
  const capacity = tokensPerSecond;
  let tokens = capacity;
  let lastRefillMs = Date.now();

  return {
    async acquire(signal?: AbortSignal): Promise<void> {
      // 串行化等待者，避免并发调用同时读到同一份 tokens 后一起放行。
      while (true) {
        const now = Date.now();
        const elapsedSeconds = (now - lastRefillMs) / 1000;
        if (elapsedSeconds > 0) {
          tokens = Math.min(capacity, tokens + elapsedSeconds * tokensPerSecond);
          lastRefillMs = now;
        }
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        const waitMs = Math.ceil(((1 - tokens) / tokensPerSecond) * 1000);
        await sleep(waitMs, signal);
      }
    },
  };
}

async function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
