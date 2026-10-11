---
name: ycode-opensource-audit
description: 2026-09-26 开源化改造审查与修复——模型执行链无能力损失；官方强更锁启动通道已删除；远程凭据与分享页 401 仍未处理；3.15.5 修 WRC 与 gen-ui 漏接线；2026-10-11 恢复网络抓包接线、删零引用模块、schedulerProtocol 生成物出库；plugin-ui 桥属有意停用
metadata:
  type: project
---

2026-09-26 审查 ycode 相对 origin/main(v3.14.3,merge-base 29628c9)的全部差异（608 文件），同日完成修复。

**模型执行链无能力损失**：runner/runner-stream/runner-generate/model-execution 删的只是 zhipu-account 分支、off-peak 特判、官方 Coding Plan 网关 fetch 包装；api-key 型供应商的 apiKey/baseURL/headers/重试/流式/工具链路逐字保留。`reasoning-history-normalization.ts` 的 REASONING_PROVIDER_GROUPS 清空后仅丢失「跨 builtin/Individual/Team 身份 resume 回放 reasoning」兼容，同 provider id 正常。

**已修复（2026-09-26，spec 第 4 节）**：官方强更锁启动通道整链删除——`forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`shared/forceUpdate.ts`、`remoteAppConfig.getForceUpdateMinimalVersionFromConfig`、main/index.ts 的 gate 与拦截分支、i18n `forceUpdate.*`。`autoUpdater.ts` 原样保留（帮助菜单「检查更新」是普通功能；其 `activeForceAutoUpdateListener` 恒 null 后自然退化，勿清理以免重写状态机）。同时清理了 `/login`/`/logout` 帮助条目、MCP `serverRequestId`/`connectionDiagnosticByServer` 死链（含 contracts 的 `McpServerStatus.serverRequestId` 与 `ZCODE_MCP_SERVER_REQUEST_ID_META_KEY`）、runner-stream 悬挂注释、`isRestoringOAuthSession` 死字段。TUI `app-submit.ts` 的 `/login` redact 正则有意保留：命令已删，但用户误把 API key 当消息发送时它仍遮蔽 transcript。

**已修复（2026-10-10，第二批复核）**：`Provider request auth is unavailable` 全供应商阻断——Host 对 `interactionRequestProviderRuntimeHeaders` 曾无条件 fail-closed，而 CLI 端口 `shouldRefreshBeforeModelRequest` 恒 true，导致 api-key 供应商每次请求发出前必失败。修复为双保险：CLI 端口门控改读 `YCODE_VENDOR_SERVICES.officialAccountCredentials`（当前恒 false，整体跳过刷新链）；Host 对误调用方回 `headersApplied: true, requestAuth: {}`（adapter 的 `applyModelRequestAuth` 只在 `requestAuth.apiKey` 非空时覆盖，静态 Key 不丢）。规格见 `docs/provider-runtime-headers-api-key-era.md`。

**已修复（2026-10-11，3.15.5，commit 62a09563）**：启动/切标签页必崩 `TypeError: t.restorePreviouslyEnabledWebRemoteControl is not a function`。根因是裁剪官方 Web Remote Control 后，`packages/desktop/src/main/index.ts` 的 `registerPlatformIpcHandlers({...})` 漏传三个 WRC 回调（`restorePreviouslyEnabledWebRemoteControl` / `syncWebRemoteControlWorkspaces` / `syncWebRemoteControlTasks`），而 `desktopMainIpcPlatform.ts` 的 `SyncWindowTabs` 处理器无条件调用第一个 → 运行时 undefined 崩主进程。修复：index.ts 补三个 no-op stub（`() => undefined`）；`desktopMainIpcPlatform.ts` 三处调用改 `options.xxx?.(...)` 并把回调类型标为可选，漏 stub 只退化为 no-op。保持 fail-closed，未重新启用 WRC。`registerWebRemoteControlIpcHandlers`（`desktopWebRemoteControlIpc.ts`）在生产代码中从未被接线，WRC main 模块是裁剪后的死代码；对应 `desktopMainIpcRemoteTelemetry.test.ts` 已 skip。

**Why:** 裁剪上游功能时，main 侧 `register*IpcHandlers` 的必填回调极易漏接线，且**根 `pnpm typecheck` 只跑 `packages/desktop/tsconfig.host.json`，不含 `packages/desktop/tsconfig.main.json`**，所以 main 里漏传必填字段不会被类型检查拦住，只能靠运行时或单测暴露——这次就是漏网到运行时才崩。
**How to apply:** 改 desktop main 的 IPC 注册时，除了根 typecheck，务必对新增/改动的调用点补单测（缺省不抛 + 接线后调用）；不要指望 `pnpm typecheck` 覆盖 main。单独 `npx tsc -p packages/desktop/tsconfig.main.json --noEmit` 有大量预存错误，只能用来对比"改动前后错误集"，不能当门禁。另：本机 `pnpm fmt:check`（oxfmt）对大量未改动文件也报格式问题，不是可用门禁。相关：[[ycode-main-v3143-merge]]

**已修复（2026-10-11，3.15.5 后续，gen-ui 通道）**：内联可视化卡片报 `Channel name 'gen-ui' timed out after 1000ms`（`packages/rpc/src/channelServer.ts` 对未注册 channel 等满 1000ms 后的回执）。根因与 WRC 同类：开源化改造 `df6b4647` 重写 `packages/services/src/node.ts` 装配时丢了 `.register(IGenUiService, createGenUiService({...}))`，连带整条沙箱登记链也被剪断——host `createPluginSandboxRegistrationBridge` 及其 `PluginSandboxRegisterResult` 回执、`desktopHostProcess.ts` 的 `PluginSandboxRegisterRequest` 转发分支、main `registerPluginSandbox` + `installPluginSandboxHost` + `registerLocalMediaPreviewScheme(protocol, [PLUGIN_SANDBOX_PRIVILEGED_SCHEME])`。`registerPluginSandbox` 的选项类型也从 `(input: unknown) => Promise<unknown>` 恢复为上游强类型。

**同一批还有 4 处构建接线被剪断**（只恢复服务装配的话卡片仍渲染不出来，沙箱 shell / 运行时资源会 404）：`vite.config.ts` renderer 入口缺 `"plugin-sandbox": src/renderer/plugin-sandbox.html`；`tsup.config.ts` 缺 `preload/pluginSandbox` 入口、缺整个 `plugin-sandbox-alias` 配置块（产出 `out/plugin-sandbox/{plugin-sandbox-alias.js,gen-ui.js}` 并 `onSuccess` 调 `copyGenUiRuntimeAssets`）、缺 `copyGenUiRuntimeAssets` 的动态 import；`packages/shared/src/channels.ts` 缺 `PluginSandboxChannels`（`guestPolicy.ts` 与 `preload/pluginSandbox/index.ts` 仍在 import，preload/main 的 esbuild 因此报 `No matching export`）。补回后 `pnpm exec tsup` 5 个配置全绿、`vite build` 产出 `out/renderer/plugin-sandbox.html`。注意 `copyGenUiRuntimeAssets` 也逐字节校验 vendor 哈希，所以 vendor 的 CRLF 问题（见 [[visualize-vendor-crlf-hashes]]）会让桌面生产构建直接失败，不只是独立导出。

逐字参考基线用 `git show aac47556:<file>`（origin/main 与 aac47556 在这些文件上完全相同）。消费端与服务端（`packages/ui/src/gen-ui/*`、`packages/services/src/gen-ui/*`、`packages/desktop/src/main/pluginSandbox/*`）都完好，是接线被剪断而非功能缺失。

**未恢复（有意，勿按「上游缺失」补回）**：同一次裁剪还丢了 `pluginUiBridgeService` / `pluginUiSamplingService` / `pluginUiAppToolsService` 三处注册。ycode 的 `zcodeAgentService` 把 `openMcpUiInstance`/`readMcpResource`/`sampleMcpApp`/`registerAppToolsForUi`/`listPluginUiSurfaces` 等全部实现为抛错桩（`"MCP UI host bridge is unavailable in this Ycode build"`），bootstrap 的 `mcpUiInstances`（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/instances.ts`）无任何引用。补宿主侧注册只会得到「通道存在、调用即抛错」。要恢复需先决定 agent 侧 MCP UI 桥与 `accountContext` 语义（账号体系已在 `specs/ycode-rebrand.md` 第 2 节有意移除）。

**已修复（2026-10-11，gen-ui 第 5 处漏接线，真机验收发现）**：`150d89a5` 之后代码/构建/单测三层都过，但**真机卡片仍不渲染**。日志里 gen-ui 通道、沙箱登记、`prepareSandbox` 全 OK，失败在加载沙箱页那一步：`[browser-pane] blocked unsupported webview url: zcode-sandbox://shell-<id>/instance/sb-<id>/`。根因是 `packages/desktop/src/main/desktopWindowChrome.ts` 的 `will-attach-webview` 里「插件沙箱 guest 独立分支」整段被剪：沙箱 shell 是 `zcode-sandbox://` 自定义 scheme，不在 `ALLOWED_EMBEDDED_BROWSER_PROTOCOLS` 里，于是掉进内置浏览器路径被白名单拦掉。补回 4 处：import、`pendingWebviewGuestKinds` 队列、will-attach 的 `isPluginSandboxSrc` 分支（host 拒绝/未安装 → `preventDefault` + warn）、did-attach 按队列 `attachGuest`。同批还发现 `desktopCommandHandlers.ts` 的「清除所有数据」漏了 `getPluginSandboxHost()?.clearBrowserData()`（沙箱在独立 partition，删 `~/.zcode/v2` 清不到）。

**为什么三层都过还是坏的**：`PluginSandboxHost` 的 `configureGuest`/`attachGuest` 注释本来就写着「desktopWindowChrome 的 will-attach / did-attach 分支」——host API 完好、类型也对，**typecheck 与单测都抓不到"调用点被删"**。只有真机（或 E2E）能发现。

**How to apply:** 再遇 gen-ui 卡片不渲染，先在日志里搜 `[browser-pane] blocked unsupported webview url` 与 `zcode-sandbox://`；`[plugin-sandbox] registered` + `prepareSandbox OK` 出现说明通道和登记没问题，问题在 webview attach。相关：[[ycode-wiring-guardrails]]

**Why:** gen-ui 与 plugin-ui 桥是两条独立 channel；gen-ui 只依赖 desktop main 的沙箱注册表，可单独恢复；plugin-ui 桥依赖被停用的 agent 侧能力，恢复面大得多。
**How to apply:** 再遇 `Channel name '<x>' timed out`，先查 `packages/services/src/node.ts` 的 `.register(...)` 链里有没有该 `channelName`，再用 `git diff aac47556 -- <file>` 找被剪掉的装配。相关：[[visualize-vendor-crlf-hashes]]

**已修复（2026-10-11，P1 网络抓包接线）**：`packages/desktop/src/host/hostNetworkCapture.ts` 曾是零引用孤儿，资源管理器「网络」页只显示 main 进程流量（静默的数据不完整）。按 `aac47556` 补回 5 处：`host/index.ts` 的 import、`const hostNetworkCapture = createHostNetworkCapture(parentPort)`、两处 dispose 的 `setCaptureId(null)`、`parentMsg` 的 `HostMessageTypes.NetworkCapture` 分支；`desktopHostProcess.ts` 补 `ingestHostNetworkCapture(result.data.batch, child.pid ?? 0)` 分支与 import。**只恢复 capture 半**：`NetworkTelemetryBatch` / `hostNetworkTelemetry` 喂的是已移除的 ARMS 遥测，`ingestHostNetworkObservations` 全仓无定义，不要恢复。回归用例加在 `packages/desktop/test/desktopHostProcess.test.ts`（用 `importOriginal` 只替换 `ingestHostNetworkCapture`，整体 mock 会打断 `resourceManagerWindow` 的 Host 注册链路）。

**2026-10-11 删除的零引用模块（判定为死代码，勿按「上游缺失」补回）**：`main/mcpUserDirectory/{claude,opencode,toml}.ts`（目录的 `index.ts` 仍活，只用 `.zcode/cli` 与 `.agents/mcp.json` 两个描述符）、`main/zcodeDataSize{Scanner,Worker,WorkerClient}.ts`（活的等价实现是 `storageScanWorkerClient.ts` + `services/src/storage/adapters/fsWalker.ts`）、`services/src/output-style/`（模块完整但注册被删且 UI 侧零引用）。`ServiceChannels.OutputStyle` 常量保留（协议词兼容）。`packages/shared/src/output-style.ts` 的三个类型仍留着（未在本轮删除范围）。

**2026-10-11 生成物入版本控制的坑**：`packages/desktop/src/scheduler/schedulerProtocol.{js,js.map,d.ts,d.ts.map}` 是 `tsc -b tsconfig.main.json` 的就地产物（该文件在 main 的 `rootDir` 之外，emit 路径塌回源码目录），且 `.d.ts` 相对 `.ts` 已过期（还留着 offpeak 协议）。已 `git rm --cached` 并加进 `.gitignore`，源码入库、生成物不入库。所有消费方都是 `import type`，运行时不解析该 `.js`。

**构建注意（2026-10-11 实测）**：本分支 `packages/desktop` 直接 `pnpm exec tsup` 会失败：`Invalid Built-in Provider config (test): config/provider/zcode-builtin.test.json`（默认 flavor 的 test 配置校验不过），**在 HEAD 上同样失败，是存量问题不是回归**。加 `ZCODE_ENV=production` 后 5 个块全绿。

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
