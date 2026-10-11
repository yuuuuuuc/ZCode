# 从 main 重开分支的方案（已定稿 · 可执行）

> 目标：摆脱 `ycode` 分支「在整体重写过的基线上反复补漏接线」的困境，改为**从官方 `origin/main` 出发、只做减法**的新分支 `zcode2`。
> 决策已拍板（见 §8），本文可直接作为开工工单。

---

## 开工前必读（面向新会话）

0. **本文与所有可移植资产目前只存在于 `ycode` 分支**。切到 `zcode2` 后它们不在工作区，先取回：
   ```
   git checkout ycode -- docs/FRESH-BRANCH-FROM-MAIN-PLAN.md docs/ycode-wiring-gaps-followup.md \
     docs/RELEASE-PRERELEASE-FLOW.md memory/ MEMORY.md \
     scripts/check-desktop-orphan-modules.mjs scripts/check-desktop-main-type-baseline.mjs \
     packages/services/test/localServiceChannelCoverage.test.ts
   ```
   （基线 JSON 不要这样取，按 §P0-4 在新分支重新生成。）
1. **基线**：`origin/main` = `aac47556` = 官方 ZCode v3.15.1 原样（已核实，不是 fork 内容）。
2. **参考基线**：`git show aac47556:<file>` 永远是可用的上游原文。
3. **可移植资产**（都在 `ycode` 分支上，新分支需要手动搬）：
   - `scripts/check-desktop-orphan-modules.mjs` + `.desktop-orphan-modules-baseline.json`
   - `scripts/check-desktop-main-type-baseline.mjs` + `.desktop-main-type-baseline.json`
   - `packages/services/test/localServiceChannelCoverage.test.ts`
   - `docs/RELEASE-PRERELEASE-FLOW.md`、`docs/ycode-wiring-gaps-followup.md`
   - `memory/` 全部（尤其 `ycode-opensource-audit.md`、`ycode-wiring-guardrails.md`、`local-machine-ipv6-blocked.md`）
   - 基线 JSON 要**在新分支重新生成**（`--update`），不要直接复制旧数字。
4. **本机已知环境坑**：出网 IPv6 被第三方 WFP 驱动整体阻断 → `pnpm dev:desktop` 会卡在等 Vite。
   绕开：`NODE_OPTIONS=--dns-result-order=ipv4first`（PowerShell 用 `$env:NODE_OPTIONS=...`）。详见 `memory/local-machine-ipv6-blocked.md`。
5. **执行顺序**：P0 → P1 → P2 → P4（P3 本次不做）。每阶段独立提交、独立验收（§7）。

### 执行清单

```
[ ] P0-1  git checkout -b zcode2 origin/main
[ ] P0-2  未改动状态下跑通 pnpm install --frozen-lockfile / typecheck / lint / architecture:check
[ ] P0-3  确认 typecheck 脚本仍含 packages/desktop/tsconfig.e2e.json（不要删）
[ ] P0-4  从 ycode 移植两道护栏脚本 + 通道覆盖测试，基线用 --update 重新生成
[ ] P0-5  挂进 verify:pre-push；移植 RELEASE-PRERELEASE-FLOW.md（含 gen-ui / 网络页两条冒烟）
[ ] P0-6  移植 memory/ 与 docs/ycode-wiring-gaps-followup.md
[ ] P1-1  §5.1 纯删除叶子文件
[ ] P1-2  §5.2 共享文件手术（逐簇摘除，不重写）
[ ] P1-3  §6 陷阱 1：telemetryCore.ts 拆分，保留 ensureTelemetryDeviceMid
[ ] P1-4  §6 陷阱 2：appLaunchCoordinator 直连回 RendererReady / OAuthCallbackHandled
[ ] P1-5  §6 陷阱 3：appCrashCaptureBootstrap.ts 的 remoteCrashReporterEnabled 改回 false
[ ] P1-6  §5.4 测试清理（约 110 文件；skip 必须带原因 + 指针）
[ ] P1-7  门禁全绿 + 真机冒烟（gen-ui 卡片 / 网络页 / API-key 对话）
[x] P2-1  删强更 gate 与拦截分支，保留 autoUpdater.ts
[ ] P2-2  真机确认打包版启动不再请求 /api/v1/client/configs，「检查更新」仍可用
[ ] P4-1  rc → 维护者 dogfood → 正式版
```

