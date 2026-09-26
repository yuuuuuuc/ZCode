import { create } from "zustand";
import type { DynamicWorkflowClientConfig } from "@zcode/shared";

// ============================================================
// 动态工作流灰度快照在 renderer 的唯一副本
// ============================================================
// 灰度配置原由 Coding Plan 订阅服务下发；账号体系移除后没有配置来源，
// 恒按未命中（fail-closed）处理，与 CLI 缺省不注册工作流工具簇保持一致。

export type DynamicWorkflowAvailabilityStatus = "loading" | "ready";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly status: DynamicWorkflowAvailabilityStatus;
  /** loading 期间恒为 false：未知即不提供，入口宁可晚半拍出现也不闪一下再收起。 */
  readonly enabled: boolean;
  /** 未就绪或取数失败时为 null；`source` 只用于观测，区分「服务端关」与「本地覆盖」。 */
  readonly config: DynamicWorkflowClientConfig | null;
}

interface DynamicWorkflowAvailabilityState extends DynamicWorkflowAvailabilitySnapshot {
  /** 兼容旧调用方；现在是无操作。 */
  ensureLoaded(): Promise<void>;
  /** 兼容旧调用方；现在是无操作。 */
  refresh(): Promise<void>;
}

const DISABLED_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "ready",
  enabled: false,
  config: null,
};

export const useDynamicWorkflowAvailabilityStore = create<DynamicWorkflowAvailabilityState>(() => ({
  ...DISABLED_SNAPSHOT,

  ensureLoaded(): Promise<void> {
    return Promise.resolve();
  },

  refresh(): Promise<void> {
    return Promise.resolve();
  },
}));
