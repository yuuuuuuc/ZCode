import type { OfficialMcpAuthHeadersPort } from "@zcode/contracts";
import type { ZCodeWorkspaceRef } from "@zcode/shared";

/** Minimal context shape kept so entrypoint typechecks without coding-plan identity. */
export type OfficialMcpAuthRequestContext = {
  requestClient?: unknown;
};

/** Ycode: official MCP identity headers unavailable (no coding-plan / OAuth stack). */
export function createOfficialMcpAuthHeadersPort(_input: {
  resolveContext: () => OfficialMcpAuthRequestContext | undefined;
  resolveWorkspace: (input: {
    workspaceIdentity?: string;
    workspacePath?: string;
  }) => ZCodeWorkspaceRef | undefined;
}): OfficialMcpAuthHeadersPort {
  return {
    async resolveHeaders() {
      return { ok: false as const, reason: "official_auth_unavailable" as const };
    },
  };
}