---

## 0. 结论先行

`ycode` 的问题不是「漏了几个接线」，而是**基线本身是被重写过的**：改造提交 `df6b4647` 一个提交就动了 608 个文件、删了 78,491 行，其中包含对 `node.ts`、`main/index.ts`、`desktopHostProcess.ts`、`desktopWindowChrome.ts`、`channels.ts` 这些**共享装配文件**的成片删除。之后每一次「恢复接线」都是在猜当初删掉了什么。

新策略把风险结构换掉：

| | ycode（现状） | 新分支 |
| --- | --- | --- |
| 起点 | 官方 v3.15.1 + 一个 608 文件的重写提交 | 官方 v3.15.1 **原样** |
| 改动性质 | 大量删除 + 局部重建 | **纯减法，不重写** |
| 共享文件 | 被成片改写 | **尽量不碰；必须碰时只做「可选化」** |
| 与上游差异 | 908 文件 / +9,403 / −146,587 | 目标是**降到两位数文件** |
| 合并上游 | 每次 merge 都踩一堆冲突 | 差异小，冲突可控 |

---

## 1. 事实基线（已核实）

- `origin` = 个人 fork `yuuuuuuc/ZCode`；**没有配置 `upstream` remote**（`UPSTREAM.md` 里写了要 `git remote add upstream https://github.com/zai-org/ZCode`）。
- **`origin/main` = 官方 ZCode v3.15.1 原样**，tip 就是 `aac47556`，ARMS / TelemetryCore / 智谱内置供应商 / coding-plan / off-peak / OAuth 全在。
- `ycode` = `origin/main` + **26 个提交**（0 behind），合计 **908 文件 / +9,403 / −146,587**。
- 其中 `df6b4647`（开源化改造）= **608 文件 / +1,957 / −78,491**，本质是一次**大规模删除**。
- 两侧 monorepo 布局相同；唯一构建配置差异：**`ycode` 的 `typecheck` 脚本删掉了 `packages/desktop/tsconfig.e2e.json`**——这正是记忆里记的「typecheck 覆盖盲区」。
- `main` 与 `ycode` 上都有 `tsconfig.main.json` / `tsconfig.host.json`。

---

## 2. 三条核心原则

1. **只做减法，不重写。** 每一处改动都必须能回答「为什么必须删/改」；回答不了就保留上游原样。
2. **耦合点只做「可选化」，不做「删除」。** 这是 `ycode` 全部崩溃的根因类别。具体做法：
   - 必填回调 → 改成 `?` 可选 + 调用点用 `options.x?.(...)`；
   - 服务注册 → **保留注册**，只让实现降级（no-op / 空数组）；
   - 协议分支 → **保留分支**，让处理函数 no-op。
   这样「调用点假定旧符号存在」这类崩溃从结构上不可能发生。
3. **不确定的一律保留。** 宁可留一个用不上的功能，也不要剪断一条线。

---

## 3. 分支模型

```
origin/main (官方 v3.15.1)  ──┬──> zcode2（本方案产物）
                              └──> ycode（保留为归档，含护栏脚本与记忆）
```

- `git checkout -b zcode2 origin/main`，并把 `main` 设为它的上游跟踪分支（便于随时 merge 上游更新）。
- 建议同时 `git remote add upstream https://github.com/zai-org/ZCode`，并沿用 `UPSTREAM.md` 的 `git fetch upstream --no-tags`（上游会复用同名 tag，必须 `--no-tags`）。
- **`ycode` 不要删**：它承载了记忆、护栏脚本、以及「哪些坑踩过」的全部现场证据。

---

## 4. 阶段计划

### P0 · 干净基线 + 护栏（先做，成本最低、收益最高）

1. 从 `origin/main` 建分支，确认 `pnpm install --frozen-lockfile` + `pnpm typecheck` + `pnpm lint` 在**未改动**状态下全绿（这是「官方基线可用」的证明）。
2. **保留 `main` 的完整 typecheck 工程列表**（含 `packages/desktop/tsconfig.e2e.json`）——不要重蹈 ycode 删掉它的覆辙。
3. 从 `ycode` 移植三道护栏（它们的基线文件需在新分支重新生成）：
   - `scripts/check-desktop-orphan-modules.mjs`（孤儿模块扫描）
   - `scripts/check-desktop-main-type-baseline.mjs`（main 工程类型棘轮）
   - `packages/services/test/localServiceChannelCoverage.test.ts`（通道覆盖）
   并挂进 `verify:pre-push`。
