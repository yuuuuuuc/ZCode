import {
  ServiceCollection,
  IFileService,
  IMediaPreviewService,
  IGitService,
  ISystemService,
  ITerminalService,
  ISettingService,
  ICredentialService,
  IBroadcastService,
  IZCodeTaskService,
  IZCodeAgentService,
  IZCodeSessionService,
  IFileWatcherService,
  IClientConfigService,
  IClientScenesService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ICommandsService,
  ISettingsSyncService,
  IPromptAttachmentTransferService,
  type IServiceAccessor,
} from "@zcode/services";
import {
  createSettingService,
  createBroadcastService,
  createClientScenesService,
  createSettingsSyncService,
  createMediaPreviewService,
} from "@zcode/services/node";
import type { ApiClient } from "@zcode/shared";

export function createRemoteConnectionServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
  parentPort: Parameters<typeof createBroadcastService>[0];
  credentialService: ICredentialService;
  apiClient: ApiClient;
  remoteZCodeTaskService: IZCodeTaskService;
  remoteZCodeSessionService: IZCodeSessionService;
  promptAttachmentTransferService: IPromptAttachmentTransferService;
}): ServiceCollection {
  // Ycode: no OAuth / coding-plan services on remote connection host.
  // Remote filesystem-related services must still be exposed to the renderer.
  return (
    new ServiceCollection()
      .register(IFileService, params.connectionServices.fileService)
      .register(
        IMediaPreviewService,
        createMediaPreviewService({
          fileService: params.connectionServices.fileService,
        }),
      )
      .register(IGitService, params.connectionServices.gitService)
      .register(ISystemService, params.connectionServices.systemService)
      .register(ITerminalService, params.connectionServices.terminalService)
      .register(ISettingService, createSettingService())
      .register(ICredentialService, params.credentialService)
      .register(IBroadcastService, createBroadcastService(params.parentPort))
      .register(IZCodeTaskService, params.remoteZCodeTaskService)
      .register(IZCodeAgentService, params.connectionServices.zcodeAgentService)
      .register(IZCodeSessionService, params.remoteZCodeSessionService)
      .register(IPromptAttachmentTransferService, params.promptAttachmentTransferService)
      .register(IFileWatcherService, params.connectionServices.fileWatcherService)
      .register(IClientScenesService, createClientScenesService({ apiClient: params.apiClient }))
      .register(IClientConfigService, params.clientConfigService)
      .register(ISkillsService, params.connectionServices.skillsService)
      .register(ISkillSyncService, params.connectionServices.skillSyncService)
      .register(IMcpSyncService, params.connectionServices.mcpSyncService)
      .register(IPluginSyncService, params.connectionServices.pluginSyncService)
      .register(IPluginsService, params.connectionServices.pluginsService)
      .register(IPluginManagementService, params.connectionServices.pluginManagementService)
      .register(ICommandsService, params.connectionServices.commandsService)
      .register(
        ISettingsSyncService,
        createSettingsSyncService({
          settingService: createSettingService(),
        }),
      )
  );
}
