import { describe, expect, it } from "vitest";

import { parseContextCacheUsageAggregate } from "../src/zcode-context-cache-usage.js";

// 这份解析是 services 与 ui 两处桌面投影的唯一副本：字段漏读会直接表现成
// 「Agent 已经发了、面板不显示」，所以逐字段锁住。
describe("parseContextCacheUsageAggregate", () => {
  it("returns undefined for a missing or empty aggregate so callers fall back", () => {
    expect(parseContextCacheUsageAggregate(undefined)).toBeUndefined();
    expect(parseContextCacheUsageAggregate(null)).toBeUndefined();
    expect(parseContextCacheUsageAggregate({})).toBeUndefined();
  });

  it("keeps every aggregate field the context panel reads", () => {
    expect(
      parseContextCacheUsageAggregate({
        inputTokens: 500,
        cacheReadTokens: 150,
        cacheWriteTokens: 25,
        latestHitRate: 0.3,
        hitRate: 0.42,
        hitRateRequestCount: 7,
        totalInputTokens: 1000,
        totalCacheReadTokens: 420,
        totalCacheWriteTokens: 50,
        outputTokensPerSecond: 42.5,
      }),
    ).toEqual({
      inputTokens: 500,
      cacheReadTokens: 150,
      cacheWriteTokens: 25,
      latestHitRate: 0.3,
      hitRate: 0.42,
      hitRateRequestCount: 7,
      totalInputTokens: 1000,
      totalCacheReadTokens: 420,
      totalCacheWriteTokens: 50,
      outputTokensPerSecond: 42.5,
    });
  });

  it("omits optional fields the Agent did not send instead of inventing zeros", () => {
    const parsed = parseContextCacheUsageAggregate({ inputTokens: 10, cacheReadTokens: 5 });

    // hitRate 是必填可空；其余可选项缺失时不能补 0，否则面板会把「未知」画成「零」。
    expect(parsed).toEqual({
      inputTokens: 10,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      hitRate: null,
    });
    expect(parsed).not.toHaveProperty("outputTokensPerSecond");
    expect(parsed).not.toHaveProperty("totalInputTokens");
  });

  it("clamps negative rates and speeds to zero", () => {
    const parsed = parseContextCacheUsageAggregate({
      inputTokens: 1,
      cacheReadTokens: 0,
      hitRate: -0.5,
      latestHitRate: -1,
      outputTokensPerSecond: -3,
    });

    expect(parsed?.hitRate).toBe(0);
    expect(parsed?.latestHitRate).toBe(0);
    expect(parsed?.outputTokensPerSecond).toBe(0);
  });

  it("drops non-numeric values rather than passing them through", () => {
    const parsed = parseContextCacheUsageAggregate({
      inputTokens: 4,
      cacheReadTokens: 1,
      outputTokensPerSecond: "42",
      totalInputTokens: 3.5,
    });

    expect(parsed?.outputTokensPerSecond).toBeUndefined();
    // 累计 token 数只接受非负整数，小数不进聚合。
    expect(parsed?.totalInputTokens).toBeUndefined();
  });
});
