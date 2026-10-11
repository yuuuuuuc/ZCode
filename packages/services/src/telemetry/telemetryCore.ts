/**
 * 设备身份（deviceMid）的唯一写入入口。
 *
 * 官方事件上报（createTelemetryCore / /event/report）已移除。这里只保留
 * telemetry-state.json 的锁和 deviceMid：远端 workspace 的 billing 请求靠
 * buildZCodeSourceHeaders() 读同一个字段写 X-Device-Mid。整文件删掉会让远程计费变成 parameter error。
 */
import { createUuid } from "@zcode/shared";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "../paths.js";

const LOCK_RETRY_DELAY_MS = 10;
const LOCK_RETRY_COUNT = 200;
const LOCK_STALE_MS = 5 * 60 * 1000;

interface TelemetryState {
  lastDailyActiveDate?: string;
  deviceMid?: string;
  dailyActiveInFlight?: {
    date: string;
    startedAt: number;
  };
}

interface TelemetryLockOwner {
  pid: number;
  createdAt: number;
}

const deviceMidCacheByStateFile = new Map<string, Promise<string>>();

function resolveTelemetryStateFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.json");
  }
  return join(getAppConfigDir(), "telemetry-state.json");
}

function resolveTelemetryLockFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.lock");
  }
  return join(getAppConfigDir(), "telemetry-state.lock");
}

async function readTelemetryState(homeDir?: string): Promise<TelemetryState> {
  try {
    const raw = await readFile(resolveTelemetryStateFile(homeDir), "utf-8");
    const parsed = JSON.parse(raw) as TelemetryState;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeTelemetryState(state: TelemetryState, homeDir?: string): Promise<void> {
  const telemetryStateFile = resolveTelemetryStateFile(homeDir);
  await mkdir(dirname(telemetryStateFile), { recursive: true });
  await writeFile(telemetryStateFile, JSON.stringify(state, null, 2), "utf-8");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleTelemetryLockIfNeeded(
  lockFile: string,
  timestamp: number,
): Promise<boolean> {
  try {
    const metadata = await stat(lockFile);
    if (timestamp - metadata.mtimeMs < LOCK_STALE_MS) {
      const owner = await readTelemetryLockOwner(lockFile);
      if (!owner || isProcessAlive(owner.pid)) {
        return false;
      }
    }

    await unlink(lockFile).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readTelemetryLockOwner(lockFile: string): Promise<TelemetryLockOwner | null> {
  try {
    const raw = await readFile(lockFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TelemetryLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ESRCH"
    );
  }
}

async function withTelemetryStateLock<T>(
  homeDir: string | undefined,
  run: (state: TelemetryState) => Promise<T>,
): Promise<T> {
  const lockFile = resolveTelemetryLockFile(homeDir);
  await mkdir(dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        // Bugfix: 旧锁文件只有一个空文件，崩溃后 5 分钟内无法判断是否为孤儿锁。
        // 新锁写入 owner pid，让后续进程能安全回收“刚残留但持有进程已退出”的锁。
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
          }),
          "utf-8",
        );
        const state = await readTelemetryState(homeDir);
        return await run(state);
      } finally {
        await handle.close();
        await unlink(lockFile).catch(() => {});
      }
    } catch (error) {
      const isLockConflict =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!isLockConflict) {
        throw error;
      }

      // Bugfix: 崩溃/强退后 telemetry-state.lock 可能遗留在磁盘上，后续所有启动都会直接卡死到超时。
      // 这里按 mtime 识别明显过期的孤儿锁并自动回收，避免用户目录里一个陈旧空文件把上报永久锁死。
      const removedStaleLock = await removeStaleTelemetryLockIfNeeded(lockFile, Date.now());
      if (removedStaleLock) {
        continue;
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error("Telemetry state lock timeout");
}

export interface EnsureTelemetryDeviceMidOptions {
  homeDir?: string;
  randomUUID?: () => string;
}

function rememberDeviceMid(telemetryStateFile: string, deviceMid: string): string {
  deviceMidCacheByStateFile.set(telemetryStateFile, Promise.resolve(deviceMid));
  return deviceMid;
}

/** 调用方必须已持有 telemetry-state.lock；只在 state 缺失 deviceMid 时生成并写回。 */
async function ensureDeviceMidInLockedState(
  state: TelemetryState,
  options: EnsureTelemetryDeviceMidOptions,
): Promise<string> {
  const telemetryStateFile = resolveTelemetryStateFile(options.homeDir);
  if (state.deviceMid) {
    return rememberDeviceMid(telemetryStateFile, state.deviceMid);
  }

  // device_mid 独立生成，不再复用首条事件的 eventId：让它表达「设备标识」而非「某次上报」。
  const deviceMid = (options.randomUUID ?? createUuid)();
  state.deviceMid = deviceMid;
  await writeTelemetryState(state, options.homeDir);
  return rememberDeviceMid(telemetryStateFile, deviceMid);
}

/**
 * 确保 telemetry-state.json 里存在 deviceMid 并返回它。
 *
 * Bug 根因：远端 zcode-server 所在主机没有 Desktop main 进程，过去没有任何进程会在那里写
 * telemetry-state.json；buildZCodeSourceHeaders() 又只读不生成，于是远端发往 ZCode endpoint 的
 * 请求永远缺 X-Device-Mid，billing/balance 被服务端拒绝为 parameter error，Start Plan 在远程
 * 工作区被判成未开通。这里把设备身份抽成独立入口，供远端 server 启动时调用：同一个文件、
 * 同一个字段、同一把 telemetry-state.lock，与同机 CLI 得到同一个设备身份。
 */
export function ensureTelemetryDeviceMid(
  options: EnsureTelemetryDeviceMidOptions = {},
): Promise<string> {
  const telemetryStateFile = resolveTelemetryStateFile(options.homeDir);
  const cached = deviceMidCacheByStateFile.get(telemetryStateFile);
  if (cached) {
    return cached;
  }

  // 按 state 文件缓存 deviceMid 的读取 promise，只在首次缺失或首次读取时进入文件锁。
  const pending = withTelemetryStateLock(options.homeDir, async (state) =>
    ensureDeviceMidInLockedState(state, options),
  ).catch((error) => {
    if (deviceMidCacheByStateFile.get(telemetryStateFile) === pending) {
      deviceMidCacheByStateFile.delete(telemetryStateFile);
    }
    throw error;
  });
  deviceMidCacheByStateFile.set(telemetryStateFile, pending);
  return pending;
}
