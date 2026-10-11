import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostMessageTypes, HostResponseTypes } from "@zcode/shared";
import {
  disposeHostProcess,
  disposeHostProcessAndWait,
  listDisposingHostProcesses,
  loadWindow,
  spawnHostProcess,
} from "../src/main/desktopHostProcess.js";

vi.mock("../src/main/databaseStartupRelay.js", () => ({
  bindDatabaseStartupRelay: (_win: unknown, _child: unknown, startupId: string) => ({
    receive: vi.fn(),
    startupId,
  }),
}));

const electronMock = vi.hoisted(() => ({
  fork: vi.fn(),
  isPackaged: false,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  electronMock.isPackaged = false;
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/zcode-test"),
    get isPackaged() {
      return electronMock.isPackaged;
    },
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  MessageChannelMain: class {
    port1 = {};
    port2 = {};
  },
  utilityProcess: {
    fork: electronMock.fork,
  },
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}));

class MockUtilityProcess extends EventEmitter {
  pid: number | undefined = 12345;
  postMessage = vi.fn();
  kill = vi.fn(() => true);
}

describe("desktopHostProcess loadWindow", () => {
  it("生产包忽略继承的开发服务器地址并加载内置页面", async () => {
    electronMock.isPackaged = true;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5174");
    const window = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
    };

    await loadWindow(window as never);

    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledOnce();
  });
});

describe("desktopHostProcess CUA operation state routing", () => {
  it("routes schema-validated Agent exceptions without changing task or process registration", () => {
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const onAgentProcessException = vi.fn();
    spawnHostProcess(
      { id: 7, webContents: { id: 11, postMessage: vi.fn() } } as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "/repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
        onAgentProcessException,
      },
    );
    const event = {
      type: "agent-process-exception",
      pid: 123,
      provider: "glm",
      workspacePath: "/repo",
      runtimeGeneration: 1,
      runtimeInstanceId: "agent-test",
      diagnostic: {
        version: 1,
        errorId: "1f51b7dc-c52a-46ad-bc97-d2f984e6e3de",
        kind: "uncaughtException",
        origin: "uncaughtException",
        name: "Error",
        message: "probe",
        occurredAt: 123,
      },
    };
    const init = child.postMessage.mock.calls[0]![0];
    expect(init.databaseStartupId).toEqual(expect.any(String));
    child.emit("message", { ...event, diagnostic: { ...event.diagnostic, version: 2 } });
    expect(onAgentProcessException).not.toHaveBeenCalled();
    child.emit("message", event);
    expect(onAgentProcessException).toHaveBeenCalledExactlyOnceWith(event);
    child.emit("exit", 0);
  });
  it("routes valid state with its Host source and clears the source on exit", () => {
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const onCuaOperationStateChanged = vi.fn();
    const onCuaOperationStateSourceExited = vi.fn();
    const win = {
      id: 7,
      webContents: {
        id: 11,
        postMessage: vi.fn(),
      },
    };

    spawnHostProcess(
      win as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "C:\\repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
        onCuaOperationStateChanged,
        onCuaOperationStateSourceExited,
      },
    );

    const initStartupId = child.postMessage.mock.calls[0]![0].databaseStartupId;
    expect(win.webContents.postMessage.mock.calls[0]![1]).toEqual({
      databaseStartupId: initStartupId,
    });
    const state = {
      type: HostResponseTypes.CuaOperationState,
      active: true,
      sessionId: "sess-1",
      turnId: "turn-1",
      workspacePath: "C:\\repo",
    };
    child.emit("message", state);

    expect(onCuaOperationStateChanged).toHaveBeenCalledWith(child, state);

    child.emit("message", { ...state, sessionId: "" });
    expect(onCuaOperationStateChanged).toHaveBeenCalledTimes(1);

    child.emit("exit", 0);
    expect(onCuaOperationStateSourceExited).toHaveBeenCalledOnce();
    expect(onCuaOperationStateSourceExited).toHaveBeenCalledWith(child);
  });
});

