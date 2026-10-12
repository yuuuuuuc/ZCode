import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SessionEventType,
  createMessageId,
  createSessionId,
  createTraceId,
  type ModelStreamEvent,
  type SessionEvent,
  type SessionTaskType,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { recordMainTurnCacheHitUsage } from "../src/runtime/methods/turn-model-step-usage.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory, createTestRuntimeModel } from "./test-runtime-model.js";

afterEach(() => vi.restoreAllMocks());

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

  it.each([3000, -1, 0.5, NaN, Infinity])(
    "excludes unaligned or invalid reasoning-token usage (%s) without changing cache statistics",
    (reasoningTokens) => {
      const runtime = createRuntime();
      const skipped = recordMainTurnCacheHitUsage(
        runtime,
        { inputTokens: 100, outputTokens: 3100, reasoningTokens, cacheReadTokens: 80 },
        1000,
      );
      expect(skipped).toMatchObject({ outputTokensPerSecond: null, hitRate: 0.8 });
      expect(runtime.mainTurnCacheHitAggregate).toMatchObject({
        requestCount: 1,
        totalInputTokens: 100,
        totalOutputTokens: 0,
        totalGenerationDurationMs: 0,
      });

      const measurable = recordMainTurnCacheHitUsage(
        runtime,
        { inputTokens: 100, outputTokens: 100, reasoningTokens: 0 },
        1000,
      );
      expect(measurable?.outputTokensPerSecond).toBe(100);

      const nextSkipped = recordMainTurnCacheHitUsage(
        runtime,
        { inputTokens: 100, outputTokens: 3100, reasoningTokens },
        1000,
      );
      expect(nextSkipped?.outputTokensPerSecond).toBe(100);
      expect(runtime.mainTurnCacheHitAggregate).toMatchObject({
        totalOutputTokens: 100,
        totalGenerationDurationMs: 1000,
      });
    },
  );

  it.each([0, -1, NaN, Infinity, -Infinity])(
    "does not poison the speed counters with invalid duration %s",
    (duration) => {
      const runtime = createRuntime();
      expect(
        recordMainTurnCacheHitUsage(runtime, { inputTokens: 100, outputTokens: 100 }, duration)
          ?.outputTokensPerSecond,
      ).toBeNull();
      expect(
        recordMainTurnCacheHitUsage(runtime, { inputTokens: 100, outputTokens: 100 }, 1000)
          ?.outputTokensPerSecond,
      ).toBe(100);
    },
  );
});

