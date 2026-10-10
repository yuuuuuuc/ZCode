# 与上游同步（Ycode）

Ycode 是 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的分支（发布仓库 [yuuuuuuc/ZCode](https://github.com/yuuuuuuc/ZCode)）。本文件记录相对上游的**故意偏离**与同步流程。品牌保持 **Ycode**（`dev.ycode.app`），不要改成 ZCode-Libre。

## 远端

```bash
git remote -v
# origin    https://github.com/yuuuuuuc/ZCode
# upstream  https://github.com/zai-org/ZCode
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

pnpm audit:upstream               # 可选：标出触碰偏离文件的上游提交
git merge upstream/main

# package.json version：major.minor 对齐上游线，patch 由 Ycode 自己走；冲突时保留本分支值
node -p "require('./package.json').version"

pnpm check:defaults
pnpm typecheck
pnpm lint
```

### 版本号：只对齐大版本线，patch 自己走

- **`major.minor` 对齐上游发布线**（当前 `3.15`）。上游升到 `3.16` 时才换前两段。
- **`patch` 是 Ycode 自己的递增**（例如上游 3.15.1 之后本分支发 3.15.2）。
- 正式版必须是**标准 semver 三段式**（`X.Y.Z`）。预发布可用 `X.Y.Z-rc.N`（见发版流程文档）。**不要用四段式**，否则 `githubReleaseUpdates.ts` 的 `semver.coerce` 会截断后误判「已是最新」。
- 产物名：`Ycode-<version>-<平台>-<架构>.<ext>`。

发版与预发布（rc）流程、晋升前冒烟清单见 [`docs/RELEASE-PRERELEASE-FLOW.md`](docs/RELEASE-PRERELEASE-FLOW.md)。

## 偏离清单（要点）

### 1. 产品身份

- `packages/desktop/scripts/desktop-product-identity.mjs`：`appId` → `dev.ycode.app`；`productName` → `Ycode`
- 品牌文案与图标保持 Ycode，不要并入上游 ZCode / Libre 命名

### 2. 运行时身份与数据路径

- `desktopRuntimeEnv.ts`：`runtimeApplicationName` 为 `Ycode` / `Ycode Dev` / `Ycode Preview`，Electron `userData` 同名，可与官方 ZCode **并排运行**
- **`.zcode` 数据根共享**（`packages/services/src/paths.ts` 未改）：会话库、设置、凭据与官方客户端共用
- 并排运行时不要双端操作同一会话，也不要同时改 `setting.json` / `provider_config.json`（详见 README）

### 3. 默认关闭策略（`packages/shared/src/ycode-features.ts`）

| 策略项 | 默认 |
| --- | --- |
| officialAccountLogin | false（OAuth / Welcome 登录页在 Ycode 中已硬删除，fail-closed） |
| conversationShare | false |
| feedback | false |
| codingPlanPurchase | false（Coding Plan UI 已硬删除） |
| pluginMarketplaceRemoteSource | false |
| selfHostedReleaseUpdates | true |
| vendorCommunityLinks | false |
| officialAccountCredentials | false |

遥测：`ZCODE_TELEMETRY_ENABLED` 读环境变量，默认关闭；官方 ARMS 装配已移除。

### 4. 应用内更新

- `packages/desktop/src/main/githubReleaseUpdates.ts` 查询 `yuuuuuuc/ZCode` 的 GitHub Release
- 菜单「检查更新」只检测并提供「前往下载」，**不**走厂商 manifest 安装
- `autoInstallOnAppQuit` 在自有 Release 模式下保持 false

### 5. 启动与 API Key

- 官方账号登录入口已删除；用户通过设置页配置 API Key
- 策略项 `officialAccountLogin: false` 保留，便于日后 gated stub 合回

### 6. 关窗清理（3.15.2 / 3.15.3 修复）

- OAuth 剥离后深链清理函数更名为 `clearPendingRoutesForWindow`
- `desktopMainIpcRemote.ts` / `index.ts` 关窗必须调用该函数（或已导出的同名别名），**不得**调用未导入的 `clearOAuthRoutesForWindow`（Windows 会 `ReferenceError` 崩溃）
- Ycode 裁剪官方 web remote control 后，`createWindow` **不再注入** `webRemoteControlManager`；`desktopWindowLifecycle.ts` 的 `closed` 路径必须对 `disposeWindow` **optional-chain / no-op**（3.15.3：`Cannot read properties of undefined (reading 'disposeWindow')`）
- `createRemoteWorkspaceSessionManager` 的 `webRemoteControlManagerRef` 可为 null；连接断开时用 `?.current?.failRemoteSession`

## 冲突热点

1. i18n 文案与品牌名
2. `desktop-product-identity.mjs` / electron-builder
3. `desktopRuntimeEnv.ts`（保留 Ycode userData 名，保留 `.zcode` 共享）
4. `ycode-features.ts` 与其引用点
5. `autoUpdater.ts` 自有 Release 分流须在 startup/poll 之前
6. `desktopMainIpcRemote.ts` / `desktopWindowLifecycle.ts` 关窗清理符号（OAuth clear* + WRC disposeWindow）

## 同步后自检

```bash
pnpm check:defaults
pnpm typecheck && pnpm lint
rg -n "clearOAuthRoutesForWindow\(windowWebContentsId\)" packages/desktop/src/main/
rg -n "webRemoteControlManager\.disposeWindow" packages/desktop/src/main/
rg -n "dev.zcode.app" packages/desktop/scripts/
```