4. 从 `ycode` 移植 `docs/RELEASE-PRERELEASE-FLOW.md`（rc + 真机冒烟流程），其中 §3 的清单**必须包含 gen-ui 卡片与资源管理器网络页两条**——它们是这次真机才发现问题的直接产物。

**交付判据**：分支 = 官方 v3.15.1 + 护栏，功能零改动，真机可启动。

### P1 · 移除官方遥测（唯一必做减法）

范围见 §5。**注意三个陷阱（§6）**——它们都会静默破坏通用能力。

**交付判据**：全仓 grep 无 ARMS / TelemetryCore / `reportTelemetryEvent` / `reportArmsCustomEvent` 残留；`pnpm typecheck` / `lint` / `architecture:check` 全绿；真机跑通冒烟清单（含 gen-ui 卡片、网络页、API-key 对话）。

### P2 · 去掉启动强更 kill-switch（**本次要做**，独立于遥测）

`main` 的启动路径上有 `maybeBlockStartupForForceUpdate`（`packages/desktop/src/main/index.ts:2527`），会拉 `zcode.z.ai/api/v1/client/configs` 判定是否禁止启动。它在网络失败时 fail-open，但**这是一个上游可远程锁死本 fork 启动的通道**。

对 fork 来说这是真实的可用性风险，且删除面很小（`forceUpdateGuard.ts` / `forceUpdatePrompt.ts` / `shared/forceUpdate.ts` + `main/index.ts` 的门与拦截分支 + i18n 文案）。`ycode` 已经删过一次，可直接参考。

> ⚠️ 删这个时**不要连带删 `autoUpdater.ts`**——帮助菜单「检查更新」是普通功能，其内部强更联动分支在无监听者时自然退化。

**交付判据**：启动路径不再调用 `maybeBlockStartupForForceUpdate`，打包版不会因 `forceUpdate.minimalVersion` 拒绝创建主窗口。「检查更新」仍走 `autoUpdater.ts`。同一 URL 仍被上下文灰度、renderer action trace、帮助配置读取；那些不是闸门，保留。

### P3 · 登录墙 —— **本次不做**（已拍板：接受 WelcomeScreen 可跳过）

保留全部账号代码，风险为零；首次启动会看到 WelcomeScreen，走 API-key 入口即可进入。

> 以下是**将来**若要做的做法，本次不要动：


1. `packages/ui/src/root/useProviderAvailabilityLoginEntryGuard.ts:67` —— 当前是
   `!providerFamilyDomain || (!user && !hasUsableProvider)`；`providerFamilyDomain` 只由账号型 provider 推出，自定义/API-key 永远是 `null`，于是**纯 API-key 用户每次启动都被送进 WelcomeScreen**。去掉 `!providerFamilyDomain` 这一项即可。
2. 可选：`Root.tsx` 的 `WelcomeScreen` 分支直接跳过。

> **不要**去删 `useRootOAuthEffects` / `isRestoringOAuthSession`——见 §6 陷阱 4，那是把启动永久卡死的做法。

### P4 · 真机冒烟 + 发版

沿用移植过来的 `RELEASE-PRERELEASE-FLOW.md`：门禁 → rc → 维护者 dogfood → 正式版。

---

## 5. P1 遥测移除的详细清单

### 5.1 纯删除（叶子文件，无通用调用方）

**桌面 main（ARMS）**：`appARMSBootstrap.ts`、`armsEventRedaction.ts`、`armsUserIdentity.ts`、`armsBrowserPerfLoadNudge.ts`、`desktopArmsCustomEvent.ts`、`desktopMcpTelemetry.ts`、`desktopNetworkTelemetry.ts`、`networkTelemetryAggregator.ts`、`desktopRemoteUsageArmsTelemetry.ts`、`desktopResourceTelemetry.ts`、`desktopStabilityTelemetry.ts`、`desktopZCodeDataSizeTelemetry.ts`、`zcodeDataSizeTelemetryState.ts`、`databaseStartupTelemetry.ts`、`processResourceMcpTelemetrySource.ts`、`startupTelemetryDelivery.ts`、`desktopTelemetryFetch.ts`、`appTelemetryRuntime.ts`

