import { createModelUsageSummaryFromEvents } from "../deps.js";
import type { MessageId, MessageWithParts, Model, ModelUsage, TraceContext } from "../deps.js";
import type {
  MainTurnCacheHitAggregate,
  OutputSpeedDiagnostics,
  RuntimeModelTextResult,
} from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import {
  persistedTokenUsageBaseline,
  type PersistedTokenUsageBaseline,
} from "../../agent/message-history-usage.js";
import { recordModelUsageFact } from "./usage-observability.js";

/** 毫秒 → 秒的换算基数。与 packages/ui/src/app-shell/workflowRunThrottle.ts 的 MS_PER_SECOND 同名，便于全仓搜索。 */
const MS_PER_SECOND = 1_000;

interface RecordMainTurnModelUsageInput {
  assistantMessageId: MessageId;
  error?: unknown;
  model: Model;
  modelTraceContext: TraceContext;
  networkEventStartIndex: number;
  result?: RuntimeModelTextResult;
  startedAt: number;
  status: "completed" | "error" | "cancelled";
  toolCallCount?: number;
}

export async function recordMainTurnModelUsage(
  runtime: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  input: RecordMainTurnModelUsageInput,
): Promise<void> {
  // 失败请求的已报告消耗在恢复前结算，成功路径仍使用原有计数。
  if (!input.result) {
    state.tokenCount +=
      createModelUsageSummaryFromEvents(state.events.slice(input.networkEventStartIndex))
        ?.totalTokens ?? 0;
  }
  await recordModelUsageFact(runtime, {
    assistantMessageId: input.assistantMessageId,
    error: input.error,
    events: state.events,
    // 运行中切模会立即更新 Session Selection；usage 若在 await 后重新读取它，
    // 就会把旧请求的 token 归到新模型。这里只消费 model step 开始时的不可变快照。
    model: input.model,
    networkEventStartIndex: input.networkEventStartIndex,
    parentUserMessageId: state.currentUserMessageId,
    querySource: querySourceForTask(runtime.config.taskType),
    result: input.result,
    startedAt: input.startedAt,
    status: input.status,
    toolCallCount: input.toolCallCount,
    traceContext: input.modelTraceContext,
  });
}

export function querySourceForTask(taskType: AgentRuntimeInternal["config"]["taskType"]): string {
  if (taskType === "subagent_child") return "subagent";
  if (taskType === "workflow_child" || taskType === "nested_workflow_child")
    return "workflow_child";
  return "main_turn";
}

export function findLatestCommittedAssistantUsage(
  sourceEntries: readonly (RuntimeMessageEntry | undefined)[],
): { messageIndex: number; baseline: PersistedTokenUsageBaseline } | undefined {
  for (let messageIndex = sourceEntries.length - 1; messageIndex >= 0; messageIndex--) {
    const entry = sourceEntries[messageIndex];
    if (!entry || entry.kind === "attachment" || entry.message.role !== "assistant") continue;
    const baseline = persistedTokenUsageBaseline(entry.tokens);
    if (baseline) return { messageIndex, baseline };
  }
  return undefined;
}

export function mainTurnCacheHitAggregateFromMessages(input: {
  activeMessages: readonly MessageWithParts[];
  persistedMessages: readonly MessageWithParts[];
}): MainTurnCacheHitAggregate {
  const activeMessageIds = new Set(input.activeMessages.map((message) => message.info.id));

  return input.persistedMessages.reduce<MainTurnCacheHitAggregate>(
    (aggregate, message) => {
      if (
        !activeMessageIds.has(message.info.id) ||
        message.info.role !== "assistant" ||
        message.info.summary
      ) {
        return aggregate;
      }

      // activeMessages 是 provider/context projection，Compact preserved usage
      // 可能已被清零。active IDs 只决定分支成员，cache aggregate 必须读取持久化原始 tokens。
      const inputTokens = nonNegativeInteger(message.info.tokens.input) ?? 0;
      const cacheReadTokens = nonNegativeInteger(message.info.tokens.cache.read) ?? 0;
      const cacheWriteTokens = nonNegativeInteger(message.info.tokens.cache.write) ?? 0;
      if (inputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
        return aggregate;
      }

      return {
        requestCount: aggregate.requestCount + 1,
        totalInputTokens: aggregate.totalInputTokens + inputTokens,
        totalCacheReadTokens: aggregate.totalCacheReadTokens + cacheReadTokens,
        totalCacheWriteTokens: aggregate.totalCacheWriteTokens + cacheWriteTokens,
        // 持久化消息只有 token 数没有生成耗时；恢复路径的速度字段从 0 重新累计。
        totalOutputTokens: aggregate.totalOutputTokens,
        totalGenerationDurationMs: aggregate.totalGenerationDurationMs,
      };
    },
    {
      requestCount: 0,
      totalInputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalOutputTokens: 0,
      totalGenerationDurationMs: 0,
    },
  );
}

