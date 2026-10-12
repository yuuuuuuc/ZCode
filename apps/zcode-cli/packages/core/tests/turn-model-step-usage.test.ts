import { describe, expect, it } from "vitest";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import {
  recordMainTurnCacheHitUsage,
} from "../src/runtime/methods/turn-model-step-usage.js";

// recordMainTurnCacheHitUsage 只读写 runtime.mainTurnCacheHitAggregate，测试用最小桩替换完整 runtime。
function createRuntime(): AgentRuntimeInternal {
  return {
    mainTurnCacheHitAggregate: {
      requestCount: 0,
      totalInputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalOutputTokens: 0,
      totalGenerationDurationMs: 0,
    },
  } as Pick<AgentRuntimeInternal, "mainTurnCacheHitAggregate"> as AgentRuntimeInternal;
}

describe("recordMainTurnCacheHitUsage output speed", () => {
  it("accumulates average output speed across main turn requests", () => {
    const runtime = createRuntime();

    // 第一轮：1000 token / 5000ms = 200 tok/s。
    const first = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 1000, cacheReadTokens: 80, cacheWriteTokens: 10 },
      5000,
    );
    expect(first?.outputTokensPerSecond).toBe(200);

    // 第二轮：3000 token / 6000ms = 500 tok/s；累计 4000/11000ms ≈ 363.6 tok/s。
    const second = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 200, outputTokens: 3000, cacheReadTokens: 150, cacheWriteTokens: 15 },
      6000,
    );
    expect(second?.outputTokensPerSecond).toBeCloseTo((4000 * 1000) / 11000, 5);
  });

  it("returns null output speed when no generation duration was observed", () => {
    const runtime = createRuntime();

    // 非流式/无首 token 事件的请求分子分母都不计入，累计耗时为 0 时速度为 null。
    const result = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 500, cacheReadTokens: 80, cacheWriteTokens: 10 },
      undefined,
    );
    expect(result?.outputTokensPerSecond).toBeNull();

    // 后续带耗时的请求恢复速度统计；无耗时请求的 output 不进分子，速度只反映可测速请求。
    const next = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 500, cacheReadTokens: 80, cacheWriteTokens: 10 },
      2000,
    );
    expect(next?.outputTokensPerSecond).toBe(250);
  });

  it("skips the request when output tokens are missing, so the average is not diluted", () => {
    const runtime = createRuntime();

    // provider 没回报 outputTokens：耗时可得但分子拿不到，整条跳过。
    // 只跳分母会把 9s 摊进后续请求，平均速度被系统性拉低。
    const withoutOutputTokens = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 10 },
      9000,
    );
    expect(withoutOutputTokens?.outputTokensPerSecond).toBeNull();

    // 后一个可测请求只反映自己的口径：1000 token / 5000ms = 200 tok/s，没被前面 9s 摊薄。
    const measurable = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 1000, cacheReadTokens: 80, cacheWriteTokens: 10 },
      5000,
    );
    expect(measurable?.outputTokensPerSecond).toBe(200);
  });
});
