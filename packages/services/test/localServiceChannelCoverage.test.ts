/**
 * 本地服务通道覆盖 —— 防止「客户端请求了某个 channel，本地却没注册」这类漏接线。
 *
 * 背景：`RemoteServiceAccess` 对每个 channel 无条件建 proxy，未注册的通道不会立刻报错，
 * 而是等满 1000ms 后抛 `Channel name '<x>' timed out after 1000ms`。这类事故已发生多次
 * （gen-ui 注册被剪断、plugin-sync 注册被误删、output-style 注册被删），
 * 根因是「客户端请求清单」与「本地注册清单」是两份独立手写清单，没有任何东西保证对齐。
 *
 * 本测试把两份清单钉在一起：
 * 1. 运行时：对 `createLocalServices` 的结果断言每个被请求的描述符 `getOptional !== undefined`；
 *    确实不注册的必须进 `INTENTIONALLY_UNREGISTERED` 并写明原因。
 * 2. 静态：扫 `packages/client/src/remoteServiceAccess.ts` 的 `toService<IX>`，
 *    断言本文件维护的清单与它逐名一致 —— 客户端新增通道而这里没跟上时直接失败。
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IBotsService,
  IBroadcastService,
  IClientConfigService,
  IClientScenesService,
  ICloudContentService,
  ICodingPlanSubscriptionService,
  ICommandsService,
  IConversationShareService,
  ICredentialService,
  ICuaPermissionService,
  IFeedbackService,
  IFileService,
  IFileWatcherService,
  IGenUiService,
  IGitCheckpointService,
  IGitService,
  IHighspeedCardService,
  IHooksService,
  IMarketingTouchService,
  IMcpSyncService,
  IMediaPreviewService,
  IMemoryService,
  IModelSelectionService,
  IOAuthService,
  IOffPeakTaskService,
  IOnboardingRecordService,
  IOutputStyleService,
  IPluginManagementService,
  IPluginSyncService,
  IPluginUiAppToolsService,
  IPluginUiBridgeService,
  IPluginUiSamplingService,
  IPluginsService,
  IPromptAttachmentTransferService,
  IProviderProvisioningTargetService,
  IProviderSettingsService,
  ISettingService,
  ISettingsSyncService,
  ISkillSyncService,
  ISkillsService,
  ISubagentsService,
  ISystemService,
  ITerminalService,
  IUsageStatsService,
  IWindowControllerService,
  IZCodeAgentService,
  IZCodeSessionService,
  IZCodeTaskService,
  type ServiceDescriptor,
} from "@zcode/services";
import { createLocalServices } from "@zcode/services/node";

/**
 * `remoteServiceAccess.ts` 通过 `ProxyChannel.toService<IX>` 请求的全部服务描述符。
 * 名字必须与客户端源码里的类型参数逐字一致（由下面的漂移测试保证）。
 */
const REQUESTED_DESCRIPTORS: Record<string, ServiceDescriptor<unknown>> = {
  IBotsService,
  IBroadcastService,
  IClientConfigService,
  IClientScenesService,
  ICloudContentService,
  ICodingPlanSubscriptionService,
  ICommandsService,
  IConversationShareService,
  ICredentialService,
  ICuaPermissionService,
  IFeedbackService,
  IFileService,
  IFileWatcherService,
  IGenUiService,
  IGitCheckpointService,
  IGitService,
  IHighspeedCardService,
  IHooksService,
  IMarketingTouchService,
  IMcpSyncService,
  IMediaPreviewService,
  IMemoryService,
  IModelSelectionService,
  IOAuthService,
  IOffPeakTaskService,
  IOnboardingRecordService,
  IOutputStyleService,
  IPluginManagementService,
  IPluginSyncService,
  IPluginUiAppToolsService,
  IPluginUiBridgeService,
  IPluginUiSamplingService,
  IPluginsService,
  IPromptAttachmentTransferService,
  IProviderProvisioningTargetService,
  IProviderSettingsService,
  ISettingService,
  ISettingsSyncService,
  ISkillSyncService,
  ISkillsService,
  ISubagentsService,
  ISystemService,
  ITerminalService,
  IUsageStatsService,
  IWindowControllerService,
  IZCodeAgentService,
  IZCodeSessionService,
  IZCodeTaskService,
};

/**
 * 有意不由 `createLocalServices` 注册的通道。每一条都必须写明原因，
 * 否则这份清单会退化成「把失败静音的开关」。
 */
const INTENTIONALLY_UNREGISTERED: Record<string, string> = {
  IWindowControllerService:
    "按 attachment 在 Desktop Host 层单独注册（packages/desktop/src/host/index.ts 的 exposeServicesOnMessagePort）",
};

const CLIENT_SOURCE_PATH = fileURLToPath(
  new URL("../../client/src/remoteServiceAccess.ts", import.meta.url),
);

/** `remoteServiceAccess.ts` 里 `ProxyChannel.toService<IX>(` 的类型参数名。 */
function requestedDescriptorNamesInClientSource(): string[] {
  const source = readFileSync(CLIENT_SOURCE_PATH, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/toService<\s*(I[A-Za-z0-9]+)\s*>/gu)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names].sort();
}

describe("local service channel coverage", () => {
  it("客户端请求的每个通道都由 createLocalServices 注册（缺口必须在显式白名单里）", () => {
    const services = createLocalServices({
      // 只要求一个可解析路径，不需要真实文件；这里给一个必然不存在的临时路径。
      zcodeBuiltinProviderConfigFilePath: join(tmpdir(), "zcode-channel-coverage-nonexistent.json"),
      // 打开条件注册：Provisioning target 只在明确授权时暴露（见下一个用例）。
      providerProvisioningTargetEnabled: true,
    });

    const missing = Object.entries(REQUESTED_DESCRIPTORS)
      .filter(([name]) => INTENTIONALLY_UNREGISTERED[name] === undefined)
      .filter(([, descriptor]) => services.getOptional(descriptor) === undefined)
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });

  it("未授权时 IProviderProvisioningTargetService 不注册（条件注册是刻意的，不是缺口）", () => {
    const services = createLocalServices({
      zcodeBuiltinProviderConfigFilePath: join(tmpdir(), "zcode-channel-coverage-nonexistent.json"),
    });

    expect(services.getOptional(IProviderProvisioningTargetService)).toBeUndefined();
  });

  it("本文件维护的清单与 remoteServiceAccess.ts 的请求清单不漂移", () => {
    expect(requestedDescriptorNamesInClientSource()).toEqual(
      Object.keys(REQUESTED_DESCRIPTORS).sort(),
    );
  });

  it("白名单里的名字都还在客户端请求清单里（避免白名单变成垃圾场）", () => {
    const requested = new Set(Object.keys(REQUESTED_DESCRIPTORS));
    expect(Object.keys(INTENTIONALLY_UNREGISTERED).filter((name) => !requested.has(name))).toEqual(
      [],
    );
  });
});
