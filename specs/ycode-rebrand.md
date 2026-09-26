# Ycode  rebranding 与官方遥测/内置供应商移除

分支：`feature/rebrand-ycode`。本仓库从闭源产品 ZCode 开源，本 spec 定义三项行为变更的产品规则、所有者与验收场景。

## 1. 移除官方遥测（出网上报）

**规则**：Ycode 不包含任何官方产品时代的数据出网上报。用户本机数据不以任何形式发送到官方端点。

- 移除系统 A：阿里云 ARMS RUM 前端监控（`@arms/rum-electron` 依赖、`patches/@arms__rum-electron@0.0.3.patch`、desktop main/preload/shared 的 ARMS 初始化与桥接、所有 `sendCustom` 生产者、IPC 通道 `ReportArmsCustomEvent`、`IPlatformService.reportArmsCustomEvent`、UI 侧 `*ArmsTelemetry.ts`、E2E 捕获环）。
- 移除系统 B：自研数仓埋点（`packages/services/src/telemetry/` TelemetryCore → `/event/report`、UI 侧 `appTelemetry.ts` 及各事件生产者、IPC 通道 `ReportTelemetryEvent`/`SyncTelemetryContext`、`IPlatformService.reportTelemetryEvent`、设备标识上报）。`deviceMid` 本地身份模块随计费链（见第 2 节）一并移除。
- **边界裁决**：CLI 侧 conversation telemetry fact 链（`v4-gateway.ts`/`v4-bridge.ts` → `onDynamicConversationTelemetryFact`）保留——其消费者是用户自托管 server 的会话活动统计（`taskActivityTracker`）与本地 TTFT 观测，数据只流向用户自己的 server，不属于官方上报。
- 移除 `packages/shared/src/env.ts` 中 `ZCODE_TELEMETRY_ENABLED` / `ZCODE_ARMS_RUM_ENDPOINT` / `ZCODE_TELEMETRY_REPORT_ENDPOINT` 及相关接线。
- **保留**系统 C：OpenTelemetry OTLP（`apps/zcode-cli/packages/telemetry`、desktop `localTtft*` 等）。理由：纯 env opt-in、仓库不带默认端点，属于用户自接 collector 的可观测性能力，不是官方上报。
- **保留**本地功能：「使用统计」页面（本地数据库统计 + 读取用户自己配额的 monitor API，不上报本机数据）。

**验收**：全仓 grep 无 `armsRum`、`sendCustom`、`reportTelemetryEvent`、`TelemetryCore` 残留；`pnpm typecheck` 通过。

## 2. 移除内置智谱供应商与套餐/账号链

**规则**：模型设置只保留「自定义供应商」（通用 OpenAI 兼容等模板与用户自建供应商）。不再内置任何智谱（Z.ai / BigModel）账号型供应商、Start Plan 套餐、订阅购买与智谱账号登录。

- 数据层：`config/provider/zcode-builtin.json` 删除 4 个智谱模板规则（`zai-api`、`zai-standard-api`、`bigmodel-api`、`bigmodel-standard-api`）与全部 8 个 `account:*` providerRules；保留 `glm-*` 模型规则（用户自建 GLM 供应商仍需要）与非智谱模板。移除 `packages/provider-node` 的 CDN 远端刷新（`zcode-builtin-remote-synchronizer`），防止官方 release 把内置供应商推回。
- UI：`ModelProviderSection` 不再有「智谱」分组与 Start Plan 条目；`ProviderTemplatePicker` 移除智谱分组；删除 Start Plan 详情面板、套餐卡片、购买 webview、配额横幅、Start Plan 推荐弹窗、composer 套餐标签。
- 服务层：删除 `coding-plan-subscription/`、`usage-stats/providers/bigmodel*`、`official-mcp` 凭证、off-peak 调度、OAuth 服务（仅服务 zai/bigmodel）。登录入口（WelcomeScreen / Web 登录）随账号体系移除，应用启动不再要求登录。
- CLI：移除 `zcode login`、auth-login、builtin 供应商配置打包；`legacy-cli-personal-provider-config-importer` 中 `builtin:bigmodel` 映射按类型驱动清理。
- **不动**：冻结的 DB migration（provider-selection-v2、official-glm-selection-v3、0022）、`zcode://` scheme、`zcode.z.ai` 域名常量中仍被分享等功能使用的部分（功能契约，非品牌展示）。

**验收**：模型设置页只剩自定义供应商组；添加供应商面板无智谱模板；全仓 grep 无 `StartPlan`、`codingPlan`、`zhipu-account` 残留（冻结 migration 除外）；`pnpm typecheck` 通过。

## 3. UI 品牌 ZCode → Ycode

**规则**：所有用户可见的品牌展示改为 "Ycode"。技术标识符保持不变以维持兼容。

- 改：i18n 文案（`packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`）、`packages/shared/src/desktopMenu.ts`、desktop main 进程文案（about、强制更新、CUA 提示、运行时应用名）、`desktop-product-identity.mjs`（productName `Ycode`、appId `dev.ycode.app`）、electron-builder metadata、installer.nsh、renderer/web 的 `<title>` 与启动壳、Web 登录/分享页品牌文案、CLI 帮助头与 TUI 品牌（ASCII art、PRODUCT_NAME）。
- Logo：`ZCodeAboutLogo`/`ZCodeWordmarkLogo`/`ZCodeStartupLogo`/`Z.svg` 等 Z 字形标识替换为 Ycode 文字/Y 字形标识，组件文件随品牌更名。
- **不改**（兼容契约）：`@zcode/*` npm scope、`window.zcode` IPC 桥、`ZCODE_*` 环境变量、`zcode-protocol`、`~/.zcode` 数据路径、CLI bin 名 `zcode`、后端域名、二进制图标资源（`packages/desktop/build/icon*`、`public/logo/icons/*`，需后续以正式设计资产替换）。

**验收**：`pnpm dev:desktop` 启动后窗口标题、登录/欢迎页、设置页、托盘均显示 Ycode；grep 用户可见文案无 "ZCode" 残留（技术标识符除外）；`pnpm typecheck` 与 `pnpm lint` 通过。