describe("main-turn output speed stream timing", () => {
  function streamFixture() {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const model = createTestRuntimeModel({
      generateText: async () => ({
        text: "non-streamed",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 100 },
      }),
    });
    const sessionId = createSessionId("output-speed-stream-boundaries");
    const runtime = createTestAgentRuntime(
      sessionId,
      { modelStreaming: "on", titleGeneration: { enabled: false } },
      { eventStore: createTestSessionEventStore(), modelFactory: () => model },
    ) as unknown as AgentRuntimeInternal;
    const options = {
      assistantMessageId: createMessageId("output-speed-message"),
      model,
      messages: [],
      tools: [],
      events: [] as SessionEvent[],
      traceContext: { traceId: createTraceId() },
    };
    return {
      runtime,
      model,
      options,
      setClock: (time: number) => {
        clock = time;
      },
    };
  }

  it.each(["text_delta", "reasoning_delta", "tool_input_delta"] as const)(
    "starts at non-empty %s, not empty prelude events",
    async (kind) => {
      const { runtime, model, options, setClock } = streamFixture();
      model.streamText = async function* () {
        yield { type: "start" };
        yield { type: "text_delta", text: "" };
        yield { type: "reasoning_delta", text: "" };
        yield { type: "tool_input_start", id: "tool", toolName: "Read" };
        yield { type: "tool_input_delta", id: "tool", delta: "" };
        setClock(1000);
        if (kind === "tool_input_delta") yield { type: kind, id: "tool", delta: "{}" };
        else yield { type: kind, text: "content" };
        setClock(3000);
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 100 },
        };
      };
      expect((await runtime.runModelTextRequest(options)).outputGenerationDurationMs).toBe(2000);
    },
  );

  it.each(["empty", "no-finish", "zero", "negative", "non-finite", "non-stream"])(
    "does not invent duration for %s",
    async (scenario) => {
      const { runtime, model, options, setClock } = streamFixture();
      if (scenario === "non-stream")
        vi.spyOn(runtime, "shouldStreamModelText").mockReturnValue(false);
      model.streamText = async function* () {
        if (scenario !== "empty") yield { type: "text_delta", text: "answer" };
        if (scenario === "no-finish") return;
        setClock(
          scenario === "zero"
            ? 0
            : scenario === "negative"
              ? -1
              : scenario === "non-finite"
                ? Infinity
                : 1000,
        );
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 100 },
        };
      };
      expect(
        (await runtime.runModelTextRequest(options)).outputGenerationDurationMs,
      ).toBeUndefined();
    },
  );

  it("invalidates duration when the event high-water mark blocks stream consumption", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const releaseWrite = Promise.withResolvers<void>();
    let count = 0;
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      return emit(...args);
    });
    model.streamText = async function* () {
      for (count = 0; count < 128; count += 1) {
        setClock(count);
        yield { type: "text_delta", text: "token" };
      }
      setClock(2000);
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 100 },
      };
    };
    const request = runtime.runModelTextRequest(options);
    try {
      await vi.waitFor(() => expect(count).toBe(127));
      expect(options.events).toHaveLength(0);
    } finally {
      releaseWrite.resolve();
    }
    expect((await request).outputGenerationDurationMs).toBeUndefined();
    expect(count).toBe(128);
    expect(options.events).toHaveLength(129);
  });

  it("invalidates duration across a pre-finish tool commit without changing tool callbacks", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const onStreamToolCall = vi.fn();
    model.streamText = async function* (): AsyncGenerator<ModelStreamEvent> {
      yield { type: "text_delta", text: "using tool" };
      setClock(1000);
      yield { type: "tool_call", toolCall: { id: "call", name: "Read", input: {} } };
      setClock(2000);
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 100, outputTokens: 100 },
      };
    };
    const result = await runtime.runModelTextRequest({ ...options, onStreamToolCall });
    expect(result.outputGenerationDurationMs).toBeUndefined();
    expect(onStreamToolCall).toHaveBeenCalledOnce();
    expect(result.toolCalls).toEqual([{ id: "call", name: "Read", input: {} }]);
  });

  it("still rejects a failed provider stream without creating a result", async () => {
    const { runtime, model, options } = streamFixture();
    model.streamText = async function* () {
      yield { type: "text_delta", text: "partial" };
      yield { type: "error", error: new Error("provider interrupted") };
    };
    await expect(runtime.runModelTextRequest(options)).rejects.toThrow("provider interrupted");
  });

  it.each([0, 10_000])(
    "uses receipt timing rather than queued event writes or part persistence (%s ms write cost)",
    async (writeCost) => {
      let clock = 0;
      const finishObserved = Promise.withResolvers<void>();
      const releaseWrites = Promise.withResolvers<void>();
      vi.spyOn(performance, "now").mockImplementation(() => {
        if (clock === 3000) finishObserved.resolve();
        return clock;
      });
      const sessionId = createSessionId(`output-speed-write-cost-${writeCost}`);
      const eventStore = createTestSessionEventStore();
      const append = eventStore.append.bind(eventStore);
      vi.spyOn(eventStore, "append").mockImplementation(async (event) => {
        if (event.type === SessionEventType.ModelStreaming && writeCost > 0) {
          await releaseWrites.promise;
          clock += writeCost;
        }
        return append(event);
      });
      const runtime = createTestAgentRuntime(
        sessionId,
        { modelStreaming: "on", titleGeneration: { enabled: false } },
        {
          eventStore,
          modelFactory: createTestModelFactory({
            async *streamText() {
              yield { type: "start" };
              clock = 1000;
              yield { type: "text_delta", text: "first " };
              clock = 2000;
              yield { type: "text_delta", text: "last" };
              clock = 3000;
              yield {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 100, outputTokens: 1000 },
              };
            },
          }),
        },
      );
      const internal = runtime as unknown as AgentRuntimeInternal;
      const persistPart = internal.persistPart.bind(internal);
      vi.spyOn(internal, "persistPart").mockImplementation(async (...args) => {
        if (args[0].type === "text" || args[0].type === "reasoning") clock += 60_000;
        return persistPart(...args);
      });

      const turn = runtime.executeTurn("measure output speed");
      if (writeCost > 0) {
        try {
          // 明确等到消费 finish 后才放行写队列，不靠真实计时/超时模拟慢磁盘。
          await finishObserved.promise;
        } finally {
          releaseWrites.resolve();
        }
      }
      expect((await turn).response).toBe("first last");
      const events = await eventStore.getEvents(sessionId);
      const complete = events.find((event) => event.type === SessionEventType.ModelComplete);
      expect(complete?.payload).toMatchObject({
        cacheHit: { outputTokensPerSecond: 500 },
        usage: { inputTokens: 100, outputTokens: 1000 },
      });
      expect(complete?.payload).not.toHaveProperty("outputGenerationDurationMs");
      expect(
        events
          .filter((event) => event.type === SessionEventType.ModelStreaming)
          .map((event) => (event.payload as { kind: string }).kind),
      ).toEqual(["start", "text_delta", "text_delta", "finish"]);
    },
  );

  it.each([false, true])(
    "does not count reported reasoning tokens over the visible tail (summary=%s)",
    async (withSummary) => {
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const sessionId = createSessionId(`output-speed-hidden-reasoning-${withSummary}`);
      const eventStore = createTestSessionEventStore();
      const runtime = createTestAgentRuntime(
        sessionId,
        { modelStreaming: "on", titleGeneration: { enabled: false } },
        {
          eventStore,
          modelFactory: createTestModelFactory({
            async *streamText() {
              clock = 30_000;
              if (withSummary)
                yield { type: "reasoning_delta", id: "summary", text: "short summary" };
              yield { type: "text_delta", text: "answer" };
              clock = 31_000;
              yield {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 100, outputTokens: 3100, reasoningTokens: 3000 },
              };
            },
          }),
        },
      );
      await runtime.executeTurn("reason about this");
      const complete = (await eventStore.getEvents(sessionId)).find(
        (event) => event.type === SessionEventType.ModelComplete,
      );
      expect(complete?.payload).toMatchObject({
        usage: { outputTokens: 3100, reasoningTokens: 3000 },
        cacheHit: { outputTokensPerSecond: null, totalInputTokens: 100 },
      });
    },
  );

  it.each(["subagent_child", "workflow_child"] as const)(
    "does not publish a main-turn speed aggregate for %s",
    async (taskType: SessionTaskType) => {
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const sessionId = createSessionId(`output-speed-${taskType}`);
      const eventStore = createTestSessionEventStore();
      const runtime = createTestAgentRuntime(
        sessionId,
        { taskType, modelStreaming: "on", titleGeneration: { enabled: false } },
        {
          eventStore,
          modelFactory: createTestModelFactory({
            async *streamText() {
              yield { type: "text_delta", text: "answer" };
              clock = 1000;
              yield {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 100, outputTokens: 100 },
              };
            },
          }),
        },
      );
      await runtime.executeTurn("measure child output");
      const complete = (await eventStore.getEvents(sessionId)).find(
        (event) => event.type === SessionEventType.ModelComplete,
      );
      expect(complete?.payload).toBeDefined();
      expect(complete?.payload).not.toHaveProperty("cacheHit");
    },
  );
});