export function recordMainTurnCacheHitUsage(
  runtime: AgentRuntimeInternal,
  usage: ModelUsage | undefined,
  generationDurationMs: number | undefined,
):
  | {
      cacheReadTokens: number;
      cacheWriteTokens: number;
      hitRate: number | null;
      hitRateRequestCount: number;
      inputTokens: number;
      latestHitRate: number | null;
      outputTokensPerSecond: number | null;
      totalCacheReadTokens: number;
      totalCacheWriteTokens: number;
      totalInputTokens: number;
    }
  | undefined {
  if (!usage) {
    return undefined;
  }
  // AI SDK v6 已把 Anthropic cache read/write 并入 inputTokens；
  // 缓存命中率的分母应使用 total input，不能再把 cache 字段重复加到分母或上下文用量里。
  const inputTokens = modelUsageInputWindowTokens(usage) ?? 0;
  const cacheReadTokens = nonNegativeInteger(usage.cacheReadTokens) ?? 0;
  const cacheWriteTokens = nonNegativeInteger(usage.cacheWriteTokens) ?? 0;
  if (inputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined;
  }

  const sample = measurableOutputSample(usage, generationDurationMs);
  const outputTokens = sample?.outputTokens ?? 0;
  const generationMs = sample?.generationMs ?? 0;
  const measurable = sample !== undefined;

  runtime.mainTurnCacheHitAggregate = {
    requestCount: runtime.mainTurnCacheHitAggregate.requestCount + 1,
    totalInputTokens: runtime.mainTurnCacheHitAggregate.totalInputTokens + inputTokens,
    totalCacheReadTokens: runtime.mainTurnCacheHitAggregate.totalCacheReadTokens + cacheReadTokens,
    totalCacheWriteTokens:
      runtime.mainTurnCacheHitAggregate.totalCacheWriteTokens + cacheWriteTokens,
    totalOutputTokens:
      runtime.mainTurnCacheHitAggregate.totalOutputTokens + (measurable ? outputTokens : 0),
    totalGenerationDurationMs:
      runtime.mainTurnCacheHitAggregate.totalGenerationDurationMs + (measurable ? generationMs : 0),
  };

  const aggregate = runtime.mainTurnCacheHitAggregate;
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    latestHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
    hitRate:
      aggregate.totalInputTokens > 0
        ? aggregate.totalCacheReadTokens / aggregate.totalInputTokens
        : null,
    hitRateRequestCount: aggregate.requestCount,
    // 刻意是**累计平均**而非滑动窗口：自进程启动（或上次 resume 恢复）起单调累加，
    // 与同面板的 hitRate 一样是「平均」语义。resume 后耗时计数器从 0 重启而 hitRate 仍是
    // 全历史窗口，两行口径不同是已知且接受的妥协（见 docs/context-cache-hit-rate.md）。
    // 返回 null 时面板隐藏整行，不显示 0。
    outputTokensPerSecond:
      aggregate.totalGenerationDurationMs > 0
        ? (aggregate.totalOutputTokens * MS_PER_SECOND) / aggregate.totalGenerationDurationMs
        : null,
    totalInputTokens: aggregate.totalInputTokens,
    totalCacheReadTokens: aggregate.totalCacheReadTokens,
    totalCacheWriteTokens: aggregate.totalCacheWriteTokens,
  };
}

