// scheduler(utilityProcess) ↔ main 的控制消息协议。两端都在 Electron 侧，走 parentPort.postMessage。
// 与 host↔main 的 CronRun/CronRunResult(见 @zcode/shared channels + validation)不同：
// 这层是 main 与「常驻 cron scheduler 进程」之间的私有通道；main 收到派发请求后再翻译成 CronRun 转发给 host。
import type { ModelSelection } from "@zcode/shared";

/** scheduler → main */
export type SchedulerToMainMessage =
  | {
      type: "cron-dispatch-request";
      automationId: string;
      runId: string;
      prompt: string;
      targetTaskId?: string;
      modelSelection?: ModelSelection;
      mode?: string;
      workspacePath: string;
      workspaceIdentity?: string;
    }
  | {
      type: "scheduler-log";
      level: "info" | "warn" | "error";
      message: string;
    };

/** main → scheduler */
export type MainToSchedulerMessage =
  | {
      type: "cron-dispatch-result";
      runId: string;
      ok: boolean;
      taskId?: string;
      sessionId?: string;
      error?: string;
      failureKind?: "transient" | "permanent";
    }
  | {
      // main 在退出前通知 scheduler 优雅收尾（释放认领、关库）。
      type: "scheduler-dispose";
    }
  | {
      // manual run 已提交，立即触发一次 tick；automationId 仅用于日志关联。
      type: "scheduler-wake";
      automationId: string;
    };
