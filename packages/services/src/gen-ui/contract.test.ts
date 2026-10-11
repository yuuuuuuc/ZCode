import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostPluginSandboxRegisterRequestResponseSchema } from "@zcode/shared";
import type { PluginSandboxHandle, PluginSandboxRegisterInput } from "@zcode/shared/mcp-apps";
import { afterEach, describe, expect, it } from "vitest";
import { createGenUiService } from "./adapters/service.js";
import { IGenUiService } from "./contract.js";
import { exampleGenUiPrepare } from "./contract.example.js";

const stateRoots: string[] = [];

afterEach(async () => {
  for (const root of stateRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function createStateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gen-ui-contract-"));
  stateRoots.push(root);
  return root;
}

function handleFor(input: PluginSandboxRegisterInput): PluginSandboxHandle {
  return {
    instance: input.instance,
    sandboxId: "sandbox-contract",
    initId: 1,
    shellUrl: "zcode-sandbox://contract/",
    partition: "gen-ui-contract",
  };
}

describe("gen-ui-service contract", () => {
  it("描述符绑定 gen-ui 频道", () => {
    // 客户端按这个频道名请求服务；改名会让宿主侧找不到实现。
    expect(IGenUiService.channelName).toBe("gen-ui");
  });

  it("登记请求整体通过 host → main 的 strict schema，并满足 gen-ui provenance 约束", async () => {
    // 这条 schema 是 strict 的，且带一条 provenance refine：contentKind 为 gen-ui 时禁止
    // pluginId / serverName / permissions（见 CONTRACT.md 的「explicit gen-ui provenance」）。
    // gen-ui 是 contentKind: "gen-ui" 的唯一产出方——一旦登记输入多带未声明字段或漏改这条约束，
    // 整条登记会被 main 拒收，卡片卡在 preparing。
    let captured: PluginSandboxRegisterInput | undefined;
    const service = createGenUiService({
      stateRoot: await createStateRoot(),
      registerSandbox: async (input) => {
        captured = input;
        return handleFor(input);
      },
    });
    try {
      await service.prepareSandbox(exampleGenUiPrepare);
      expect(captured).toBeDefined();
      const payload = {
        type: "plugin-sandbox-register-request" as const,
        requestId: "gen-ui-contract",
        ...captured,
      };
      expect(hostPluginSandboxRegisterRequestResponseSchema.safeParse(payload).success).toBe(true);
      expect(captured?.contentKind).toBe("gen-ui");
      expect(captured?.pluginId).toBeUndefined();
      expect(captured?.serverName).toBeUndefined();
      // 反向断言：证明上面那条不是恒真——同一份登记一旦带上插件来源，provenance refine 必须拒绝它。
      expect(
        hostPluginSandboxRegisterRequestResponseSchema.safeParse({
          ...payload,
          pluginId: "plugin-contract",
        }).success,
      ).toBe(false);
    } finally {
      service.dispose();
    }
  });

  it("没有桌面沙箱时 prepareSandbox 失败关闭，不退化成静默成功", async () => {
    // 沙箱方法属于 desktop base services：拿不到注册器就必须抛错，不能返回一个假句柄
    // 让调用方以为卡片已经就绪。
    const service = createGenUiService({ stateRoot: await createStateRoot() });
    try {
      await expect(service.prepareSandbox(exampleGenUiPrepare)).rejects.toThrow(
        "Gen UI requires a desktop sandbox",
      );
    } finally {
      service.dispose();
    }
  });
});
