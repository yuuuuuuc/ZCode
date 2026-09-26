import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";

interface V4ModelTriggerDisplay {
  fullLabel: string;
  modelLabel: string;
  providerPrefix?: string;
}

export function formatModelChangeLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
  intl: Pick<IntlInstance, "formatMessage">,
): string {
  return formatProviderModelLabel(providerId, providerName, modelName);
}

export function formatProviderModelLabel(
  providerId: string | undefined,
  providerName: string | undefined,
  modelName: string,
): string {
  const normalizedProviderName = providerName?.trim();
  return normalizedProviderName ? `${normalizedProviderName}/${modelName}` : modelName;
}

export function resolveV4ModelTriggerLabel({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): string {
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return fallbackLabel;
  }

  return formatProviderModelLabel(providerId, providerName, selectedItem.name);
}

export function resolveV4ModelTriggerDisplay({
  modelGroups,
  normalizedValue,
  fallbackLabel,
  providerId,
  providerName,
}: {
  modelGroups: readonly ModelSelectGroup[];
  normalizedValue: string;
  fallbackLabel: string;
  providerId: string | undefined;
  providerName?: string;
}): V4ModelTriggerDisplay {
  // 把 provider/model 预先拼成单一字符串后，响应式布局只能整段隐藏或依赖
  // 平台 JS 分支裁剪；这里保留结构化前缀，让 composer 容器断点统一决定可见密度。
  const fullLabel = resolveV4ModelTriggerLabel({
    modelGroups,
    normalizedValue,
    fallbackLabel,
    providerId,
    providerName,
  });
  const selectedGroup = modelGroups.find((group) =>
    group.items.some((item) => item.value === normalizedValue),
  );
  const selectedItem = selectedGroup?.items.find((item) => item.value === normalizedValue);
  if (!selectedGroup || !selectedItem) {
    return { fullLabel, modelLabel: fallbackLabel };
  }

  const modelLabel = selectedItem.name;
  const normalizedProviderName = providerName?.trim();
  if (!normalizedProviderName) {
    return { fullLabel, modelLabel };
  }

  return {
    fullLabel,
    providerPrefix: `${normalizedProviderName}/`,
    modelLabel,
  };
}
