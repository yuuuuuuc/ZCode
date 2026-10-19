// ============================================================
// WebToolsPort 的宿主凭据来源：Provider Registry → 搜索后端凭据
// ============================================================
// 端口契约见 contracts/src/interfaces/web-tools.port.ts。分层的理由与
// model-catalog-port.ts 完全相同：`adapters` 不依赖 `bootstrap`，也不依赖
// `@zcode/provider` 的具体类型，所以注册表的遍历留在这一侧，adapter 只拿到一个窄函数。

import type { WebToolsCredentialSource } from "@zcode/adapters/web-tools";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

const DEEPSEEK_HOST = "api.deepseek.com";

/**
 * 造凭据来源。
 *
 * `resolve()` **每次调用都现读 `registry.getView()`**，绝不缓存：用户中途配上或删掉 Key
 * 之后，下一个 tool call 必须立即看到新事实。视图本身是内存对象，重读它不是 I/O。
 *
 * 命中条件（三条同时满足）：`config.api.baseUrl` 的 host 是 `api.deepseek.com`、
 * `access.type === "api-key"`、`access.apiKey` 非空。内置模板本身不带 Key，
 * 所以只有用户配置过的 provider 会命中。
 */
export function createProviderRegistryWebToolsCredentials(
  registry: ProviderRegistryModelSource,
): WebToolsCredentialSource {
  return {
    resolve(): { apiKey: string; baseUrl: string } | undefined {
      for (const provider of registry.getView().providers) {
        const access = provider.config.access;
        if (access.type !== "api-key") continue;
        const apiKey = access.apiKey;
        if (typeof apiKey !== "string" || apiKey.length === 0) continue;
        const baseUrl = provider.config.api.baseUrl;
        if (!isDeepSeekBaseUrl(baseUrl)) continue;
        return { apiKey, baseUrl };
      }
      return undefined;
    },
  };
}

function isDeepSeekBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === DEEPSEEK_HOST;
  } catch {
    return false;
  }
}
