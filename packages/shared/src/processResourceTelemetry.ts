/**
 * CLI 进程资源样本的共享契约。
 *
 * 桌面官方遥测已移除，这里只保留仍被引用的协议常量：CLI 自采周期（节拍契约）与
 * CLI 进程泳道枚举（`validation.ts` 的 `processResourceCliLaneSchema` 使用）。
 */

/** zcode-cli 进程资源样本的自采周期（CLI 侧定时器周期）。 */
export const ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS = 60_000;

/**
 * zcode-cli 的进程泳道。
 *
 * lane 不是 CLI 协议字段——CLI 进程不知道自己被哪个进程管理器拉起，由 app 侧 services 层
 * 在解析样本时按所属进程管理器打标（`chat` 是 workspace 级 Agent，其余两条是控制面 lane）。
 */
export const PROCESS_RESOURCE_CLI_LANES = ["chat", "plugin", "mcp-status"] as const;

export type ProcessResourceCliLane = (typeof PROCESS_RESOURCE_CLI_LANES)[number];
