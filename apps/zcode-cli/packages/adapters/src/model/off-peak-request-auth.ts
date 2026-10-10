import type { ModelRequestAuth } from "@zcode/contracts";

/** Ycode: off-peak auth refresh removed; callers must not rely on coding-plan PAT refresh. */
export async function refreshOffPeakRequestAuth(params: {
  auth: ModelRequestAuth;
  input?: unknown;
  accountAccess?: unknown;
  refresh?: unknown;
}): Promise<ModelRequestAuth> {
  void params.input;
  void params.accountAccess;
  void params.refresh;
  throw new Error("Off-peak request auth is unavailable in Ycode");
}
