import { describe, expect, it } from "vitest";
import type { ModelStreamEvent } from "@zcode/contracts";
import type { AiSdkModelRuntime } from "../src/model/runner.js";
import { TestAiSdkModelAdapter, TestProviderConfigFixture } from "./test-provider-config.js";
import { executeAdapterStreamText } from "./test-adapter-model.js";

const CHUNK_GAP_MS = 100;

describe("deferred output lead", () => {
  it("backfills the hold before a pure tool stream is released", async () => {
    const events = await collect(paced(toolChunks(), CHUNK_GAP_MS));
    const finish = finishOf(events);

    expect(finish.deferredOutputLeadMs).toBeGreaterThanOrEqual(CHUNK_GAP_MS * 3);
    expect(withoutLead(events)).toEqual(expectedToolEvents());
  });

  it("omits the field when text arrives before tool input", async () => {
    const events = await collect(
      paced(
        [
          { type: "text-delta", id: "text-1", text: "hello" },
          ...toolChunks(),
        ],
        CHUNK_GAP_MS,
      ),
    );

    expect(events.findIndex((event) => event.type === "text_delta")).toBeLessThan(
      events.findIndex((event) => event.type === "tool_input_delta"),
    );
    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });

  it("omits the field when complete reasoning arrives first", async () => {
    const events = await collect(
      stream([
        { type: "reasoning-delta", id: "reasoning-1", text: "think" },
        ...toolChunks(),
      ]),
    );

    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });

  it("omits the field when only empty deltas were held", async () => {
    const events = await collect(
      paced(
        [
          { type: "start" },
          { type: "reasoning-delta", id: "sig", text: "" },
          { type: "tool-input-start", id: "call_1", toolName: "Read" },
          { type: "tool-input-delta", id: "call_1", delta: "" },
          { type: "tool-input-delta", id: "call_1", delta: "" },
          { type: "tool-input-delta", id: "call_1", delta: "" },
          { type: "tool-input-end", id: "call_1" },
          toolCallChunk(),
          { type: "finish", finishReason: "tool-calls", totalUsage: usage(2, 1) },
        ],
        CHUNK_GAP_MS,
      ),
    );

    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });

  it("does not carry a failed attempt's hold into the next attempt", async () => {
    const resetError = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    let attempts = 0;
    const runtime: AiSdkModelRuntime = {
      async generateText() {
        throw new Error("not used");
      },
      streamText() {
        attempts += 1;
        if (attempts === 1) {
          return {
            fullStream: streamThenFail(
              [
                { type: "start" },
                { type: "tool-input-start", id: "call_failed", toolName: "Read" },
                { type: "tool-input-delta", id: "call_failed", delta: '{"file_path":"a"}' },
              ],
              resetError,
              CHUNK_GAP_MS,
            ),
          } as never;
        }
        return {
          fullStream: stream([
            { type: "text-delta", id: "text-1", text: "done" },
            { type: "finish", finishReason: "stop", totalUsage: usage(1, 1) },
          ]),
        } as never;
      },
    };

    const events = await collectRuntime(runtime, {
      retry: { baseDelayMs: 0, jitter: false, maxAttempts: 2, maxDelayMs: 0 },
    });

    expect(attempts).toBe(2);
    expect(events.map((event) => event.type)).toEqual(["text_delta", "finish"]);
    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });

  it("omits the field when provider stream boundaries are preserved", async () => {
    const events = await collect(paced(toolChunks(), CHUNK_GAP_MS), {
      preserveProviderStreamBoundaries: true,
    });

    expect(events.map((event) => event.type)).toContain("tool_input_delta");
    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });

  it("omits the field on a synchronous tool stream", async () => {
    const events = await collect(stream(toolChunks()));

    expect(events).toEqual(expectedToolEvents());
    expect(finishOf(events)).not.toHaveProperty("deferredOutputLeadMs");
  });
});

function toolChunks(): unknown[] {
  return [
    { type: "start" },
    { type: "tool-input-start", id: "call_1", toolName: "Read" },
    { type: "tool-input-delta", id: "call_1", delta: '{"file_path":' },
    { type: "tool-input-delta", id: "call_1", delta: '"README.md"}' },
    { type: "tool-input-delta", id: "call_1", delta: "" },
    { type: "tool-input-delta", id: "call_1", delta: "" },
    { type: "tool-input-end", id: "call_1" },
    toolCallChunk(),
    { type: "finish", finishReason: "tool-calls", totalUsage: usage(2, 1) },
  ];
}

function toolCallChunk(): unknown {
  return {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "Read",
    input: { file_path: "README.md" },
  };
}

function expectedToolEvents(): ModelStreamEvent[] {
  return [
    { type: "start" },
    { type: "tool_input_start", id: "call_1", providerExecuted: undefined, toolName: "Read" },
    { type: "tool_input_delta", id: "call_1", delta: '{"file_path":' },
    { type: "tool_input_delta", id: "call_1", delta: '"README.md"}' },
    { type: "tool_input_delta", id: "call_1", delta: "" },
    { type: "tool_input_delta", id: "call_1", delta: "" },
    { type: "tool_input_end", id: "call_1" },
    {
      type: "tool_call",
      toolCall: { id: "call_1", input: { file_path: "README.md" }, name: "Read" },
    },
    {
      type: "finish",
      finishReason: "tool-calls",
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        reasoningTokens: undefined,
      },
    },
  ];
}

function finishOf(events: ModelStreamEvent[]): Extract<ModelStreamEvent, { type: "finish" }> {
  const finish = events.at(-1);
  expect(finish?.type).toBe("finish");
  return finish as Extract<ModelStreamEvent, { type: "finish" }>;
}

function withoutLead(events: ModelStreamEvent[]): ModelStreamEvent[] {
  return events.map((event) => {
    if (event.type !== "finish") return event;
    const { deferredOutputLeadMs: _lead, ...rest } = event;
    return rest;
  });
}

async function collect(
  fullStream: AsyncIterable<unknown>,
  request: { preserveProviderStreamBoundaries?: boolean } = {},
): Promise<ModelStreamEvent[]> {
  return collectRuntime(
    {
      async generateText() {
        throw new Error("not used");
      },
      streamText() {
        return { fullStream } as never;
      },
    },
    {},
    request,
  );
}

async function collectRuntime(
  runtime: AiSdkModelRuntime,
  adapter: { retry?: { baseDelayMs: number; jitter: boolean; maxAttempts: number; maxDelayMs: number } },
  request: { preserveProviderStreamBoundaries?: boolean } = {},
): Promise<ModelStreamEvent[]> {
  const model = new TestAiSdkModelAdapter({
    registry: new TestProviderConfigFixture({
      providers: {
        test: {
          kind: "custom",
          createLanguageModel: (modelId: string) => ({ modelId }) as never,
        },
      },
    }),
    runtime,
    ...adapter,
  });
  const events: ModelStreamEvent[] = [];
  for await (const event of executeAdapterStreamText(model, {
    providerId: "test" as never,
    modelId: "model-a" as never,
    messages: [{ role: "user", content: "Read README" }],
    preserveProviderStreamBoundaries: request.preserveProviderStreamBoundaries,
  })) {
    events.push(event);
  }
  return events;
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: undefined },
  };
}

async function* stream(chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

async function* paced(chunks: unknown[], gapMs: number) {
  for (const chunk of chunks) {
    await delay(gapMs);
    yield chunk;
  }
}

async function* streamThenFail(chunks: unknown[], error: unknown, gapMs: number) {
  for (const chunk of chunks) {
    await delay(gapMs);
    yield chunk;
  }
  throw error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
