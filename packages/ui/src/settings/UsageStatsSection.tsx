import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

export type UsageStatsSectionTab = "app" | (string & {});

export function UsageStatsSection({
  activeTab,
}: {
  activeTab: UsageStatsSectionTab;
  providerSourcesLoading?: boolean;
  workspaceIdentity?: string;
  workspacePath?: string;
}) {
  // 账号体系已移除：使用统计只保留本地 App Usage。
  void activeTab;
  return <AppUsagePanel />;
}
