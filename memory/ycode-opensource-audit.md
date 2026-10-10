---
name: ycode-opensource-audit
description: 2026-09-26 开源化改造审查与修复——模型执行链无能力损失；官方强更锁启动通道已删除；远程凭据与分享页 401 仍未处理
metadata:
  type: project
---

2026-09-26 审查 ycode 相对 origin/main(v3.14.3,merge-base 29628c9)的全部差异（608 文件），同日完成修复。

**模型执行链无能力损失**：runner/runner-stream/runner-generate/model-execution 删的只是 zhipu-account 分支、off-peak 特判、官方 Coding Plan 网关 fetch 包装；api-key 型供应商的 apiKey/baseURL/headers/重试/流式/工具链路逐字保留。`reasoning-history-normalization.ts` 的 REASONING_PROVIDER_GROUPS 清空后仅丢失「跨 builtin/Individual/Team 身份 resume 回放 reasoning」兼容，同 provider id 正常。

**已修复（2026-09-26，spec 第 4 节）**：官方强更锁启动通道整链删除——`forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`shared/forceUpdate.ts`、`remoteAppConfig.getForceUpdateMinimalVersionFromConfig`、main/index.ts 的 gate 与拦截分支、i18n `forceUpdate.*`。`autoUpdater.ts` 原样保留（帮助菜单「检查更新」是普通功能；其 `activeForceAutoUpdateListener` 恒 null 后自然退化，勿清理以免重写状态机）。同时清理了 `/login`/`/logout` 帮助条目、MCP `serverRequestId`/`connectionDiagnosticByServer` 死链（含 contracts 的 `McpServerStatus.serverRequestId` 与 `ZCODE_MCP_SERVER_REQUEST_ID_META_KEY`）、runner-stream 悬挂注释、`isRestoringOAuthSession` 死字段。TUI `app-submit.ts` 的 `/login` redact 正则有意保留：命令已删，但用户误把 API key 当消息发送时它仍遮蔽 transcript。

**已修复（2026-10-10，第二批复核）**：`Provider request auth is unavailable` 全供应商阻断——Host 对 `interactionRequestProviderRuntimeHeaders` 曾无条件 fail-closed，而 CLI 端口 `shouldRefreshBeforeModelRequest` 恒 true，导致 api-key 供应商每次请求发出前必失败。修复为双保险：CLI 端口门控改读 `YCODE_VENDOR_SERVICES.officialAccountCredentials`（当前恒 false，整体跳过刷新链）；Host 对误调用方回 `headersApplied: true, requestAuth: {}`（adapter 的 `applyModelRequestAuth` 只在 `requestAuth.apiKey` 非空时覆盖，静态 Key 不丢）。规格见 `docs/provider-runtime-headers-api-key-era.md`。

**测试基线现状（2026-10-10，Windows 实测）**：账号裁剪遗留一批死测试——services 全量 60 文件红（多为 import 已删除的 `offPeakSelection` fixture / `accountRequestAuthService`），bootstrap `zcode-protocol.test.ts` 7 例预存红（含 `BUILTIN_MODEL_PROVIDER_IDS.*` 账号 id 已删）、`provider-runtime-headers-cancel.test.ts` 首例因动态 import 计入 5s 超时必挂、bootstrap `tsc --noEmit` 有 352 个预存错误（依赖未构建的兄弟包）。跑测试必须 `pnpm exec vitest`（裸 `npx vitest` 会拉错二进制且根 node_modules 曾缺 vitest，先 `pnpm install --frozen-lockfile`）。

**Why:** 后续修测试或验证时，先对照这些预存红名单，不要把历史欠账当成新回归；也不要用 npx。
**How to apply:** 验证改动时跑定向文件 + stash 对照基线；修同一批账号遗留死测试时优先按本文件记录的位置排查。相关：[[windows-license-lockfile-graph]]

**未处理的已知风险**：
1. `packages/desktop/src/host/remoteWorkspaceServiceCollection.ts` 远程/WSL workspace 的 provider api key 解析链已删（resolveProviderApiKey 恒 null），远程会话模型调用可能无凭据，未实测。
2. `packages/web/src/main.tsx:131` 分享页 `getAccessToken={() => getMockToken()}`，非 mock 模式分享预览会 401。

**其他确认**：`zcodeEndpoint.ts`（v3.14.3 合并带回）仍被 helpAppConfig/`desktopContextPromptRollout` 灰度拉取使用，失败降级不阻塞启动；侧栏 `sidebar.profile.notLoggedIn: "Yuuc"` 是 db7a727 有意设置，不是残留。

**打包注意（2026-09-26 实测）**：从 ZCode 会话内构建时，CLI 注入的 `ZCODE_*` 环境变量会污染打包——`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向用户目录官方版运行时缓存（含智谱账号型规则），会让 `loadBuiltinProviderConfig` schema 校验失败；未设 `ZCODE_ENV` 时 flavor 落为 preview（产物 `Ycode Preview-..._TEST.exe`）。正确命令：
`env -u ZCODE_BUILTIN_PROVIDER_CONFIG_FILE -u ZCODE_BASE_URL ... ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64`（`-u` 必须写在 `NAME=value` 之前，且全部 ZCODE_* 都 unset）。产物 `packages/desktop/dist/Ycode-3.14.3-win-x64.exe`（141 MiB，agent bundle 在 runtime-assets 链内自动构建，无需单独 build:sea）。

**Why:** 后续打正式包如果直接在会话 shell 里跑 bundle:desktop，会重复踩 flavor 错、配置校验失败两个坑。
**How to apply:** 打包前 `compgen -e | grep ZCODE_` 检查注入变量并全部 unset；正式版必须显式 `ZCODE_ENV=production`。

**Why:** 后续排查远程会话无凭据或分享页 401 时，这些是改造的直接后果而非新 bug；强更链勿按「上游缺失」补回。
**How to apply:** 做远程 workspace 实测时先验证模型凭据；恢复登录体系时 i18n 的 notLoggedIn key 与 store 的 authSessionSeq 链路需要重接。相关：[[ycode-main-v3143-merge]]
