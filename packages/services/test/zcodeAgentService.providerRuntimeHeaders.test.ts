import { describe, expect, it, vi } from "vitest";
import {
  zcodeProtocolMethods,
  zcodeProviderRuntimeHeadersResponseSchema,
} from "@zcode/shared";

// ycode：账号凭据权威已移除，Host 对 provider runtime headers 请求按空应用兜底应答，
// 不得再返回 fail-closed 的 "Provider request auth is unavailable"。
const workspacePath = "/test/provider-runtime-headers";
const target = {
  workspacePath,
  sessionId: "sess-runtime-headers",
  requestId: "runtime-headers-1",
};

type RequestHandler = (request: { id: string; method: string; params?: unknown }) => void;

async function setup() {
  const handlers: RequestHandler[] = [];
  const respond = vi.fn(async (_id: string, _result: unknown) => undefined);
  const respondError = vi.fn(async (_id: string, _error: unknown) => undefined);
  const getClient = vi.fn(async () => ({
    request: vi.fn(),
    respond,
    respondError,
    transportKind: "stdio" as const,
    onNotification: () => ({ dispose() {} }),
    onRequest: (handler: RequestHandler) => {
      handlers.push(handler);
      return { dispose() {} };
    },
    onClose: () => ({ dispose() {} }),
  }));
  vi.resetModules();
  vi.doMock("../src/zcode-agent/zcodeAgentProcessManager.js", () => ({
    ZCodeAgentProcessManager: class {
      onRuntimeLifecycle() {
        return { dispose() {} };
      }
      onRuntimeRestarted() {
        return { dispose() {} };
      }
      markReady() {}
      getClient = getClient;
      disposeAll() {}
    },
  }));
  const { createZCodeAgentService } = await import("../src/zcode-agent/zcodeAgentService.js");
  const service = createZCodeAgentService({
    // initialize 需要通过 provider/model 启动门禁才会 wire client 的 onRequest。
    modelSelectionReadinessSource: {
      async getView() {
        return {
          revision: 1,
          providers: [
            {
              providerId: "3f0c9e2a-custom-provider",
              config: {
                kind: "api" as const,
                api: {
                  type: "openai-chat-completions" as const,
                  baseUrl: "https://api.deepseek.com",
                },
                models: ["deepseek-v4-flash"],
              },
              models: [{ modelId: "deepseek-v4-flash", config: {} }],
            },
          ],
        };
      },
    },
  });
  await service.initialize({ workspacePath });
  const fire = (extra: Record<string, unknown> = {}) => {
    const request = {
      id: "protocol-1",
      method: zcodeProtocolMethods.interactionRequestProviderRuntimeHeaders,
      params: {
        requestId: target.requestId,
        sessionId: target.sessionId,
        workspace: { workspacePath, workspaceKey: workspacePath },
        providerId: "3f0c9e2a-custom-provider",
        modelSelection: { providerId: "3f0c9e2a-custom-provider", modelId: "deepseek-v4-flash" },
        reason: "model-request",
        ...extra,
      },
    };
    for (const handler of handlers) handler(request);
  };
  return { service, fire, respond, respondError };
}

describe("Host 对 provider runtime headers 的无账号兜底应答", () => {
  it("api-key 供应商请求：成功空应用，不返回 fail-closed 错误", async () => {
    const { service, fire, respond } = await setup();
    try {
      fire();
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      const payload = respond.mock.calls[0]![1];
      expect(payload).toEqual({ headersApplied: true, requestAuth: {} });
      // 应答必须通过 CLI 侧响应 schema，否则旧 CLI 会按协议错误处理。
      expect(zcodeProviderRuntimeHeadersResponseSchema.safeParse(payload).success).toBe(true);
    } finally {
      service.disposeAll();
    }
  });

  it("带账号字段的旧版 CLI 请求：同样空应用，不阻断模型调用", async () => {
    const { service, fire, respond } = await setup();
    try {
      fire({
        accountAccess: {
          type: "zhipu-account",
          accountType: "zai",
          mode: "start-plan",
          entitled: true,
        },
      });
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(respond.mock.calls[0]![1]).toEqual({ headersApplied: true, requestAuth: {} });
    } finally {
      service.disposeAll();
    }
  });

  it("参数不合法时仍按协议错误应答", async () => {
    const { service, fire, respondError } = await setup();
    try {
      fire({ sessionId: "" });
      await vi.waitFor(() => expect(respondError).toHaveBeenCalledOnce());
      expect(respondError.mock.calls[0]![1].code).toBe(-32602);
    } finally {
      service.disposeAll();
    }
  });
});
