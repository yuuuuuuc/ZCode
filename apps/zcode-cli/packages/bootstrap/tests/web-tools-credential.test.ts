/**
 * WebToolsPort 的宿主凭据来源（src/app/web-tools-credential.ts）。
 *
 * 三条被钉住的事实：命中条件（host + api-key + 非空 Key）、活视图重读、
 * 以及「内置模板不带 Key 就不算配置」。
 */

import { describe, expect, it } from "vitest";
import { createProviderRegistryWebToolsCredentials } from "../src/app/web-tools-credential.js";
import type { ProviderRegistryModelSource } from "../src/app/provider-registry-model-runtime.js";

interface FakeProvider {
  providerId: string;
  access: Record<string, unknown>;
  baseUrl: string;
}

/**
 * 只实现 `getView()`：凭据来源刻意不做按 id 的点查。其余入口抛错，
 * 于是「实现偷偷多用了别的注册表成员」会立刻在用例里暴露。
 */
function fakeRegistry(providers: FakeProvider[]): {
  registry: ProviderRegistryModelSource;
  setProviders: (next: FakeProvider[]) => void;
  viewReads: () => number;
} {
  let current = providers;
  let reads = 0;
  const registry = {
    getView() {
      reads += 1;
      return {
        revision: reads,
        providers: current.map((provider) => ({
          providerId: provider.providerId,
          config: { access: provider.access, api: { type: "anthropic", baseUrl: provider.baseUrl } },
          models: [],
        })),
      };
    },
    getProvider() {
      throw new Error("the credential source must not point-query the registry");
    },
    getModel() {
      throw new Error("the credential source must not point-query the registry");
    },
    validateSelection() {
      throw new Error("the credential source must not validate selections");
    },
    onDidChange() {
      throw new Error("the credential source must not subscribe; it re-reads on every call");
    },
  } as unknown as ProviderRegistryModelSource;
  return {
    registry,
    setProviders: (next) => {
      current = next;
    },
    viewReads: () => reads,
  };
}

const DEEPSEEK: FakeProvider = {
  providerId: "deepseek",
  // 内置模板的 baseUrl 带 /anthropic 尾缀；origin 由 adapter 侧推导，这里只做 host 判定。
  baseUrl: "https://api.deepseek.com/anthropic",
  access: { type: "api-key", apiKey: "sk-deepseek" },
};

describe("createProviderRegistryWebToolsCredentials", () => {
  it("resolves the api key of a configured DeepSeek provider", () => {
    const { registry } = fakeRegistry([DEEPSEEK]);
    expect(createProviderRegistryWebToolsCredentials(registry).resolve()).toEqual({
      apiKey: "sk-deepseek",
      baseUrl: "https://api.deepseek.com/anthropic",
    });
  });

  it("ignores providers whose key is missing or blank", () => {
    const { registry } = fakeRegistry([
      { ...DEEPSEEK, providerId: "blank", access: { type: "api-key", apiKey: "" } },
      { ...DEEPSEEK, providerId: "absent", access: { type: "api-key" } },
      { ...DEEPSEEK, providerId: "account", access: { type: "zhipu-account" } },
    ]);
    expect(createProviderRegistryWebToolsCredentials(registry).resolve()).toBeUndefined();
  });

  it("ignores providers that point at another host", () => {
    const { registry } = fakeRegistry([
      { ...DEEPSEEK, providerId: "proxy", baseUrl: "https://api.example.com/v1" },
    ]);
    expect(createProviderRegistryWebToolsCredentials(registry).resolve()).toBeUndefined();
  });

  it("re-reads the live registry view on every call", () => {
    // 判别用例：构造之后才配置 Key。缓存一份构造期快照会让第二次调用继续返回 undefined。
    const fake = fakeRegistry([]);
    const credentials = createProviderRegistryWebToolsCredentials(fake.registry);

    expect(credentials.resolve()).toBeUndefined();
    fake.setProviders([DEEPSEEK]);
    expect(credentials.resolve()?.apiKey).toBe("sk-deepseek");
    expect(fake.viewReads()).toBe(2);

    // 反过来：用户删掉 Key 之后，下一次必须立即回落。
    fake.setProviders([]);
    expect(credentials.resolve()).toBeUndefined();
  });
});
