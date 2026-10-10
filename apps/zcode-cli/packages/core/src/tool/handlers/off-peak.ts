import { CoreErrorType, createCoreError } from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";

/** Ycode: off-peak product removed; keep assert helper for workflow handler compile. */
export function assertNotOffPeakTurn(
  context: ToolExecutionContext,
  _toolName?: string,
  options?: { hint?: string; recoverable?: boolean },
): void {
  if (context.offPeakTurn) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      options?.hint ?? "Off-peak turns are unavailable in Ycode.",
      { recoverable: options?.recoverable ?? false },
    );
  }
}
