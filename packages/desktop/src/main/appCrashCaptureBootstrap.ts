import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// remoteCrashReporterEnabled 必须是 false：官方 ARMS 已移除，本地 crashReporter 负责落盘。
// 若保持 true，本地崩溃上报会静默消失。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
