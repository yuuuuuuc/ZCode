# 与上游同步（zcode2）

`zcode2` 是 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的分支（发布仓库 [yuuuuuuc/ZCode](https://github.com/yuuuuuuc/ZCode)）。本文件记录相对上游的**故意偏离**与同步流程。

与已归档的 `ycode` 不同，`zcode2` **不是**品牌分支：产品身份、文案、图标、数据路径全部保持官方原样，只做「去官方遥测 + 去启动强更闸门」两件减法。目标是让差异面尽可能小，降低合并上游的成本与漏接线风险。

## 远端

```bash
git remote -v
# origin    https://github.com/yuuuuuuc/ZCode   （已配置）
# upstream  https://github.com/zai-org/ZCode    （尚未配置）
```

若 upstream 不存在：

```bash
git remote add upstream https://github.com/zai-org/ZCode
```

## 同步流程

```bash
# --no-tags 是必须的：上游与本分支用同一套 v3.15.x tag 名，但指向不同提交。
# 带 tags 抓取会让上游的同名 tag 与本地已有 tag 撞名。
git fetch upstream --no-tags

git merge upstream/main

# package.json version：major.minor 对齐上游线，patch 由本分支自己走；冲突时保留本分支值
node -p "require('./package.json').version"

node scripts/check-desktop-main-type-baseline.mjs   # 上游可能带进新的 main 类型错误
node scripts/check-desktop-orphan-modules.mjs
pnpm typecheck
pnpm lint
pnpm architecture:check
```

合并后如果护栏报出**新增**孤儿或类型错误，先判断是不是上游新引入的接线缺口——不要直接 `--update` 覆盖基线，那会把真实缺口洗成豁免。

### 版本号：只对齐大版本线，patch 自己走

- **`major.minor` 对齐上游发布线**（当前 `3.15`）。上游升到 `3.16` 时才换前两段。
- **`patch` 是本分支自己的递增**。`zcode2` 从官方 **v3.15.1** 基线重开，不延续 `ycode` 的 3.15.5 线。
- 正式版必须是**标准 semver 三段式**（`X.Y.Z`）。预发布可用 `X.Y.Z-rc.N`（见发版流程文档）。**不要用四段式**：应用内更新的版本比较（`autoUpdater.ts` 的 `isVersionGreaterThan`）先做 `semver.coerce` 再 `semver.gt`，四段式会被截断后误判「已是最新」。
- 产物名沿用官方模板：`ZCode-<version>-<平台>-<架构>.<ext>`。

发版与预发布（rc）流程、晋升前冒烟清单见 [`docs/RELEASE-PRERELEASE-FLOW.md`](docs/RELEASE-PRERELEASE-FLOW.md)。

## 偏离清单（要点）

### 1. 移除官方遥测

删掉的是**上报**，不是遥测这个能力本身：ARMS RUM（main / renderer / preload / shared 四层桥）、`/event/report` 事件上报、稳定性 / 资源 / 网络 / MCP / 数据体积上报及其派生模块，以及只测这些代码的测试。

**必须保留、不要跟着删的耦合点**（删掉会静默破坏通用能力）：

| 保留项 | 为什么 |
| --- | --- |
| `services/src/telemetry/telemetryCore.ts` 的 `ensureTelemetryDeviceMid` | `buildZCodeSourceHeaders()` 用它写 `X-Device-Mid`，喂远程 workspace 的 billing / balance 请求；整个文件删掉会让远程计费退化成 parameter error |
| `main/appLaunchCoordinator.ts` | 通用启动门，只是原先被 `appTelemetryRuntime` 包着调用。删 runtime 后必须直连回 `RendererReady` / `OAuthCallbackHandled`，否则启动门永远不推进 |
| `main/appCrashCaptureBootstrap.ts` 的 `remoteCrashReporterEnabled = false` | 官方 ARMS 一删，本地 `crashReporter` 必须接管，否则本地崩溃上报静默消失 |
| `main/localTtftExporter.ts`、`rendererActionTrace*`、`ui/v4/telemetry/localTtft*`、`ui/lib/userActionTelemetry.ts` | 走 **OTLP**（用户自接 collector），不是官方上报。不要按文件名里的 "telemetry" 一刀切 |
| `shared/src/channels.ts` 的遥测通道常量 | 协议词，按「保留分支、处理函数 no-op」处理，不删常量 |

### 2. 移除启动强更闸门

删掉 `forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`shared/forceUpdate.ts` 与启动路径的判定/拦截分支；`createPrimaryWindowCoordinator` 的 `canCreateWindow` 恒为 `true`，打包版不再因远端 `forceUpdate.minimalVersion` 拒绝创建主窗口。

**保留** `main/autoUpdater.ts` 与 `requestForceAutoUpdate`（帮助菜单「检查更新」是普通功能）。`/api/v1/client/configs` 仍被上下文灰度、renderer action trace、帮助配置读取，那些不是闸门。

### 3. 有意不动的东西

- **产品身份**：`desktop-product-identity.mjs` 的 `appId: dev.zcode.app` / `productName: ZCode` 原样保留，与官方包**不能并排安装**。
- **数据根共享** `~/.zcode`：会话库、设置、凭据与官方客户端共用，不要双端同时操作同一会话或同时改 `setting.json` / `provider_config.json`。
- **账号 / 登录代码全部保留**。首次启动会看到 WelcomeScreen，走 API-key 入口即可进入；未做「登录墙」改造。

### 4. 漏接线护栏

`verify:static`（本地 `pre-push` 钩子）与 CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)，`windows-latest`）里都挂着，专抓「模块在、接线没了」——静态类型检查看不见这类缺口：

- `scripts/check-desktop-main-type-baseline.mjs`：`pnpm typecheck` **不含** `packages/desktop/tsconfig.main.json`，所以 main 进程的类型错误会漏网；本脚本对它做棘轮。**不要**从 typecheck 工程列表里删掉 `packages/desktop/tsconfig.e2e.json`。
- `scripts/check-desktop-orphan-modules.mjs`：扫 `packages/desktop/src/{host,main}` 的零引用模块。只数**生产引用**（测试 import 不算接线），按 basename 匹配（同名文件会互相遮蔽）。
- `packages/services/test/localServiceChannelCoverage.test.ts`：断言客户端请求的每个服务通道都有本地实现。

背景与后续工单见 [`docs/ycode-wiring-gaps-followup.md`](docs/ycode-wiring-gaps-followup.md)（该文档记的是 `ycode` 时期的事故，`zcode2` 上仍适用）。