**desktop shared/preload/renderer**：`shared/armsRumShared.ts`、`shared/armsRumBridgeForward.ts`、`shared/armsBrowserInit.ts`、`renderer/src/armsBrowserBootstrap.ts`、`renderer/appTelemetryBridge.ts`

**UI**：`lib/uiPerfArmsTelemetry.ts`、`lib/sessionOpenArmsTelemetry.ts`、`lib/sendFunnelArmsTelemetry.ts`、`lib/reactErrorArmsTelemetry.ts`、`lib/planUsageArmsTelemetry.ts`、`lib/armsCustomEventObservability.ts`、`lib/chatErrorBannerTelemetry.ts`、`lib/automationTelemetry.ts`、`lib/offPeakTelemetry.ts`、`lib/promptTemplateTelemetry.ts`、`lib/sessionCreateTelemetry.ts`、`lib/providerTelemetryIdentity.ts`、`lib/messageTelemetry.ts`、`lib/conversationTelemetry*E2E.ts`（3 个）、`onboarding/useOnboardingTelemetry.ts`、`v4/telemetry/*`（除 OTLP 那几个）

**其它**：`patches/@arms__rum-electron@0.0.3.patch`、`scripts/test/arms-patch-install-contract.test.mjs`、`packages/desktop/test/mocks/armsRumElectronStub.ts`、`packages/shared/src/telemetryRedaction.ts`

### 5.2 共享文件手术（每处都要按「可选化」原则做）

| 文件 | 手术内容 |
| --- | --- |
| `packages/shared/src/platform.ts` | 删 `reportTelemetryEvent` / `reportArmsCustomEvent` 两个成员 + 其类型 import。**注意有 3+ 个实现方**（desktopPlatform、web/main.tsx 三处、各测试 mock）都要同步删 key，否则 TS 报错 |
| `packages/shared/src/channels.ts` | 删 3 个 telemetry 常量 + 3 个 E2E ring 常量 + 对应 type map 条目（与通用通道交错，逐条删） |
| `packages/desktop/src/preload/index.ts` | 删顶部两处 ARMS bridge 安装（`scheduleArmsEventBridgePatch`）、`window.zcode` 桥里的 3 个 key、`__zcodeFinalArmsCustomEventsE2E` contextBridge |
| `packages/desktop/src/main/desktopMainIpcRemote.ts` | options 里的 telemetry keys；`SyncTelemetryContext` / `ReportTelemetryEvent` / `ReportArmsCustomEvent` 三个 handler 整删；**`RendererReady` 与 `OAuthCallbackHandled` 两个 handler 要留**（前者还负责 `deliverPendingDeepLink`），只摘掉里面的 `appTelemetryRuntime.*` 调用 |
| `packages/desktop/src/main/index.ts` | ~120 处引用、6 个簇。**逐簇摘除，不要整块重写**；特别注意 `:1187` quit barrier 的 `Promise.all` 只删 `flushPendingReports` 一项 |
| `packages/services/src/node.ts` | 只删 2 行 barrel export + 4 个 loader 函数（`:2705-2780`）。**2868 行里其余全部无关，不要碰** |
| `packages/ui/src/Root.tsx` | 5 个簇：reporter 注册 effect、parity E2E bridge、`reconcileConversationTelemetryWorkspaceScopes` 等。Root 是应用根，其余全是通用代码 |
| `packages/ui/src/index.ts` | 删 3 行 export（`reportUiLaunchToInput` / `setReactErrorArmsReporter` / `recordArmsCustomEventForE2E`） |
| `packages/web/src/main.tsx` | 两处 `IPlatformService` 实现删 key；mobile transport 的两处 `telemetry-report` sender |
| `vitest.config.ts` | **必须删** `__ZCODE_TELEMETRY_REPORT_ENDPOINT__` define 与 ARMS alias（`:48-49,58-65`）——alias 指向被删的 stub 会让**全部测试**失败 |
| `scripts/build-time-config.mjs` | 删两个 `__ZCODE_*_ENDPOINT__` key（`autoUpdateEnabled` 保留） |
| `packages/shared/src/env.ts` + `index.ts` | 删 `ArmsRumEnv` / `ZCODE_ARMS_RUM_ENDPOINT` / `ZCODE_TELEMETRY_REPORT_ENDPOINT` / `mapZCodeEnvToArmsRumEnv` 及其 barrel re-export |

