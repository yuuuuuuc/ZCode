import { useContext, useLayoutEffect } from "react";
import { StoreContext } from "@/store/StoreProvider.js";
import type { InterfaceMode } from "@/lib/interfaceMode.js";
import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  ZAI_PROVIDER_ID,
  isZaiCodingPlanProviderId,
  type BuiltinModelProviderId,
  type IPlatformService,
  type TelemetryUiMode,
} from "@zcode/shared";

export function resolveProviderTelemetryLabel(providerId: string): string {
  if (providerId === ZAI_PROVIDER_ID || isZaiCodingPlanProviderId(providerId)) {
    return "z.ai";
  }

  if (
    providerId === BIGMODEL_PROVIDER_ID ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  ) {
    return "bigmodel";
  }

  return providerId;
}

export function resolvePresetModelProviderTelemetryLabel(presetId: BuiltinModelProviderId): string {
  return resolveProviderTelemetryLabel(presetId);
}

type ReportTelemetryPlatform = IPlatformService;

export async function reportAppTelemetryEvent(
  _platform: ReportTelemetryPlatform,
  _payload: {
    elementName: string;
    eventRegion: string;
    eventType: string;
    eventText?: string;
    eventExtraDetail: Record<string, string>;
    userId?: string;
    talkId?: string;
    messageId?: string;
  },
  _scope: string,
): Promise<void> {
  // 官方事件上报已移除。调用方保持原签名，避免改登录、套餐和设置编排。
}

/** 只在埋点边界映射；没有交互来源时不假定默认编程模式。 */
export function toTelemetryUiMode(mode: InterfaceMode | undefined): TelemetryUiMode {
  return mode === "office" ? "work" : mode === "coding" ? "code" : "unknown";
}

/** 从唯一 store 同步现有宿主上下文；不创建业务事件或额外轮询。 */
export function useInterfaceModeTelemetry(platform: IPlatformService, enabled: boolean): void {
  const store = useContext(StoreContext);
  useLayoutEffect(() => {
    if (!enabled || !store || !platform.syncTelemetryContext) return;
    const sync = () => {
      try {
        platform.syncTelemetryContext?.({
          ...collectTelemetryRendererContext(),
          uiMode: toTelemetryUiMode(store.getState().interfaceMode),
        });
      } catch {
        // 埋点桥失败不能中断启动、模式切换或跨窗口广播。
      }
    };
    sync();
    return store.subscribe((state, previous) => {
      if (state.interfaceMode !== previous.interfaceMode) sync();
    });
  }, [enabled, platform, store]);
}
