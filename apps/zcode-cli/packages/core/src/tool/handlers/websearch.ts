// ============================================================
// WebSearch Tool
// ============================================================

import {
  CoreErrorType,
  SessionEventType,
  WEBSEARCH_PROVIDER_NATIVE_SPEC,
  WEBSEARCH_TOOL_CONTRACT,
  WebSearchInputJsonSchema,
  WebSearchInputSchema,
  WebSearchOutputJsonSchema,
  WebSearchOutputSchema,
  createCoreError,
  isWebToolsPortError,
  runWithModelInvocationContext,
  toWebSearchProviderNativeArgs,
  type ModelStreamEvent,
  type ModelTextResult,
  type ModelToolCall,
  type ModelUsage,
  type ModelToolContract,
  type NetworkRequestStatusPayload,
  type WebSearchInput,
  type WebSearchOutput,
  type WebToolsErrorCode,
} from "@zcode/contracts";
import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";
import { auxiliaryModelOptions } from "../../model/auxiliary-model-options.js";
import {
  applyDomainConstraintsToQuery,
  filterResultsByDomain,
  formatBackendResultsSummary,
  formatEmptyBackendResultsNotice,
  toWebSearchResultItems,
} from "./websearch-backend.js";
import { buildWebSearchOutput, formatWebSearchModelContent } from "./websearch-results.js";
import { webSearchTraceFromContext } from "./websearch-support.js";

const WEBSEARCH_TOOL_NAME = "WebSearch";
const PROVIDER_WEBSEARCH_TOOL_NAME = "web_search";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_USES = 8;

