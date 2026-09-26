---
name: ycode-opensource-audit
description: 2026-09-26 开源化改造审查与修复——模型执行链无能力损失；官方强更锁启动通道已删除；远程凭据与分享页 401 仍未处理
metadata:
  type: project
---

2026-09-26 审查 ycode 相对 origin/main(v3.14.3,merge-base 29628c9)的全部差异（608 文件），同日完成修复。

**模型执行链无能力损失**：runner/runner-stream/runner-generate/model-execution 删的只是 zhipu-account 分支、off-peak 特判、官方 Coding Plan 网关 fetch 包装；api-key 型供应商的 apiKey/baseURL/headers/重试/流式/工具链路逐字保留。`reasoning-history-normalization.ts` 的 REASONING_PROVIDER_GROUPS 清空后仅丢失「跨 builtin/Individual/Team 身份 resume 回放 reasoning」兼容，同 provider id 正常。

**已修复（2026-09-26，spec 第 4 节）**：官方强更锁启动通道整链删除——`forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`shared/forceUpdate.ts`、`remoteAppConfig.getForceUpdateMinimalVersionFromConfig`、main/index.ts 的 gate 与拦截分支、i18n `forceUpdate.*`。`autoUpdater.ts` 原样保留（帮助菜单「检查更新」是普通功能；其 `activeForceAutoUpdateListener` 恒 null 后自然退化，勿清理以免重写状态机）。同时清理了 `/login`/`/logout` 帮助条目、MCP `serverRequestId`/`connectionDiagnosticByServer` 死链（含 contracts 的 `McpServerStatus.serverRequestId` 与 `ZCODE_MCP_SERVER_REQUEST_ID_META_KEY`）、runner-stream 悬挂注释、`isRestoringOAuthSession` 死字段。TUI `app-submit.ts` 的 `/login` redact 正则有意保留：命令已删，但用户误把 API key 当消息发送时它仍遮蔽 transcript。

**未处理的已知风险**：
1. `packages/desktop/src/host/remoteWorkspaceServiceCollection.ts` 远程/WSL workspace 的 provider api key 解析链已删（resolveProviderApiKey 恒 null），远程会话模型调用可能无凭据，未实测。
2. `packages/web/src/main.tsx:131` 分享页 `getAccessToken={() => getMockToken()}`，非 mock 模式分享预览会 401。

**其他确认**：`zcodeEndpoint.ts`（v3.14.3 合并带回）仍被 helpAppConfig/`desktopContextPromptRollout` 灰度拉取使用，失败降级不阻塞启动；侧栏 `sidebar.profile.notLoggedIn: "Yuuc"` 是 db7a727 有意设置，不是残留。

**Why:** 后续排查远程会话无凭据或分享页 401 时，这些是改造的直接后果而非新 bug；强更链勿按「上游缺失」补回。
**How to apply:** 做远程 workspace 实测时先验证模型凭据；恢复登录体系时 i18n 的 notLoggedIn key 与 store 的 authSessionSeq 链路需要重接。相关：[[ycode-main-v3143-merge]]