### 5.3 **必须保留**（System C / OTLP，spec 已明确保留）

`packages/ui/src/lib/userActionTelemetry.ts`（**24 个 import 方**）、`packages/ui/src/v4/telemetry/localTtft*.ts`、`packages/desktop/src/main/rendererActionTrace*.ts`、`localTtftExporter.ts`、`packages/services/src/zcode-agent/agentTelemetryEnv.ts`、`packages/shared/src/rendererActionTrace.ts`、`packages/shared/src/zcode-protocol-v4/telemetry.ts`、`apps/zcode-cli/packages/telemetry/**`。

> 判定依据：这些走 **OTLP**（`OTEL_EXPORTER_OTLP_*`，用户自接 collector），不是官方上报。**不要按文件名里的 "telemetry" 一刀切。**

### 5.4 测试清理

约 **110 个测试文件**要删或 skip（desktop ~37、desktop host ~7、UI ~25、services ~12、shared ~11、e2e ~10 + fixtures/helpers、scripts 2、server/rpc 各 1）。这些测的是被删代码，必须同步处理，否则 pre-push 门禁永远红。

> 参考 `ycode` 的做法：新增 `describe.skip` 必须带**原因 + 指针**，否则红名单会变成永久垃圾场。

---

## 6. 三个必须避开的陷阱（都会静默破坏通用能力）

### 陷阱 1 · `telemetryCore.ts` 不能整个删

`ensureTelemetryDeviceMid` 被 `packages/server/src/stdioDeviceMid.ts` → `entry-stdio.ts` 用来写 **`X-Device-Mid`** 头，喂的是 remote workspace 的 **billing/balance 请求**（`buildZCodeSourceHeaders()` 读 `telemetry-state.json` → `nodeApiClient.ts` / `offPeakServerClient.ts`，都是通用路径）。

**整个文件删掉 → 远程 workspace 计费请求退化成 parameter error。**

**做法**：拆开——保留 `ensureTelemetryDeviceMid` + state/lock 机制，只删 `createTelemetryCore` 与 `/event/report` 发送器。
（spec §1 自己的注脚也承认：deviceMid 只有在**同时**做 §2 时才安全删除。这也正是本方案不做 §2 的原因之一。）

### 陷阱 2 · `appLaunchCoordinator` 不能跟着 `appTelemetryRuntime` 一起删

`appLaunchCoordinator` 是**通用启动门**，但它被 `appTelemetryRuntime` **包着**调用（`appTelemetryRuntime.ts:111-121`），而 `desktopMainIpcRemote.ts` 的 `RendererReady` / `OAuthCallbackHandled` 又是通过 telemetry runtime 调它。

**做法**：删 runtime 后，把 coordinator 直连回这两个 handler（`hasPendingOAuthCallback: false`），否则**启动门永远不推进**。

### 陷阱 3 · `appCrashCaptureBootstrap.ts` 的 crash reporter 要恢复

`packages/desktop/src/main/appCrashCaptureBootstrap.ts:6` 硬编码 `remoteCrashReporterEnabled = true`，注释写着「ARMS 已接管远端 crash 上报，不再启动仅本地的 crashReporter」。

**ARMS 一删，这里必须改回 `false`**，否则**本地崩溃上报静默消失**——这类"删了上游依赖但没恢复降级路径"的问题，正是 `ycode` 反复踩的。

### 陷阱 4（若做 P3）· 不要删 `useRootOAuthEffects` / `isRestoringOAuthSession`

`Root.tsx:249-251` 把 `initialIsRestoringOAuthSession` **硬编码为 true**，而全仓唯一把它写成 `false` 的地方是 `useRootOAuthEffects.ts:165`。

**删掉 OAuth 链 → 这个 flag 永远是 true → Root 永久渲染 `<RootStartupLoading>`**（黑屏/logo 卡住，永远进不去工作区）。侧栏 footer 也有一处同样的 `isRestoringOAuthSession` 会永久转圈。