const WEBSEARCH_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function buildWebSearchProviderDescription(now: Date = new Date()): string {
  const currentMonth = `${WEBSEARCH_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  return [
    "Search the web. Returns result blocks with titles and URLs.",
    "",
    `- The current month is ${currentMonth} — use this when searching for recent information.`,
    "- `allowed_domains` / `blocked_domains` filter results.",
    '- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.',
  ].join("\n");
}

const webSearchHandler: ToolHandler<WebSearchInput, WebSearchOutput> = async (input, context) => {
  const startedAt = Date.now();
  const backend = context.webToolsPort?.status();
  if (backend?.available) {
    return runBackendWebSearch(input, context, startedAt, backend.origin);
  }

  const model = context.model;

  if (!model) {
    throw createCoreError(CoreErrorType.ConfigurationError, "Model is required for WebSearch", {
      context: { toolCallId: context.toolCallId, toolName: WEBSEARCH_TOOL_NAME },
      recoverable: false,
    });
  }

  if (!model.properties.supportsNativeWebSearch) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "Current model does not support native WebSearch",
      {
        context: { toolCallId: context.toolCallId, toolName: WEBSEARCH_TOOL_NAME },
        recoverable: true,
      },
    );
  }

  const request: Parameters<typeof model.streamText>[0] = {
    messages: [
      {
        role: "system",
        content: "You are an assistant for performing a web search tool use.",
      },
      {
        role: "user",
        content: `Perform a web search for the query: ${input.query}`,
      },
    ],
    tools: [createProviderNativeWebSearchContract(input)],
    // BigModel 的 Anthropic 兼容端点会拒绝 named forced web_search tool_choice（1210）。
    // 这里保持自动选择，依靠单工具请求和 prompt 触发 provider-native 搜索。
    options: {
      ...auxiliaryModelOptions(model),
      maxOutputTokens: Math.min(4096, model.optionSpecs.maxOutputTokens.max),
    },
    abortSignal: context.abortSignal,
  };

  // BigModel Anthropic 兼容端点的非流式 JSON 会把 provider 内部
  // web_search 结果返回为 assistant-side 裸 tool_result，AI SDK 会在 schema
  // 校验阶段抛 Invalid JSON response。走流式可复用现有 SSE compat。
  const result = await collectWebSearchStreamResult({
    events: runWithModelInvocationContext(
      {
        metadata: {
          traceId: context.traceId,
          sessionId: context.sessionId,
          turnId: context.turnId,
          toolCallId: context.toolCallId,
          toolName: WEBSEARCH_TOOL_NAME,
          querySource: "web_search_tool",
        },
        modelCall: { operation: "web_search" },
        // statusSink 不在这里设：执行器交出的 context.model 已带默认会话事件出口。
        traceContext: webSearchTraceFromContext(context),
      },
      () => model.streamText(request),
    ),
  });

  return buildWebSearchOutput(input, result, startedAt);
};

export const webSearchToolEntry: ToolEntry = {
  ...WEBSEARCH_TOOL_CONTRACT,
  providerNative: undefined,
  metadata: {
    shouldDefer: true,
    name: WEBSEARCH_TOOL_NAME,
    searchHint: "search the web for current information",
    // 写死月份会导致模型可见的 WebSearch 描述过期。
    // 每次读取时重新生成，避免长驻进程跨月后继续投递旧月份。
    get description() {
      return buildWebSearchProviderDescription();
    },
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: 20_000,
    sideEffectScope: "network",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: webSearchHandler as ToolHandler,
  formatModelContent: formatWebSearchModelContent,
  inputSchema: WebSearchInputJsonSchema,
  outputSchema: WebSearchOutputJsonSchema,
  runtimeInputSchema: WebSearchInputSchema,
  runtimeOutputSchema: WebSearchOutputSchema,
};

/**
 * REST 后端路径：**不发起任何模型请求**。
 *
 * 与 provider-native 路径的分工是刻意的——那边把「搜索」外包给模型，这边只是调一个
 * 计费接口，所以既没有 usage 也没有 summary；结果里的 summary/date/authority 走
 * `WebSearchOutput.summary`（模型可见文本），结构化 `results` 仍是契约声明的 `{title,url}`。
 */
async function runBackendWebSearch(
  input: WebSearchInput,
  context: ToolExecutionContext,
  startedAt: number,
  origin: string | undefined,
): Promise<WebSearchOutput> {
  const backend = context.webToolsPort;
  if (!backend) {
    // 不可达：调用点已确认 available。保留第二道校验而不是断言，避免上游改造后静默空转。
    throw createCoreError(CoreErrorType.ConfigurationError, "Web search backend is unavailable", {
      context: { toolCallId: context.toolCallId, toolName: WEBSEARCH_TOOL_NAME },
      recoverable: true,
    });
  }

  const requestId = `net_${crypto.randomUUID()}`;
  const requestStartedAt = new Date();
  const endpoint = `${origin ?? "https://api.deepseek.com"}/v1/tools/search`;
  const baseStatus = {
    method: "POST",
    requestId,
    source: "http_client" as const,
    startedAt: requestStartedAt.toISOString(),
    toolCallId: context.toolCallId,
    toolName: WEBSEARCH_TOOL_NAME,
    url: endpoint,
  };
  // 搜索词会出网到 api.deepseek.com：与直连抓取一样进 NetworkRequestStatus，
  // 否则 UI / debug 看不到这次真实出网点。
  await emitWebSearchNetworkStatus(context, { ...baseStatus, status: "pending" });

  let results;
  try {
    results = await backend.search(
      { query: applyDomainConstraintsToQuery(input) },
      { signal: context.abortSignal, trace: webSearchTraceFromContext(context) },
    );
    await emitWebSearchNetworkStatus(context, {
      ...baseStatus,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - requestStartedAt.getTime(),
      status: "complete",
    });
  } catch (error) {
    await emitWebSearchNetworkStatus(context, {
      ...baseStatus,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - requestStartedAt.getTime(),
      error: describeBackendError(error),
      status: "error",
    });
    throw toWebSearchBackendError(error, input);
  }

  const filtered = filterResultsByDomain(results, input);
  const items = toWebSearchResultItems(filtered);
  const summary =
    formatBackendResultsSummary(filtered) ?? formatEmptyBackendResultsNotice(input);

  return {
    query: input.query,
    results: items,
    sources: items.map((item) => ({ url: item.url, title: item.title })),
    summary,
    durationMs: Date.now() - startedAt,
  };
}

async function emitWebSearchNetworkStatus(
  context: ToolExecutionContext,
  payload: Omit<NetworkRequestStatusPayload, "sessionId">,
): Promise<void> {
  await context.emitEvent?.({
    id: crypto.randomUUID() as never,
    payload,
    sequenceNumber: 0,
    sessionId: context.sessionId,
    timestamp: new Date(),
    traceId: context.traceId,
    turnId: context.turnId,
    type: SessionEventType.NetworkRequestStatus,
  });
}

function describeBackendError(error: unknown): string {
  return error instanceof Error ? error.message : "Web search backend request failed";
}

/** 后端失败映射成稳定、可执行的工具错误；不静默回退 provider-native，避免同一 query 搜两次。 */
function toWebSearchBackendError(error: unknown, input: WebSearchInput): Error {
  if (!isWebToolsPortError(error)) return error instanceof Error ? error : new Error(String(error));

  const hints: Record<WebToolsErrorCode, { message: string; recoverable: boolean }> = {
    not_configured: { message: "Web search backend is not configured", recoverable: false },
    unauthorized: {
      message: "Web search backend rejected the API key; check the DeepSeek key in provider settings",
      recoverable: false,
    },
    insufficient_balance: {
      message: "Web search backend account has insufficient balance",
      recoverable: false,
    },
    blocked_by_policy: {
      message: "Web search request was blocked by the backend policy",
      recoverable: true,
    },
    not_found: { message: "Web search backend endpoint was not found", recoverable: false },
    rate_limited: {
      message: "Web search was rate limited; wait a moment before searching again",
      recoverable: true,
    },
    timeout: { message: "Web search request timed out; retry the search", recoverable: true },
    invalid_request: {
      message: "Web search backend rejected the query; rephrase it and retry",
      recoverable: true,
    },
    upstream_error: {
      message: "Web search backend failed; retry the search",
      recoverable: true,
    },
    network_error: {
      message: "Web search request could not reach the backend; check the network and retry",
      recoverable: true,
    },
  };

  const hint = hints[error.code];
  return createCoreError(CoreErrorType.ToolExecutionFailed, hint.message, {
    cause: error,
    context: {
      query: input.query,
      toolName: WEBSEARCH_TOOL_NAME,
      webSearchCode: error.code,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
    },
    recoverable: hint.recoverable,
  });
}

function createProviderNativeWebSearchContract(input: WebSearchInput): ModelToolContract {
  return {
    name: PROVIDER_WEBSEARCH_TOOL_NAME,
    capability: "web_search",
    description: "Provider-native web search used internally by the WebSearch tool",
    executionMode: "providerNative",
    providerNative: {
      ...WEBSEARCH_PROVIDER_NATIVE_SPEC,
      args: toWebSearchProviderNativeArgs(input, {
        maxUses: DEFAULT_MAX_USES,
      }),
    },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
  };
}

async function collectWebSearchStreamResult(input: {
  events: AsyncIterable<ModelStreamEvent>;
}): Promise<ModelTextResult> {
  let text = "";
  let finishReason = "unknown";
  let providerMetadata: Record<string, unknown> | undefined;
  let usage: ModelUsage = {};
  const toolCalls: ModelToolCall[] = [];

  for await (const event of input.events) {
    switch (event.type) {
      case "text_delta":
        text += event.text;
        break;
      case "tool_call":
        toolCalls.push(event.toolCall);
        break;
      case "finish":
        finishReason = event.finishReason;
        usage = event.usage;
        providerMetadata = event.providerMetadata;
        break;
      case "error":
        throw normalizeStreamError(event.error);
    }
  }

  return {
    finishReason,
    providerMetadata,
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
  };
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return createCoreError(CoreErrorType.ModelError, "WebSearch stream failed", {
    context: { error },
    recoverable: true,
  });
}