describe("desktopHostProcess local media preview authorization", () => {
  it("returns the canonical path produced by Main to the requesting Host", async () => {
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const authorizeLocalMediaPreviewPath = vi.fn(async () => "/real/video.mp4");
    const win = {
      id: 7,
      webContents: {
        id: 11,
        postMessage: vi.fn(),
      },
    };

    spawnHostProcess(
      win as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "/repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
        authorizeLocalMediaPreviewPath,
      },
    );

    child.emit("message", {
      type: HostResponseTypes.LocalMediaPreviewPathAuthorizeRequest,
      requestId: "preview-request-1",
      path: "/linked/video.mp4",
    });

    await vi.waitFor(() => {
      expect(authorizeLocalMediaPreviewPath).toHaveBeenCalledWith("/linked/video.mp4");
      expect(child.postMessage).toHaveBeenCalledWith({
        type: HostMessageTypes.LocalMediaPreviewPathAuthorizeResult,
        requestId: "preview-request-1",
        ok: true,
        path: "/real/video.mp4",
      });
    });
  });
});

describe("desktopHostProcess host 自采资源样本", () => {
  it("把 Host 自采样本交给资源遥测来源，非法样本在 main 入口丢弃", async () => {
    const { selfHeapProcessResourceSampleSource } =
      await import("../src/main/processResourceSelfHeapSource.js");
    selfHeapProcessResourceSampleSource.reset?.();
    const child = new MockUtilityProcess();
    electronMock.fork.mockReturnValue(child);
    const win = { id: 7, webContents: { id: 11, postMessage: vi.fn() } };

    spawnHostProcess(
      win as never,
      "local-window",
      { type: HostMessageTypes.InitLocal, workspacePath: "/repo" },
      {
        hostProcessLocalEnv: {},
        logger: { info: vi.fn(), warn: vi.fn() },
        broadcastHub: { register: vi.fn(), unregister: vi.fn() } as never,
        windowHostProcessMap: new Map(),
        hostRunningTaskCountMap: new Map(),
      },
    );

    // 字段缺失与类型错误的样本被 host 响应 schema 拒绝，不抛错也不进窗口。
    expect(() =>
      child.emit("message", {
        type: HostResponseTypes.HostResourceSample,
        sample: { cpuPercent: 1, rssKb: 380_000 },
      }),
    ).not.toThrow();
    expect(() =>
      child.emit("message", {
        type: HostResponseTypes.HostResourceSample,
        sample: { cpuPercent: 1, rssKb: 380_000, heapUsedKb: "92160" },
      }),
    ).not.toThrow();
    child.emit("message", {
      type: HostResponseTypes.HostResourceSample,
      sample: { cpuPercent: 1, rssKb: 380_000, heapUsedKb: 92_160 },
    });

    const heapSamples: Array<[string, number]> = [];
    selfHeapProcessResourceSampleSource.sample?.({
      now: 0,
      addRoleSample: () => {},
      addRoleHeapSample: (role, heapUsedKb) => heapSamples.push([role, heapUsedKb]),
      addAppProcessTotals: () => {},
    });

    expect(heapSamples).toEqual([["host", 92_160]]);
    child.emit("exit", 0);
  });
});

describe("desktopHostProcess disposeHostProcessAndWait", () => {
  it("fire-and-forget 回收中的 Host 保留到 exit，供 app barrier 接管", () => {
    const child = new MockUtilityProcess();
    const timers = new WeakMap();
    const logger = { info: vi.fn(), warn: vi.fn() };

    disposeHostProcess(child as never, "window-closed", timers, logger, 10_000);
    expect(listDisposingHostProcesses()).toContain(child);

    child.emit("exit", 0);
    expect(listDisposingHostProcesses()).not.toContain(child);
  });

  it("运行中的 Electron UtilityProcess 没有 exitCode 时仍会发送 Dispose 并等待退出", async () => {
    const child = new MockUtilityProcess();
    const timers = new WeakMap();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    let resolved = false;

    const promise = disposeHostProcessAndWait(child as never, "app-before-quit-1", timers, logger, {
      forceKillDelayMs: 10_000,
      waitTimeoutMs: 10_000,
    }).then(() => {
      resolved = true;
    });

    expect(child.postMessage).toHaveBeenCalledTimes(1);
    expect(child.postMessage).toHaveBeenCalledWith({ type: HostMessageTypes.Dispose });

    await Promise.resolve();
    expect(resolved).toBe(false);

    child.pid = undefined;
    child.emit("exit", 0);

    await promise;
    expect(resolved).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("已观察到退出的 Electron UtilityProcess 不再重复发送 Dispose", async () => {
    const child = new MockUtilityProcess();

    const timers = new WeakMap();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const firstDispose = disposeHostProcessAndWait(child as never, "first-dispose", timers, logger);

    child.pid = undefined;
    child.emit("exit", 0);
    await firstDispose;

    await disposeHostProcessAndWait(child as never, "already-exited", timers, logger);

    expect(child.postMessage).toHaveBeenCalledTimes(1);
  });
});
