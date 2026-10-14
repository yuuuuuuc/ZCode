import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextStreamPart, ToolSet } from "ai";
import type { ModelStreamEvent } from "@zcode/contracts";
import { createStreamReasoningProvenance } from "../src/model/stream-reasoning-provenance.js";
import type { ResolvedAiSdkModel } from "../src/model/runner-runtime.js";
import { TestAiSdkModelAdapter, TestProviderConfigFixture } from "./test-provider-config.js";
import { executeAdapterStreamText } from "./test-adapter-model.js";

afterEach(() => vi.unstubAllGlobals());

type Finish = Extract<ModelStreamEvent, { type: "finish" }>;
const finish: Finish = {
  type: "finish",
  finishReason: "stop",
  usage: { outputTokens: 3100, reasoningTokens: 3000 },
};

function fixture(
  providerKind: ResolvedAiSdkModel["providerKind"] = "openai-compatible",
  modelId = "test",
) {
  return createStreamReasoningProvenance({ providerKind, modelId } as ResolvedAiSdkModel);
}

function raw(delta: Record<string, unknown>): TextStreamPart<ToolSet> {
  return { type: "raw", rawValue: { choices: [{ delta }] } };
}

describe("stream reasoning provenance", () => {
  it("requires exact raw full-reasoning evidence for every normalized delta", () => {
    const provenance = fixture();
    provenance.observeRaw(raw({ reasoning_content: "firstsecond" }));
    provenance.observeEvent({ type: "reasoning_delta", text: "first" });
    provenance.observeEvent({ type: "reasoning_delta", text: "second" });
    expect(provenance.finish(finish).reasoningOutput).toBe("complete");
  });

  it.each(["no-raw", "fallback", "mismatch", "mixed", "unconsumed", "oversized"])(
    "does not upgrade %s compatible reasoning to complete",
    (scenario) => {
      const provenance = fixture();
      if (scenario !== "no-raw") {
        provenance.observeRaw(
          raw(
            scenario === "fallback"
              ? { reasoning: "summary" }
              : {
                  reasoning_content: scenario === "oversized" ? "x".repeat(512 * 1024 + 1) : "full",
                },
          ),
        );
      }
      provenance.observeEvent({
        type: "reasoning_delta",
        text: scenario === "mismatch" ? "same" : "full",
      });
      if (scenario === "mixed")
        provenance.observeEvent({ type: "reasoning_delta", text: "summary" });
      if (scenario === "unconsumed") provenance.observeRaw(raw({ reasoning_content: "extra" }));
      expect(provenance.finish(finish).reasoningOutput).toBe("unknown");
    },
  );

  it("distinguishes OpenAI summaries from full output", () => {
    const provenance = fixture("openai");
    provenance.observeEvent({ type: "reasoning_delta", text: "summary" });
    expect(provenance.finish(finish).reasoningOutput).toBe("summary");
  });

  it.each(["claude-3-7-sonnet", "claude-3-7-sonnet-20250219", "claude-3-7-sonnet-latest"])(
    "allows documented full native thinking for %s",
    (modelId) => {
      const provenance = fixture("anthropic", modelId);
      provenance.observeEvent({ type: "reasoning_delta", text: "native thinking" });
      expect(provenance.finish(finish).reasoningOutput).toBe("complete");
    },
  );

  it.each(["claude-sonnet-4-5", "claude-3-7-sonnet-custom", "qwen3-max", "glm"])(
    "does not guess full Anthropic thinking from %s",
    (modelId) => {
      const provenance = fixture("anthropic", modelId);
      provenance.observeEvent({ type: "reasoning_delta", text: "possibly summarized" });
      expect(provenance.finish(finish).reasoningOutput).toBe("unknown");
    },
  );

  // GLM 的 Anthropic-compatible 端点返回完整推理（依据见
  // docs/design/v2/model/reasoning-output-provenance.md）；id 的大小写、provider 前缀
  // 和日期/1m 别名都要覆盖。
  it.each(["glm-5.2", "glm-5.2-pro", "GLM-4.6", "zai/glm-5.2", "glm-0528", "glm-0528[1m]"])(
    "allows documented full native thinking for %s",
    (modelId) => {
      const provenance = fixture("anthropic", modelId);
      provenance.observeEvent({ type: "reasoning_delta", text: "native thinking" });
      expect(provenance.finish(finish).reasoningOutput).toBe("complete");
    },
  );

  it.each([
    ["openai", "summary"],
    ["openai-compatible", "unknown"],
  ] as const)("keeps the native thinking allowlist Anthropic-only on %s", (providerKind, expected) => {
    const provenance = fixture(providerKind, "glm-5.2");
    provenance.observeEvent({ type: "reasoning_delta", text: "thinking" });
    expect(provenance.finish(finish).reasoningOutput).toBe(expected);
  });

  it.each([
    ["raw", "claude-3-7-sonnet"],
    ["metadata", "claude-3-7-sonnet"],
    ["raw", "glm-5.2"],
    ["metadata", "glm-5.2"],
  ] as const)("redaction overrides otherwise complete thinking (%s on %s)", (source, modelId) => {
    const provenance = fixture("anthropic", modelId);
    provenance.observeEvent({ type: "reasoning_delta", text: "visible part" });
    if (source === "raw")
      provenance.observeRaw({
        type: "raw",
        rawValue: { type: "content_block_start", content_block: { type: "redacted_thinking" } },
      });
    else
      provenance.observeEvent({
        type: "reasoning_start",
        id: "redacted",
        providerMetadata: { anthropic: { redactedData: "opaque" } },
      });
    expect(provenance.finish({ ...finish, usage: { outputTokens: 3100 } }).reasoningOutput).toBe(
      "hidden",
    );
  });

  it("classifies reasoning usage without reasoning output as hidden and leaves plain text unchanged", () => {
    const provenance = fixture();
    expect(provenance.finish(finish).reasoningOutput).toBe("hidden");
    const plain: Finish = { type: "finish", finishReason: "stop", usage: { outputTokens: 100 } };
    expect(provenance.finish(plain)).toBe(plain);
  });

  it.each(["reasoning_content", "reasoning"])(
    "does not lose raw-only %s evidence when reasoning usage is omitted or zero",
    (field) => {
      for (const reasoningTokens of [undefined, 0]) {
        const provenance = fixture();
        provenance.observeRaw(raw({ [field]: "unobserved thinking" }));
        provenance.observeEvent({ type: "text_delta", text: "answer" });
        expect(
          provenance.finish({ ...finish, usage: { outputTokens: 3100, reasoningTokens } })
            .reasoningOutput,
        ).toBe("unknown");
      }
    },
  );

  it.each([
    ["content_block_start", "claude-3-7-sonnet"],
    ["content_block_delta", "claude-3-7-sonnet"],
    ["content_block_start", "glm-5.2"],
    ["content_block_delta", "glm-5.2"],
  ] as const)(
    "does not upgrade raw-only native thinking at %s on %s even on the allowlist",
    (type, modelId) => {
      const provenance = fixture("anthropic", modelId);
      provenance.observeRaw({
        type: "raw",
        rawValue:
          type === "content_block_start"
            ? { type, content_block: { type: "thinking", thinking: "unobserved thinking" } }
            : { type, delta: { type: "thinking_delta", thinking: "unobserved thinking" } },
      });
      expect(provenance.finish({ ...finish, usage: { outputTokens: 3100 } }).reasoningOutput).toBe(
        "unknown",
      );
    },
  );

  it.each(["reasoning_content", "reasoning"])(
    "carries provenance through the real SDK/adapter wire stream (%s)",
    async (field) => {
      const chunks = [
        { choices: [{ index: 0, delta: { [field]: "thinking" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 3100,
            total_tokens: 3200,
            completion_tokens_details: { reasoning_tokens: 3000 },
          },
        },
      ];
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            [
              ...chunks.map(
                (chunk) => `data: ${JSON.stringify({ id: "test", model: "test", ...chunk })}`,
              ),
              "data: [DONE]",
              "",
            ].join("\n\n"),
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      const adapter = new TestAiSdkModelAdapter({
        registry: new TestProviderConfigFixture({
          env: {},
          providers: {
            compatible: {
              kind: "openai-compatible",
              apiKey: "test-key",
              baseURL: "https://api.example.test/v1",
            },
          },
        }),
      });
      const events: ModelStreamEvent[] = [];
      for await (const event of executeAdapterStreamText(adapter, {
        providerId: "compatible" as never,
        modelId: "test" as never,
        messages: [{ role: "user", content: "hello" }],
      }))
        events.push(event);
      expect(events.find((event) => event.type === "finish")).toMatchObject({
        reasoningOutput: field === "reasoning_content" ? "complete" : "unknown",
        usage: { outputTokens: 3100, reasoningTokens: 3000 },
      });
      expect(events.some((event) => event.type === "reasoning_delta")).toBe(true);
      expect(events.some((event) => String(event.type) === "raw")).toBe(false);
      expect(events.some((event) => event.type === "compact_stream_boundary")).toBe(false);
    },
  );
});
