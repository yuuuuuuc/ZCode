import { useMemo } from "react";
import {
  useDynamicWorkflowAvailabilityStore,
  type DynamicWorkflowAvailabilitySnapshot,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

/**
 * 读动态工作流灰度快照。
 * 只读，不触发请求。账号体系移除后灰度配置没有来源，恒为未命中（disabled）。
 */
export function useDynamicWorkflowAvailability(): DynamicWorkflowAvailabilitySnapshot {
  // 逐字段订阅：返回对象字面量的 selector 每次都是新引用，useSyncExternalStore 会判定为变化。
  const status = useDynamicWorkflowAvailabilityStore((state) => state.status);
  const enabled = useDynamicWorkflowAvailabilityStore((state) => state.enabled);
  const config = useDynamicWorkflowAvailabilityStore((state) => state.config);
  return useMemo(() => ({ status, enabled, config }), [config, enabled, status]);
}
