import type { ModelStreamEvent } from "@zcode/contracts";

type FinishEvent = Extract<ModelStreamEvent, { type: "finish" }>;

/**
 * 同步内存流里，暂存和放出之间只有事件循环微任务，跨度远小于 1ms。
 * 把这段开销写进 finish 会扰动既有快照，对 tok/s 也没有意义。
 */
const MIN_REPORTABLE_LEAD_MS = 1;

/**
 * 每次 attempt 一个跟踪器。只记录「首个非空输出从到达到放出」的相对时长，
 * 不计算速度，也不判定可测性；计时 owner 仍是 core `createTimedModelStream`。
 */
export function createDeferredOutputTiming() {
  let outputReleased = false;
  let heldSince: number | undefined;
  let leadMs: number | undefined;

  return {
    /** 事件被放入 pendingRetrySafeEvents 时调用。 */
    onHeld(event: ModelStreamEvent): void {
      if (outputReleased || heldSince !== undefined) return;
      if (hasOutputCharacters(event)) heldSince = performance.now();
    },
    /** 任一事件被 yield 给 core 前调用（含 pending 冲刷出的事件）。 */
    onReleased(event: ModelStreamEvent): void {
      if (outputReleased || !hasOutputCharacters(event)) return;
      outputReleased = true;
      if (heldSince === undefined) return;
      const elapsed = Math.max(0, performance.now() - heldSince);
      if (elapsed >= MIN_REPORTABLE_LEAD_MS) leadMs = elapsed;
    },
    finish(event: FinishEvent): FinishEvent {
      if (leadMs === undefined || leadMs <= 0) return event;
      return { ...event, deferredOutputLeadMs: leadMs };
    },
  };
}

/** 与 core `outputCharacters` 同口径：空 delta（签名占位）不算输出。 */
function hasOutputCharacters(event: ModelStreamEvent): boolean {
  if (event.type === "text_delta" || event.type === "reasoning_delta") return event.text.length > 0;
  if (event.type === "tool_input_delta") return event.delta.length > 0;
  return false;
}
