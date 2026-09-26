import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import { createServiceDescriptor } from "../descriptors.js";

export interface IUsageStatsService {
  getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot>;
}

export const IUsageStatsService = createServiceDescriptor<IUsageStatsService>(
  ServiceChannels.UsageStats,
);

interface UsageStatsServiceDependencies {
  /** App Usage 经 ZCode Protocol 读取 agent 数据库真实统计。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回。不再读本地 session JSON 估算。
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
  };
}
