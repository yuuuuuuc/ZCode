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

  it("counts all output tokens, including reasoning, for an aligned duration", () => {
    const runtime = createRuntime();
    const result = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 3100, reasoningTokens: 3000, cacheReadTokens: 80 },
      31_000,
    );
    expect(result).toMatchObject({ outputTokensPerSecond: 100, hitRate: 0.8 });
    expect(runtime.mainTurnCacheHitAggregate.totalOutputTokens).toBe(3100);
  });

  it("trusts the timing owner's duration instead of re-judging reasoning metadata", () => {
    const runtime = createRuntime();

    // 聚合层只消费 bounded reader 校验后的 duration，不再次判断推理元数据。
    // 这里故意注入不可能通过真实计时链路的数据，验证聚合层不充当第二个 owner；
    // 不代表 reasoningTokens > outputTokens 在生产链路可测。拒绝非法元数据见
    // "rejects invalid reasoning-token metadata at the timing owner"。
    const result = recordMainTurnCacheHitUsage(
      runtime,
      { inputTokens: 100, outputTokens: 3100, reasoningTokens: 3101, cacheReadTokens: 80 },
      31_000,
    );
    expect(result).toMatchObject({ outputTokensPerSecond: 100, hitRate: 0.8 });
    expect(runtime.mainTurnCacheHitAggregate.totalOutputTokens).toBe(3100);
  });

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
          reasoningOutput: kind === "reasoning_delta" ? "complete" : undefined,
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

  it("continues timing across write backpressure while the reader buffer has space", async () => {
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
      await vi.waitFor(() => expect(count).toBe(128));
      expect(options.events).toHaveLength(0);
    } finally {
      releaseWrite.resolve();
    }
    expect((await request).outputGenerationDurationMs).toBe(2000);
    expect(count).toBe(128);
    expect(options.events).toHaveLength(129);
  });

  it("counts a pre-finish tool commit without changing tool callbacks", async () => {
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
    expect(result.outputGenerationDurationMs).toBe(2000);
    expect(onStreamToolCall).toHaveBeenCalledOnce();
    expect(result.toolCalls).toEqual([{ id: "call", name: "Read", input: {} }]);
  });

  it("counts pure tool output even when tool drain waits until after provider finish", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const releaseWrite = Promise.withResolvers<void>();
    const finishRead = Promise.withResolvers<void>();
    const onStreamToolCall = vi.fn();
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      setClock(60_000);
      return emit(...args);
    });
    model.streamText = async function* () {
      setClock(1000);
      yield { type: "tool_input_start", id: "call", toolName: "Read" };
      yield { type: "tool_input_delta", id: "call", delta: "{}" };
      setClock(2000);
      yield { type: "tool_input_end", id: "call" };
      yield { type: "tool_call", toolCall: { id: "call", name: "Read", input: {} } };
      setClock(3000);
      yield {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 100, outputTokens: 100 },
      };
      finishRead.resolve();
    };
    const request = runtime.runModelTextRequest({ ...options, onStreamToolCall });
    try {
      await finishRead.promise;
      expect(onStreamToolCall).not.toHaveBeenCalled();
    } finally {
      releaseWrite.resolve();
    }
    const result = await request;
    expect(result.outputGenerationDurationMs).toBe(2000);
    expect(
      recordMainTurnCacheHitUsage(runtime, result.usage, result.outputGenerationDurationMs)
        ?.outputTokensPerSecond,
    ).toBe(50);
    expect(onStreamToolCall).toHaveBeenCalledOnce();
    expect(options.events.map((event) => (event.payload as { kind: string }).kind)).toEqual([
      "tool_input_start",
      "tool_input_delta",
      "tool_input_end",
      "tool_call",
      "finish",
    ]);
  });

  it("adds a deferred tool-input lead back onto the visible window", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    model.streamText = async function* () {
      setClock(1000);
      yield { type: "tool_input_delta", id: "call", delta: "{\"content\":\"big\"}" };
      setClock(1005);
      yield {
        type: "finish",
        finishReason: "tool-calls",
        deferredOutputLeadMs: 500,
        usage: { inputTokens: 10, outputTokens: 50 },
      };
    };
    const result = await runtime.runModelTextRequest(options);
    expect(result.outputGenerationDurationMs).toBe(505);
    expect(JSON.stringify(options.events)).not.toContain("deferredOutputLeadMs");
    expect(
      recordMainTurnCacheHitUsage(runtime, result.usage, result.outputGenerationDurationMs)
        ?.outputTokensPerSecond,
    ).toBeCloseTo((50 * 1000) / 505, 5);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects deferred output lead %s",
    async (lead) => {
      const { runtime, model, options, setClock } = streamFixture();
      model.streamText = async function* () {
        yield { type: "tool_input_delta", id: "call", delta: "{}" };
        setClock(5);
        yield {
          type: "finish",
          finishReason: "tool-calls",
          deferredOutputLeadMs: lead,
          usage: { outputTokens: 50 },
        };
      };
      expect(await runtime.runModelTextRequest(options)).toMatchObject({
        outputGenerationUnavailableReason: "invalid_duration",
      });
    },
  );

  it("keeps reader backpressure ahead of a deferred output lead", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const releaseWrite = Promise.withResolvers<void>();
    let readCount = 0;
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      return emit(...args);
    });
    model.streamText = async function* () {
      yield { type: "text_delta", text: "first" };
      for (readCount = 0; readCount < 256; readCount += 1) {
        setClock(readCount + 1);
        yield { type: "text_delta", text: "token" };
      }
      setClock(2000);
      yield {
        type: "finish",
        finishReason: "stop",
        deferredOutputLeadMs: 500,
        usage: { outputTokens: 100 },
      };
    };
    const request = runtime.runModelTextRequest(options);
    try {
      await vi.waitFor(() => expect(readCount).toBeGreaterThan(100));
    } finally {
      releaseWrite.resolve();
    }
    const result = await request;
    expect(result.outputGenerationUnavailableReason).toBe("reader_backpressure");
    expect(result.outputGenerationDurationMs).toBeUndefined();
  });

  it("blends a text step and a deferred tool step between their real speeds", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    model.streamText = async function* () {
      yield { type: "text_delta", text: "hello" };
      setClock(1000);
      yield { type: "finish", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 100 } };
    };
    const text = await runtime.runModelTextRequest(options);
    expect(text.outputGenerationDurationMs).toBe(1000);

    model.streamText = async function* () {
      setClock(0);
      yield { type: "tool_input_delta", id: "call", delta: "x" };
      setClock(5);
      yield {
        type: "finish",
        finishReason: "tool-calls",
        deferredOutputLeadMs: 500,
        usage: { inputTokens: 10, outputTokens: 50 },
      };
    };
    const tool = await runtime.runModelTextRequest(options);
    expect(tool.outputGenerationDurationMs).toBe(505);

    recordMainTurnCacheHitUsage(runtime, text.usage, text.outputGenerationDurationMs);
    const combined = recordMainTurnCacheHitUsage(
      runtime,
      tool.usage,
      tool.outputGenerationDurationMs,
    );
    const speed = combined?.outputTokensPerSecond ?? 0;
    expect(speed).toBeGreaterThan((50 * 1000) / 505);
    expect(speed).toBeLessThan(100);
  });

  it("marks timing unavailable only when the bounded reader itself waits for space", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const releaseWrite = Promise.withResolvers<void>();
    let readCount = 0;
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      return emit(...args);
    });
    model.streamText = async function* () {
      yield { type: "text_delta", text: "first" };
      yield { type: "tool_call", toolCall: { id: "call", name: "Read", input: {} } };
      for (readCount = 0; readCount < 256; readCount += 1) {
        setClock(readCount + 1);
        yield { type: "text_delta", text: "token" };
      }
      setClock(2000);
      yield { type: "finish", finishReason: "stop", usage: { outputTokens: 100 } };
    };
    const request = runtime.runModelTextRequest(options);
    try {
      await vi.waitFor(() => expect(readCount).toBeGreaterThan(100));
      expect(readCount).toBeLessThan(256);
    } finally {
      releaseWrite.resolve();
    }
    expect(await request).toMatchObject({
      outputGenerationUnavailableReason: "reader_backpressure",
    });
    expect(readCount).toBe(256);
    expect(options.events).toHaveLength(259);
  });

  it("delivers buffered output before propagating a producer error", async () => {
    const { runtime, model, options } = streamFixture();
    const onStreamTextDelta = vi.fn();
    model.streamText = async function* () {
      yield { type: "text_delta", text: "first" };
      yield { type: "text_delta", text: "second" };
      throw new Error("read failed");
    };
    await expect(runtime.runModelTextRequest({ ...options, onStreamTextDelta })).rejects.toThrow(
      "read failed",
    );
    expect(onStreamTextDelta.mock.calls).toEqual([["first"], ["second"]]);
    expect(options.events).toHaveLength(2);
  });

  it("does not close an iterator again after natural EOF", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const stream = (async function* (): AsyncGenerator<ModelStreamEvent> {
      yield { type: "text_delta", text: "answer" };
      setClock(1000);
      yield { type: "finish", finishReason: "stop", usage: { outputTokens: 100 } };
    })();
    const close = vi.spyOn(stream, "return").mockRejectedValue(new Error("already closed"));
    model.streamText = () => stream;
    expect((await runtime.runModelTextRequest(options)).outputGenerationDurationMs).toBe(1000);
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves the producer error when iterator cleanup also fails", async () => {
    const { runtime, model, options } = streamFixture();
    const stream = (async function* (): AsyncGenerator<ModelStreamEvent> {
      yield { type: "text_delta", text: "partial" };
      throw new Error("provider read failed");
    })();
    vi.spyOn(stream, "return").mockRejectedValue(new Error("cleanup failed"));
    model.streamText = () => stream;
    await expect(runtime.runModelTextRequest(options)).rejects.toThrow("provider read failed");
    expect(options.events).toHaveLength(1);
  });

  it("aborts the in-flight reader and closes its iterator on a consumer failure", async () => {
    const { runtime, model, options } = streamFixture();
    const readerWaiting = Promise.withResolvers<void>();
    const closed = vi.fn();
    let signal: AbortSignal | undefined;
    model.streamText = async function* (request) {
      signal = request.abortSignal;
      try {
        yield { type: "text_delta", text: "first" };
        readerWaiting.resolve();
        await new Promise<void>((_, reject) => {
          signal!.addEventListener("abort", () => reject(new Error("reader aborted")), {
            once: true,
          });
        });
      } finally {
        closed();
      }
    };
    const request = runtime.runModelTextRequest({
      ...options,
      onStreamTextDelta() {
        throw new Error("consumer failed");
      },
    });
    await readerWaiting.promise;
    await expect(request).rejects.toThrow("consumer failed");
    expect(signal?.aborted).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("does not publish additional buffered tool calls after parent cancellation", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const abortController = new AbortController();
    const releaseWrite = Promise.withResolvers<void>();
    const allRead = Promise.withResolvers<void>();
    const onStreamToolCall = vi.fn();
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      return emit(...args);
    });
    model.streamText = async function* () {
      yield { type: "text_delta", text: "first" };
      yield { type: "tool_call", toolCall: { id: "first", name: "Read", input: {} } };
      yield { type: "tool_call", toolCall: { id: "buffered", name: "Read", input: {} } };
      setClock(1000);
      yield { type: "finish", finishReason: "tool-calls", usage: { outputTokens: 100 } };
      allRead.resolve();
    };
    const request = runtime.runModelTextRequest({
      ...options,
      abortSignal: abortController.signal,
      onStreamToolCall,
    });
    try {
      await allRead.promise;
      abortController.abort(new Error("user cancelled"));
    } finally {
      releaseWrite.resolve();
    }
    await expect(request).rejects.toThrow("user cancelled");
    expect(onStreamToolCall.mock.calls.flat().map((call) => call.id)).not.toContain("buffered");
  });

  it("bounds buffered large deltas by characters rather than only event count", async () => {
    const { runtime, model, options, setClock } = streamFixture();
    const releaseWrite = Promise.withResolvers<void>();
    let readCount = 0;
    const emit = runtime.emitModelStreamingEvent.bind(runtime);
    vi.spyOn(runtime, "emitModelStreamingEvent").mockImplementation(async (...args) => {
      await releaseWrite.promise;
      return emit(...args);
    });
    model.streamText = async function* () {
      yield { type: "text_delta", text: "first" };
      yield { type: "tool_call", toolCall: { id: "call", name: "Read", input: {} } };
      for (readCount = 0; readCount < 10; readCount += 1) {
        yield { type: "text_delta", text: "x".repeat(256 * 1024) };
      }
      setClock(1000);
      yield { type: "finish", finishReason: "stop", usage: { outputTokens: 100 } };
    };
    const request = runtime.runModelTextRequest(options);
    try {
      await vi.waitFor(() => expect(readCount).toBeGreaterThanOrEqual(1));
      expect(readCount).toBeLessThan(10);
    } finally {
      releaseWrite.resolve();
    }
    expect(await request).toMatchObject({
      outputGenerationUnavailableReason: "reader_backpressure",
    });
    expect(readCount).toBe(10);
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

  it("includes full streamed reasoning and keeps all provider usage intact", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const sessionId = createSessionId("output-speed-full-reasoning");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(
      sessionId,
      { modelStreaming: "on", titleGeneration: { enabled: false } },
      {
        eventStore,
        modelFactory: createTestModelFactory({
          async *streamText() {
            clock = 10_000; // 首 token 等待不计入；推理开始后 31 秒含回答。
            yield { type: "reasoning_delta", text: "complete reasoning" };
            clock = 40_000;
            yield { type: "text_delta", text: "answer" };
            clock = 41_000;
            yield {
              type: "finish",
              finishReason: "stop",
              reasoningOutput: "complete",
              usage: {
                inputTokens: 100,
                outputTokens: 3100,
                reasoningTokens: 3000,
                cacheReadTokens: 80,
              },
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
      cacheHit: { outputTokensPerSecond: 100, hitRate: 0.8 },
    });
    expect(complete?.payload).not.toHaveProperty("outputGenerationUnavailableReason");
    expect(complete?.payload).not.toHaveProperty("reasoningOutput");
  });

  it.each(["summary", "hidden", "unknown"] as const)(
    "marks %s reasoning unavailable even if reasoning usage is omitted",
    async (reasoningOutput) => {
      const { runtime, model, options, setClock } = streamFixture();
      model.streamText = async function* () {
        yield { type: "reasoning_delta", text: "summary" };
        setClock(1000);
        yield { type: "text_delta", text: "answer" };
        setClock(2000);
        yield {
          type: "finish",
          finishReason: "stop",
          reasoningOutput,
          usage: { outputTokens: 100 },
        };
      };
      expect(await runtime.runModelTextRequest(options)).toMatchObject({
        outputGenerationUnavailableReason: "unaligned_reasoning",
      });
    },
  );

  it.each([3101, -1, 0.5, NaN, Infinity])(
    "rejects invalid reasoning-token metadata at the timing owner (%s)",
    async (reasoningTokens) => {
      // 推理元数据的合法性只在 bounded reader 判定一次（result() 的 invalid_usage 分支）。
      // 这段覆盖原先挂在 recordMainTurnCacheHitUsage 上的用例，owner 收敛后随之搬家。
      const { runtime, model, options, setClock } = streamFixture();
      model.streamText = async function* () {
        yield { type: "text_delta", text: "answer" };
        setClock(1000);
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { outputTokens: 3100, reasoningTokens },
        };
      };
      expect(await runtime.runModelTextRequest(options)).toMatchObject({
        outputGenerationUnavailableReason: "invalid_usage",
      });
    },
  );

  it.each(["summary", "hidden", "unknown"] as const)(
    "keeps %s reasoning unavailable out of the persisted ModelComplete payload",
    async (reasoningOutput) => {
      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const sessionId = createSessionId(`output-speed-unavailable-${reasoningOutput}`);
      const eventStore = createTestSessionEventStore();
      const runtime = createTestAgentRuntime(
        sessionId,
        { modelStreaming: "on", titleGeneration: { enabled: false } },
        {
          eventStore,
          modelFactory: createTestModelFactory({
            async *streamText() {
              yield { type: "reasoning_delta", text: "summary" };
              clock = 1000;
              yield { type: "text_delta", text: "answer" };
              clock = 2000;
              yield {
                type: "finish",
                finishReason: "stop",
                reasoningOutput,
                usage: { inputTokens: 100, outputTokens: 100 },
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
        usage: { outputTokens: 100 },
        cacheHit: { outputTokensPerSecond: null },
      });
      // 不可测原因与推理来源都只在 runtime 内部保留，不进 ModelComplete / UI / 历史用量。
      // 这里必须走 executeTurn：直接调 runModelTextRequest 拿不到落库 payload，
      // 断言不到这条不外泄约束。
      expect(complete?.payload).not.toHaveProperty("outputGenerationUnavailableReason");
      expect(complete?.payload).not.toHaveProperty("reasoningOutput");
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
