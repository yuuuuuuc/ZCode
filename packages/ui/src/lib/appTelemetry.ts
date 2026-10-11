import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  ZAI_PROVIDER_ID,
  isZaiCodingPlanProviderId,
  type BuiltinModelProviderId,
  type IPlatformService,
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
