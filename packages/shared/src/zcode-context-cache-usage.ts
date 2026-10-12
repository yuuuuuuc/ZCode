import type { ZCodeContextCacheUsage } from "./zcode-task-types-core.js";

/**
 * `usage_update` / `model_complete` payload 里 `cacheHit` 聚合对象的解析。
 *
 * 这个聚合体是「上下文容量」面板缓存命中率与平均输出速度的唯一来源，而桌面侧有两处调用方：
 * `packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts`（desktop continuous 链路）与
 * `packages/ui/src/lib/zcodeSessionProjection.ts`（v4 投影链路）。它们过去各自内联了同一段
 * 逐字段解析——加一个字段要改两遍，漏一处就是「Agent 已经发了、面板却不显示」的静默缺口。
 * 解析收敛到这里之后，聚合字段只在这一处演进，两个投影各自只保留自己的分支选择逻辑。
 */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 解析 `payload.cacheHit`；对象为空（缺字段或旧 Agent 不带该字段）时返回 undefined，
 * 由调用方决定是否回退到 provider usage 归一化。
 */
export function parseContextCacheUsageAggregate(
  value: unknown,
): ZCodeContextCacheUsage | undefined {
  const aggregate = asRecord(value);
  if (Object.keys(aggregate).length === 0) {
    return undefined;
  }

  const inputTokens = nonNegativeIntegerValue(aggregate.inputTokens) ?? 0;
  const cacheReadTokens = nonNegativeIntegerValue(aggregate.cacheReadTokens) ?? 0;
  const cacheWriteTokens = nonNegativeIntegerValue(aggregate.cacheWriteTokens) ?? 0;
  const latestHitRate = numberValue(aggregate.latestHitRate);
  const hitRate = numberValue(aggregate.hitRate);
  const hitRateRequestCount = nonNegativeIntegerValue(aggregate.hitRateRequestCount);
  const totalInputTokens = nonNegativeIntegerValue(aggregate.totalInputTokens);
  const totalCacheReadTokens = nonNegativeIntegerValue(aggregate.totalCacheReadTokens);
  const totalCacheWriteTokens = nonNegativeIntegerValue(aggregate.totalCacheWriteTokens);
  const outputTokensPerSecond = numberValue(aggregate.outputTokensPerSecond);
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...(latestHitRate !== undefined ? { latestHitRate: Math.max(0, latestHitRate) } : {}),
    ...(hitRateRequestCount !== undefined ? { hitRateRequestCount } : {}),
    ...(totalInputTokens !== undefined ? { totalInputTokens } : {}),
    ...(totalCacheReadTokens !== undefined ? { totalCacheReadTokens } : {}),
    ...(totalCacheWriteTokens !== undefined ? { totalCacheWriteTokens } : {}),
    ...(outputTokensPerSecond !== undefined
      ? { outputTokensPerSecond: Math.max(0, outputTokensPerSecond) }
      : {}),
    hitRate: hitRate !== undefined ? Math.max(0, hitRate) : null,
  };
}
