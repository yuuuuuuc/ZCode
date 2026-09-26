/* eslint-disable max-lines -- Model Provider 详情页集中编排自定义供应商卡片与空态。 */
import { type ModelConnectivityResult } from "@zcode/shared";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelProviderNavItem } from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import type { ProviderSettingsView } from "@zcode/services";

export interface ModelProviderSectionDetailProps {
  providerSettingsView: ProviderSettingsView | null;
  selectedNavItem: ModelProviderNavItem | null;
  loading: boolean;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: Parameters<
      typeof InlineEditableProviderCard
    >[0]["provider"]["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel?: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onOpenApiKeyUrl?: (url: string) => void;
}

export function ModelProviderSectionDetail({
  selectedNavItem,
  loading,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onTestModel,
  onOpenApiKeyUrl,
}: ModelProviderSectionDetailProps) {
  const { intl } = useZCodeIntl();

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-foreground-subtle">
        {intl.formatMessage({ id: "common.loading" })}
      </div>
    );
  }

  if (!selectedNavItem || selectedNavItem.type !== "custom") {
    return (
      <div className="flex h-40 items-center justify-center text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.empty" })}
      </div>
    );
  }

  const provider = selectedNavItem.provider;
  return (
    <InlineEditableProviderCard
      provider={provider}
      onSave={onSave}
      onAddPersonalModel={onAddPersonalModel}
      onSavePersonalModelDraft={onSavePersonalModelDraft}
      onSetPersonalModelEnabled={onSetPersonalModelEnabled}
      onDeletePersonalModel={onDeletePersonalModel}
      onDelete={() => onDelete(provider)}
      onTestModel={onTestModel}
      onOpenPresetApiKey={
        provider.config.access?.apiKeyManagementUrl
          ? () => onOpenApiKeyUrl?.(provider.config.access?.apiKeyManagementUrl ?? "")
          : undefined
      }
    />
  );
}
