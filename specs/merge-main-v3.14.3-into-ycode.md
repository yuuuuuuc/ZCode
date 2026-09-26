# 将 main v3.14.3 合入 ycode

日期：2026-09-26。在 `ycode` 上用 merge commit 吸收 `origin/main`（`29628c9`，`feat: update v3.14.3`），保留 Ycode 开源化改动。不改 `main`，不用 rebase，不用 force-push。

## 起点

| Ref | SHA | 说明 |
|-----|-----|------|
| `ycode` / `HEAD` | `b61b58cb42e49c39680fdf99695ea30d81a6782d` | 与 `origin/ycode` 同步 |
| `origin/main` | `29628c9acdb81b703bbd4080c207a0e7ce5e276e` | 上游 v3.14.3 |
| merge-base | `872ad960de7ec172591f7e1952f7849229f94521` | `feat: open source` |

`ycode` 相对 merge-base 多 3 个提交：`df6b464` 开源化、`e0d5ea2` 记忆文档、`b61b58c` 交接文档。`main` 多 1 个提交。

冲突模块（`zcode-cli`、`desktop`、`services`、`shared`、`ui`）均为 legacy、`managed: false`，没有 `module.ts` 与跨模块 `requires`。合并不新增模块依赖，不把 UI 接到 Repo/Service 实现，不恢复已删除的账号服务作为第二写入路径。

## 保留（跟 main）

- workflow、bundled skills、通用协议增量、远程控制增量、仍适用的依赖与 lockfile。
- CLI `/workflow`。
- 远程目标比较：`normalizeServerRemoteUrlForComparison`、`isSameRemoteTarget`。
- 合并后仍有调用方的 attachment helper：`hasRemoteWorkspaceSessionForTarget`、`createBotRemoteWorkspaceRuntimePort`。
- onboarding dismiss 写入 `onboardingRecord`。
- 可独立运行、不依赖官方账号体系的通用 Bot 与远程 attachment。
- 新增远程 helper 沿实际调用链核对；名称含 bot/remote 本身不是删除理由。

## 禁止恢复（跟 ycode）

以下路径在 `df6b464` 已删除。合并后不得重新出现实现、导出、UI 或死类型：

- 官方遥测：ARMS / `@arms/rum`、`appARMSBootstrap`、`telemetryCore`、`buildRemoteTargetTelemetryKey`、`getRemoteConnectionStats`、`remoteUsageTelemetryEligible`、`captureEnd`。
- 内置智谱供应商与展示特例：`zhipu-account`、`resolveModelProviderFamilyIdByProviderId` 隐藏智谱 family 前缀。模型展示保持 Ycode 的通用实现（`modelTriggerDisplay.ts` 整段跟 ycode）。
- 官方账号体系：`oauthService`、OAuth 登录、`/login`、PlanBadge、智谱套餐 UsageSummary。
- 闲时套餐：`off-peak` / `offPeak` / `activeOffPeakTaskId`、`coding-plan`、Start Plan。

Bot delivery 字段（如 `activeBotDeliveryTarget`）若调用链依赖已删除的 `zhipu-account` / OAuth，一并删除；若只服务通用 Bot 且调用链不依赖账号，保留。

产品展示名为 Ycode。`@zcode/*`、`zcode-protocol`、`window.zcode`、`ZCODE_*`、CLI bin `zcode`、第三方版权署名保持原用途。

## 远程不变量

身份隔离 key 仍是 `workspaceIdentity?.trim() || workspacePath`。`workspacePath` 只用于执行与展示。Desktop `desktop-continuous` 与手机 `web-remote-replayable` 继续分开：同一 owner/lease 与序列，手机走 snapshot + gap repair，不另起 Agent。已接受输入仍由 CLI `CommandInbox` 串行 admission；Renderer 只保留草稿与 pending optimistic overlay。

```text
desktop: continuous ── direct live stream ──┐
                                           ├─ same owner and sequence
mobile: replayable ─ snapshot + gap repair ┘
```

## 验收

1. merge commit 的第一父提交是原 `ycode` tip，第二父提交是 `29628c9`。
2. 工作树无 `<<<<<<<` 冲突标记，无悬空导出、缺失实现、死类型。
3. `/workflow` 存在，`/login` 不存在。
4. onboarding dismiss 写记录，不调用采集回调。
5. 侧栏保留远控入口，不恢复账号套餐 UI。
6. 模型展示不依赖已删除的智谱 family helper。
7. 全文无官方遥测、内置智谱账号、登录、闲时套餐的恢复实现。
8. `node scripts/licenses.mjs check` 通过；inventory 不含已移除遥测包。
9. `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`、`pnpm --dir apps/zcode-cli check` 通过。
10. workflow、协议、远程 attachment 的现有测试按合并后入口执行。
11. 推送后 `origin/ycode` 包含 `29628c9`，compare `main...ycode` 的 behind = 0。
