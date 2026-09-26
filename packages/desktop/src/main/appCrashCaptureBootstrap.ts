import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 官方遥测（ARMS）已移除，没有任何远端 crash 上报接管方；remoteCrashReporterEnabled=false
// 让本地 crashReporter 启动（uploadToServer=false），dump 仅落本地目录供排障。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
