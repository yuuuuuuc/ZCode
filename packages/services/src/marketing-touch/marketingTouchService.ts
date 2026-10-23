import { randomUUID } from "node:crypto";
import type { ApiClient, MarketingTouchSnapshot } from "@zcode/shared";
import type { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";

/**
 * 营销投放已阻断，不再访问官方 `/api/v1/marketing/touch` 与 `/action`。
 * 查询固定为空，上报直接成功，避免把设备号、语言和登录令牌送到投放接口。
 * Start Plan 领取仍走计费接口，不经过这里。
 */
export function createMarketingTouchService(options: {
  apiClient: ApiClient;
  getToken: () => Promise<string | null | undefined>;
  getDeviceMid: () => string | undefined;
  baseUrl: string;
  appVersion: string;
  onSnapshot?: (snapshot: MarketingTouchSnapshot) => void;
}): IMarketingTouchService {
  return {
    async query({ locale }) {
      const snapshot: MarketingTouchSnapshot = {
        serverTime: Date.now(),
        language: locale,
        deliveries: [],
        rejectedCount: 0,
      };
      options.onSnapshot?.(snapshot);
      return { ...snapshot, scope: randomUUID() };
    },
    async report() {
      return undefined;
    },
  };
}
