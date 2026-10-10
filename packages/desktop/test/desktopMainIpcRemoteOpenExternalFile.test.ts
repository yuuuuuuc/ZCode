import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels } from "@zcode/shared";

type IpcHandler = (...args: unknown[]) => unknown;
type RemoteIpcOptions = Parameters<
  typeof import("../src/main/desktopMainIpcRemote.js").registerRemoteIpcHandlers
>[0];

const h = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  listeners: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn(),
  registerWebRemoteControlIpcHandlers: vi.fn(),
  shellOpenExternal: vi.fn(),
  shellOpenPath: vi.fn(),
  configureRemoteUsageArmsTelemetry: vi.fn(),
  reportRemoteConnectResultToArms: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: h.fromWebContents,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => h.handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => h.listeners.set(channel, handler)),
  },
  shell: {
    openExternal: h.shellOpenExternal,
    openPath: h.shellOpenPath,
  },
}));

vi.mock("../src/main/desktopNotifications.js", () => ({
  dispatchTaskNotification: vi.fn(),
}));

vi.mock("../src/main/desktopOAuthDeepLink.js", () => ({
  clearOAuthRoutesForWindow: vi.fn(),
  clearPendingRoutesForWindow: vi.fn(),
  deliverPendingDeepLink: vi.fn(() => false),
  parseOAuthStateRegistration: vi.fn(),
  registerOAuthState: vi.fn(),
}));

vi.mock("../src/main/desktopArmsCustomEvent.js", () => ({
  createFinalArmsCustomEventE2EController: vi.fn(),
  dispatchFinalArmsCustomEvent: vi.fn(),
}));

vi.mock("../src/main/desktopWebRemoteControlIpc.js", () => ({
  registerWebRemoteControlIpcHandlers: h.registerWebRemoteControlIpcHandlers,
}));

vi.mock("../src/main/desktopRemoteUsageArmsTelemetry.js", () => ({
  configureRemoteUsageArmsTelemetry: h.configureRemoteUsageArmsTelemetry,
  reportRemoteConnectResultToArms: h.reportRemoteConnectResultToArms,
}));

function createOptions(): RemoteIpcOptions {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    appTelemetryRuntime: {
      onRendererReady: vi.fn(),
      syncRendererContext: vi.fn(),
      onOAuthCallbackHandled: vi.fn(),
    },
    appTelemetryCore: {
      reportEvent: vi.fn(async () => {}),
    },
    reportRemoteUsageEvent: vi.fn(),
    armsCustomContext: {
      deviceMid: "device-mid",
      platform: "darwin",
      appVersion: "1.0.0",
      armsEnv: "local",
    },
    webRemoteControlManager: {} as RemoteIpcOptions["webRemoteControlManager"],
    confirmRendererAttachmentReady: vi.fn(),
    connectRemoteWorkspace: vi.fn(async () => ({ ok: true })),
    cancelPendingRemoteWorkspaceSessionsForWindow: vi.fn(),
    bindRemoteWorkspaceSessionContext: vi.fn(async () => {}),
    disposeRemoteWorkspaceSession: vi.fn(),
    getRemoteConnectionStatus: vi.fn(async () => ({ kind: "idle" })),
    isDockerDaemonAvailable: vi.fn(async () => true),
    listAvailableWSLDistros: vi.fn(async () => []),
    listAvailableDockerContainers: vi.fn(async () => []),
    listSSHConfigAliases: vi.fn(async () => []),
  };
}

async function registerOpenExternalListener() {
  const { registerRemoteIpcHandlers } = await import("../src/main/desktopMainIpcRemote.js");
  const options = createOptions();
  registerRemoteIpcHandlers(options);
  const listener = h.listeners.get(PlatformChannels.OpenExternal);
  expect(listener).toBeDefined();
  return { listener: listener!, options };
}

describe("OpenExternal URL 放行", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.listeners.clear();
    h.fromWebContents.mockReset();
    h.shellOpenExternal.mockReset().mockResolvedValue(undefined);
    h.shellOpenPath.mockReset().mockResolvedValue("");
  });

  it("http URL 走 shell.openExternal", async () => {
    const { listener } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "https://example.com/docs");

    await vi.waitFor(() => expect(h.shellOpenExternal).toHaveBeenCalledTimes(1));
    expect(h.shellOpenExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("file URL 同样走 shell.openExternal（Ycode 简化分流）", async () => {
    const { listener } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "file:///tmp/report.html");

    await vi.waitFor(() => expect(h.shellOpenExternal).toHaveBeenCalledTimes(1));
    expect(h.shellOpenExternal).toHaveBeenCalledWith("file:///tmp/report.html");
    expect(h.shellOpenPath).not.toHaveBeenCalled();
  });

  it("非 http/https/file 协议被拦截并 warn", async () => {
    const { listener, options } = await registerOpenExternalListener();
    const sender = { getURL: vi.fn(() => "about:blank") };

    listener({ sender }, "javascript:alert(1)");

    await vi.waitFor(() => expect(options.logger.warn).toHaveBeenCalled());
    expect(h.shellOpenExternal).not.toHaveBeenCalled();
    expect(h.shellOpenPath).not.toHaveBeenCalled();
  });
});
