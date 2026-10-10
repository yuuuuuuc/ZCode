import type { RequestVerificationProof } from "@zcode/shared";

export function useRequestVerificationPrewarm(_visible: boolean): void {}

/** Ycode: coding-plan subscription verification removed. */
export async function prepareRequestVerificationClaim(
  _service: unknown,
  signal: AbortSignal,
  _onVerifying: () => void,
): Promise<RequestVerificationProof | undefined> {
  signal.throwIfAborted();
  return {};
}