/**
 * 速度聚合与诊断计数共用的唯一「可测」判定，避免两处口径漂移。
 * 修复原因：可测性由 bounded reader 的 result() 唯一判定。adapter 只提供推理来源和暂存回填。
 * 聚合层没有流证据，不能另行判断推理口径；duration 存在即代表计时 owner 已通过
 * 用量、来源和时间窗口校验（含 reasoningTokens <= outputTokens），这里只成对累计。
 * 缺 token 或缺同口径耗时均成对跳过，避免污染后续累计平均。
 */
function measurableOutputSample(
  usage: ModelUsage | undefined,
  generationDurationMs: number | undefined,
): { outputTokens: number; generationMs: number } | undefined {
  const generationMs =
    generationDurationMs !== undefined &&
    Number.isFinite(generationDurationMs) &&
    generationDurationMs > 0
      ? generationDurationMs
      : 0;
  const outputTokens = Number.isSafeInteger(usage?.outputTokens) ? (usage?.outputTokens ?? 0) : 0;
  return generationMs > 0 && outputTokens > 0 ? { outputTokens, generationMs } : undefined;
}

export function emptyOutputSpeedDiagnostics(): OutputSpeedDiagnostics {
  return { measurableCount: 0, unavailableCounts: {}, lastUnavailableReason: null };
}

/**
 * 只统计 main_turn；计数与 mainTurnCacheHitAggregate 同生命周期（resume / rewind 一起清零）。
 * 不可测原因优先：有原因时 reader 一定没给 duration；既无原因也不可测（例如非流式请求）时不计数，
 * 不替 reader 编造原因。
 */
export function recordMainTurnOutputSpeedDiagnostics(
  runtime: AgentRuntimeInternal,
  result: Pick<
    RuntimeModelTextResult,
    "usage" | "outputGenerationDurationMs" | "outputGenerationUnavailableReason"
  >,
): void {
  const current = runtime.outputSpeedDiagnostics;
  const reason = result.outputGenerationUnavailableReason;
  if (reason) {
    runtime.outputSpeedDiagnostics = {
      ...current,
      unavailableCounts: {
        ...current.unavailableCounts,
        [reason]: (current.unavailableCounts[reason] ?? 0) + 1,
      },
      lastUnavailableReason: reason,
    };
    return;
  }
  if (measurableOutputSample(result.usage, result.outputGenerationDurationMs)) {
    runtime.outputSpeedDiagnostics = { ...current, measurableCount: current.measurableCount + 1 };
  }
}

/** 对外只给副本，调用方不能改写 runtime 内部计数。 */
export function copyOutputSpeedDiagnostics(
  diagnostics: OutputSpeedDiagnostics,
): OutputSpeedDiagnostics {
  return { ...diagnostics, unavailableCounts: { ...diagnostics.unavailableCounts } };
}

function modelUsageInputWindowTokens(usage?: ModelUsage): number | undefined {
  if (!usage) return undefined;

  // core test/runtime 通过包入口解析 @zcode/contracts，新增 contracts helper 在未构建时不可用。
  // 这里保留同一算法：按 Anthropic 口径把 cache read 并入当前请求的 input window。
  const inputTokens = positiveInteger(usage.inputTokens);
  if (inputTokens !== undefined) {
    // AI SDK v6 的 Anthropic inputTokens 已经是普通输入 + cache read/write 的 total input。
    // 统一使用 provider 已归一化的 input，避免自动压缩和 UI context meter 重复计算 cache。
    return inputTokens;
  }

  const totalTokens = positiveInteger(usage.totalTokens);
  if (totalTokens !== undefined) {
    const outputTokens = nonNegativeInteger(usage.outputTokens) ?? 0;
    return Math.max(0, totalTokens - outputTokens);
  }

  const cacheTokens =
    (nonNegativeInteger(usage.cacheReadTokens) ?? 0) +
    (nonNegativeInteger(usage.cacheWriteTokens) ?? 0);
  return cacheTokens > 0 ? cacheTokens : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer >= 0 ? integer : undefined;
}
