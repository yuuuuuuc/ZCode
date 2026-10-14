import type { TextStreamPart, ToolSet } from "ai";
import type { ModelStreamEvent } from "@zcode/contracts";
import { asRecord } from "./runner-record.js";
import type { ResolvedAiSdkModel } from "./runner-runtime.js";

type FinishEvent = Extract<ModelStreamEvent, { type: "finish" }>;

/**
 * raw 推理证据的字符上限：超过即放弃升级为 complete，避免长流无界累积。
 * 与 core `model-output-timing.ts` 的 MAX_BUFFERED_CHARACTERS 数值相同但含义不同
 * （这里是证据上限，那里是 reader 缓冲预算），刻意不抽成跨包共享常量。
 */
const MAX_RAW_REASONING_CHARACTERS = 512 * 1024;

/**
 * 被认可「native thinking 即完整推理」的模型白名单。Anthropic 的 SSE 流里没有
 * 「这是摘要」的标记（摘要和完整推理都是 `thinking_delta`），所以只能按后端契约声明，
 * 不能用流内证据判定。未命中只会退化成 `unknown`（该请求不计速），不会算出偏快的数字。
 * 判据、证伪条件和核对记录见
 * apps/zcode-cli/docs/design/v2/model/reasoning-output-provenance.md。
 */
// Claude 3.7 Sonnet 的 thinking 由 Anthropic 文档保证原样返回；Claude 4+ 可能是摘要，
// 不能类推。带日期的正式 id 与 `-latest` 别名指向同一模型，都要覆盖。
const FULL_NATIVE_THINKING_MODEL = /^claude-3-7-sonnet(?:-20250219|-latest)?$/;
// 智谱 GLM 的 Anthropic-compatible 端点返回完整推理。该系列 id 常带 provider 前缀
// （`zai/glm-5.2`）、大小写变体和 `[1m]` 后缀，所以只判最后一段、忽略大小写。
const FULL_NATIVE_THINKING_GLM_MODEL = /^glm-/i;

function isFullNativeThinking(
  providerKind: ResolvedAiSdkModel["providerKind"],
  modelId: string,
): boolean {
  if (providerKind !== "anthropic") return false;
  if (FULL_NATIVE_THINKING_MODEL.test(modelId)) return true;
  const segments = modelId.split("/");
  return FULL_NATIVE_THINKING_GLM_MODEL.test(segments[segments.length - 1] ?? "");
}

export function createStreamReasoningProvenance(resolved: ResolvedAiSdkModel) {
  let rawReasoning = "";
  let sawRawReasoning = false;
  let sawReasoning = false;
  let incomplete = false;
  let redacted = false;
  const fullAnthropicThinking = isFullNativeThinking(
    resolved.providerKind,
    String(resolved.modelId),
  );

  return {
    observeRaw(chunk: TextStreamPart<ToolSet>): void {
      if (chunk.type !== "raw") return;
      const raw = asRecord(chunk.rawValue);
      const block = asRecord(raw.content_block);
      const nativeDelta = asRecord(raw.delta);
      if (block.type === "redacted_thinking") redacted = true;
      if (
        resolved.providerKind === "anthropic" &&
        ((block.type === "thinking" &&
          typeof block.thinking === "string" &&
          block.thinking.length > 0) ||
          (nativeDelta.type === "thinking_delta" &&
            typeof nativeDelta.thinking === "string" &&
            nativeDelta.thinking.length > 0))
      )
        sawRawReasoning = true;
      if (resolved.providerKind !== "openai-compatible") return;
      const choices = raw.choices;
      const delta = asRecord(asRecord(Array.isArray(choices) ? choices[0] : undefined).delta);
      // 修复原因：SDK 把 reasoning_content 和泛化 reasoning 都投影成同一种 delta。
      // 只有原始完整推理字段与归一化流逐字匹配才可升级，不能把摘要/未知来源误当完整推理。
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        sawRawReasoning = true;
        if (!incomplete) rawReasoning += delta.reasoning_content;
        if (rawReasoning.length > MAX_RAW_REASONING_CHARACTERS) {
          incomplete = true;
          rawReasoning = "";
        }
      } else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        sawRawReasoning = true;
        incomplete = true;
      }
    },
    observeEvent(event: ModelStreamEvent): void {
      if (
        (event.type === "reasoning_start" ||
          event.type === "reasoning_delta" ||
          event.type === "reasoning_end") &&
        asRecord(event.providerMetadata?.anthropic).redactedData !== undefined
      ) {
        redacted = true;
      }
      if (event.type !== "reasoning_delta" || event.text.length === 0) return;
      sawReasoning = true;
      if (resolved.providerKind === "openai-compatible") {
        if (!rawReasoning.startsWith(event.text)) incomplete = true;
        rawReasoning = incomplete ? "" : rawReasoning.slice(event.text.length);
      }
    },
    finish(event: FinishEvent): FinishEvent {
      let reasoningOutput: FinishEvent["reasoningOutput"];
      if (redacted || (!sawReasoning && (event.usage.reasoningTokens ?? 0) > 0)) {
        reasoningOutput = "hidden";
      } else if (!sawReasoning && sawRawReasoning) {
        // 修复原因：raw 已证明有推理，但可见流没有同口径起点；缺用量不能抹掉这条证据。
        reasoningOutput = "unknown";
      } else if (sawReasoning) {
        reasoningOutput =
          resolved.providerKind === "openai"
            ? "summary"
            : fullAnthropicThinking ||
                (resolved.providerKind === "openai-compatible" &&
                  !incomplete &&
                  rawReasoning.length === 0)
              ? "complete"
              : "unknown";
      }
      return reasoningOutput ? { ...event, reasoningOutput } : event;
    },
  };
}