**做法**：保留该 effect（无凭据时它自然退化），或同时把 `Root.tsx:596` / `useRootPlatformEffects.ts:299` 的 `isResolvingStartupAuthState` 固定为 `false`——**绝不能只删 effect**。

---

## 7. 验收标准

每个阶段独立验收，真机为准：

| 项 | 判据 |
| --- | --- |
| 门禁 | `pnpm typecheck`（**含 `tsconfig.e2e.json`**）0 错误；`pnpm lint` 0 错误；`pnpm architecture:check` 0 违规；两条新护栏通过 |
| 启动 | 装机即启动，无「未接线」类崩溃；开关窗、切标签页正常 |
| 模型 | API-key 供应商（DeepSeek 等）正常流式对话；无 `Provider request auth is unavailable` |
| gen-ui | 让模型产出内联可视化卡片，卡片渲染且可交互；日志无 `Channel name 'gen-ui' timed out`、无 `[browser-pane] blocked unsupported webview url` |
| 资源管理器 | 「网络」页能看到 `host` / `cli` 进程记录，不只是 `main` |
| 远程 | 远程 workspace 连接 + 模型调用**有凭据**（`ycode` 上这条链被删过，`resolveProviderApiKey` 恒 null，未实测） |
| 遥测 | 全仓 grep 无 ARMS / TelemetryCore 残留；打包版启动不向官方端点发事件 |
| 差异面 | `git diff --stat origin/main...<新分支>` 显著小于 ycode 的 908 文件 |

---

## 8. 已定决策（2026-10-11 拍板）

| # | 决策 | 影响 |
| --- | --- | --- |
| 1 | **品牌保留 ZCode** | 不动 `desktop-product-identity.mjs`、i18n 文案、logo。省掉一整块风险面 |
| 2 | **版本从 `3.15.1` 起** | `package.json` 维持官方版本号。**已知代价**：已装 `ycode` 3.15.5 的机器看不到应用内更新（`semver` 比较下 3.15.1 < 3.15.5），需要手动换装 |
| 3 | **P3 登录墙不做** | 接受首次启动 WelcomeScreen，走 API-key 入口进入。全部账号代码保留 |
| 4 | **P2 强更 kill-switch 要做** | 删掉启动时拉 `zcode.z.ai/api/v1/client/configs` 的判定与拦截分支；**保留 `autoUpdater.ts`** |
| 5 | **数据目录继续共用 `~/.zcode`** | 与官方客户端共用，两个客户端不能同时装（与 ycode 现状一致） |
| 6 | **分支名 `zcode2`** | `git checkout -b zcode2 origin/main` |

### 由此确定的改动范围（最终）

| 阶段 | 内容 | 必做 |
| --- | --- | --- |
| P0 | 建 `zcode2` + 移植护栏 + 保留含 `tsconfig.e2e.json` 的 typecheck | ✅ |
| P1 | 移除官方遥测（§5，注意 §6 陷阱 1/2/3） | ✅ |
| P2 | 移除启动强更 kill-switch | ✅ |
| P3 | 登录墙 | ❌ 不做 |
| P4 | 真机冒烟 + rc + 发版 | ✅ |

**总差异面预期**：`git diff --stat origin/main...zcode2` 应远小于 ycode 的 908 文件——P1 是删除为主，P2 是小范围删除，其余为零改动。

---

## 附：本方案的证据来源

- `origin/main` = `aac47556`（官方 v3.15.1），`ycode` = main + 26 提交（已核实）。
- 遥测清单与陷阱 1/2/3：对 `origin/main` 的逐文件核对（含 `services/src/node.ts`、`desktop/src/main/index.ts`、`desktopMainIpcRemote.ts`、`preload/index.ts`、`vitest.config.ts` 等）。
- 通用能力清单与陷阱 4、B3–B12 各类耦合点：对 `origin/main` 的 `Root.tsx`、`rootStartupGate.ts`、`useProviderAvailabilityLoginEntryGuard.ts`、`desktopMainIpcPlatform.ts`、`desktopWindowLifecycle.ts`、`scheduler/index.ts`、`accessor.ts`、`runner.ts` 等逐点核对。
- 历史教训：`ycode` 的 `df6b4647`（608 文件 / −78,491 行）与后续 5 次漏接线修复（gen-ui 注册、WRC 回调、网络抓包、plugin-sync、webview attach）。
