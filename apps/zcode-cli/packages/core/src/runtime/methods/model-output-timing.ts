import type { ModelStreamEvent } from "../deps.js";
import type { RuntimeModelTextResult } from "../types.js";

type OutputTiming = Pick<
  RuntimeModelTextResult,
  "outputGenerationDurationMs" | "outputGenerationUnavailableReason"
>;

// 缓冲只存事件引用；大 delta 同时占用字符预算，避免高频或超长流无界 read-ahead。
// 与 adapter `stream-reasoning-provenance.ts` 的 MAX_RAW_REASONING_CHARACTERS 数值相同但
// 含义不同（这里是 reader 缓冲预算，那里是 raw 推理证据上限），刻意不抽成跨包共享常量。
const MAX_BUFFERED_EVENTS = 128;
const MAX_BUFFERED_CHARACTERS = 512 * 1024;

export function createTimedModelStream(
  source: AsyncIterable<ModelStreamEvent>,
  abortController: AbortController,
  signal: AbortSignal,
) {
  let firstOutputAt: number | undefined;
  let finishAt: number | undefined;
  let sawReasoning = false;
  let readBlocked = false;
  let finish: Extract<ModelStreamEvent, { type: "finish" }> | undefined;

  function observe(event: ModelStreamEvent): void {
    const characters = outputCharacters(event);
    if (characters > 0 && firstOutputAt === undefined) {
      firstOutputAt = performance.now();
    }
    if (event.type === "reasoning_delta" && characters > 0) sawReasoning = true;
    if (event.type === "finish") {
      finishAt = performance.now();
      finish = event;
    }
  }

  return {
    async *events(): AsyncGenerator<ModelStreamEvent> {
      const iterator = source[Symbol.asyncIterator]();
      const buffer: ModelStreamEvent[] = [];
      let bufferedCharacters = 0;
      let done = false;
      let sourceCompleted = false;
      let propagatingFailure = false;
      let stopped = false;
      let failed = false;
      let failure: unknown;
      let wakeReader: (() => void) | undefined;
      let wakeProducer: (() => void) | undefined;
      const wakeOnAbort = () => {
        wakeReader?.();
        wakeProducer?.();
      };
      const assertNotAborted = () => {
        if (signal.aborted) throw signal.reason ?? new Error("Model stream aborted.");
      };
      signal.addEventListener("abort", wakeOnAbort, { once: true });

      // 修复原因：tool commit 的 drain 必须保持，但不能让磁盘等待冒充生成时间。
      // 单一 reader 独立采样，业务侧仍按原顺序消费；只有 reader 真正等缓冲空间才失效。
      const producer = (async () => {
        try {
          while (!stopped) {
            assertNotAborted();
            if (
              buffer.length >= MAX_BUFFERED_EVENTS ||
              bufferedCharacters >= MAX_BUFFERED_CHARACTERS
            ) {
              // 即使满发生在首 delta 之前，也可能延迟随后首 token，不能缩短分母高估速度。
              if (finishAt === undefined) readBlocked = true;
              await new Promise<void>((resolve) => {
                wakeProducer = resolve;
              });
              continue;
            }
            const next = await iterator.next();
            sourceCompleted = next.done === true;
            if (stopped || sourceCompleted) break;
            observe(next.value);
            buffer.push(next.value);
            bufferedCharacters += outputCharacters(next.value);
            wakeReader?.();
            wakeReader = undefined;
          }
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          done = true;
          wakeReader?.();
          wakeReader = undefined;
        }
      })();

      // 修复原因：自然 EOF 与 for-await 语义一致，不二次关闭；清理也不能覆盖原始读流错误。
      const closeSource = async () => {
        if (sourceCompleted) return;
        try {
          await iterator.return?.();
        } catch (error) {
          if (!propagatingFailure) throw error;
        }
      };

      try {
        for (;;) {
          // 用户取消不能因 read-ahead 多提交工具或输出；已取出的业务事件仍走原有 drain。
          assertNotAborted();
          if (buffer.length === 0) {
            if (done) {
              // 不用 rejected promise / controller.error 清空已读事件，保留 partial/tool 边界顺序。
              if (failed) throw failure;
              return;
            }
            await new Promise<void>((resolve) => {
              wakeReader = resolve;
            });
            continue;
          }
          const event = buffer.shift()!;
          bufferedCharacters -= outputCharacters(event);
          wakeProducer?.();
          wakeProducer = undefined;
          yield event;
        }
      } catch (error) {
        propagatingFailure = true;
        throw error;
      } finally {
        stopped = true;
        signal.removeEventListener("abort", wakeOnAbort);
        wakeProducer?.();
        if (!done) abortController.abort();
        await producer;
        await closeSource();
      }
    },
    result(): OutputTiming {
      let reason: RuntimeModelTextResult["outputGenerationUnavailableReason"];
      const reasoningTokens = finish?.usage.reasoningTokens;
      const outputTokens = finish?.usage.outputTokens;
      if (!finish || finishAt === undefined) reason = "missing_finish";
      else if (readBlocked) reason = "reader_backpressure";
      else if (!Number.isSafeInteger(outputTokens) || (outputTokens ?? 0) <= 0)
        reason = "invalid_usage";
      else if (
        reasoningTokens !== undefined &&
        (!Number.isSafeInteger(reasoningTokens) ||
          reasoningTokens < 0 ||
          (outputTokens !== undefined && reasoningTokens > outputTokens))
      )
        reason = "invalid_usage";
      else if (
        finish.reasoningOutput === "hidden" ||
        finish.reasoningOutput === "summary" ||
        finish.reasoningOutput === "unknown" ||
        ((reasoningTokens ?? 0) > 0 && !sawReasoning) ||
        (sawReasoning && finish.reasoningOutput !== "complete")
      )
        reason = "unaligned_reasoning";
      else if (firstOutputAt === undefined) reason = "missing_output";
      else {
        const duration = finishAt - firstOutputAt;
        if (Number.isFinite(duration) && duration > 0) {
          return { outputGenerationDurationMs: duration };
        }
        reason = "invalid_duration";
      }
      return { outputGenerationUnavailableReason: reason };
    },
  };
}

function outputCharacters(event: ModelStreamEvent): number {
  if (event.type === "text_delta" || event.type === "reasoning_delta") return event.text.length;
  if (event.type === "tool_input_delta") return event.delta.length;
  return 0;
}
