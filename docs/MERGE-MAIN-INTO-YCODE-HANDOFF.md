# Handoff: merge `main` (upstream v3.14.3) into `ycode`

> **已完成**（2026-09-26）。本文件由「续做」agent 更新为实际完成状态。
> 上一版（未完成版）由已取消的 Cursor cloud agent `bc-adfcaf25-946c-5687-9253-7cb82c4ed13c` 的 transcript 提炼。

## 结果

`ycode` 已通过 **merge commit** 合入 `origin/main`（`29628c9` 上游 v3.14.3），保留 Ycode 开源化改动。

| Ref | SHA | 说明 |
|-----|-----|------|
| merge commit（第一父） | `b61b58cb42e49c39680fdf99695ea30d81a6782d` | 合并前 ycode tip |
| 第二父（MERGE_HEAD） | `29628c9acdb81b703bbd4080c207a0e7ce5e276e` | `feat: update v3.14.3` |
| merge-base | `872ad96` | `feat: open source` |

- 未改 `main`，未 rebase，未强推。
- `feature/rebrand-ycode` 保持不动。

## 冲突解决（12 个 `UU` 文件）

全部解完，工作树无 `<<<<<<<` / `=======` / `>>>>>>>` 标记。

| 文件 | 解法 |
|------|------|
| `zcode-protocol-v4/commands/prompt-turn.ts` | 保留通用 Bot 回推 `botDeliveryTarget` / `activeBotDeliveryTarget`；丢弃 `activeOffPeakTaskId` 等闲时字段 |
| `zcode-protocol/server-operations.ts` | 同上：保留 `botDeliveryTarget`，去掉 off-peak |
| `zcode-protocol/server-types.ts` | 保留 `activeBotDeliveryTarget`，去掉 off-peak |
| `cli/src/command-center/slash-commands.ts` | 识别 `/workflow`，不识别 `/login` |
| `desktop/src/main/desktopRemoteSessions.ts` | 保留 `normalizeServerRemoteUrlForComparison`、`isSameRemoteTarget`；导出 `hasRemoteWorkspaceSessionForTarget`、`createBotRemoteWorkspaceRuntimePort`；删 `buildRemoteTargetTelemetryKey`、`getRemoteConnectionStats` |
| `services/src/node.ts` | 单一 `const taskIndexRepo = new TaskIndexRepo()`；onboarding `loadUserId: async () => null` + `hasExistingLocalTask`；保留 `createBotRemoteWorkspaceService` 并传给 `createBotsService` 的 `remoteWorkspaceService`；无 `oauthService` / JWT logout / `buildOffPeakRequestAuthForTicket` |
| `services/src/zcode-agent/zcodeAgentService.ts` | 去掉遥测/账号/闲时注入，其余跟 main |
| `shared/src/zcode-protocol/index.ts` | 协议跟 main，不导出 off-peak 死类型 |
| `ui/src/WorkspaceSidebarFooter.tsx` | 保留 `WorkspaceWebRemoteControlTrigger`；未恢复 PlanBadge / UsageSummary |
| `ui/src/onboarding/OccupationOnboarding.tsx` | dismiss 调用 `onboardingRecord.dismissOnboarding`；依赖数组 `[onboardingRecord, setRequested]` |
| `ui/src/v4/composer/modelTriggerDisplay.ts` | 整段保持 Ycode 通用实现 |
| `third-party/inventory.json` | 按合并后树重生（见下） |

## 续做阶段额外修掉的 3 处编译/门禁回归

工作树里原先仍有几处「半解」，`pnpm typecheck` 直接暴露：

1. **`packages/services/src/bots/storageMigration.ts`**（main 新增文件）
   引用了随内置智谱一起删除的 `migrateLegacyModelProviderId` / `migrateLegacyOfficialGlmModelId`
   （`packages/shared/src/legacy-model-provider-identity.ts` 已由 `df6b464` 删除）。
   改为身份改写内联成 no-op 并说明原因，与已解好的 `subagent-markdown-selection.ts`
   的 `migrateModelValue` 保持一致。

2. **`packages/ui/src/onboarding/OccupationOnboarding.tsx`**
   调用了 `platform.getDeviceId()`，而 `IPlatformService` 里该方法随账号体系一起移除。
   改为读取 preload 注入的 `__ZCODE_DEVICE_ID__`（与 desktop renderer `main.tsx` 同一来源）。

3. **`packages/ui/src/WorkspaceSidebarFooter.tsx`**
   `workspacePath` 声明在 props 类型里但漏了从解构里取出（半残状态）。
   补上解构。

## licenses / inventory 卡点（已解决）

`node scripts/licenses.mjs notices` 原本失败：`scripts/third-party-npm.mjs` 的
`readWorkspaceProductionGraph` 并行跑两次 `pnpm -r ls --prod --json --depth Infinity`，
Windows 上必定 EMFILE（本进程句柄上限约 8192），pnpm 的 graceful-fs 重试也救不回来。

本机 **没有可用的 WSL**（`wsl -l -v` 只有 Stopped 的 `docker-desktop`），因此按备选路径处理：

- 只改 `readWorkspaceProductionGraph`：不再 spawn pnpm，改为顺序解析 `pnpm-lock.yaml`
  （`importers` 给直接依赖、`snapshots` 给传递闭包），用显式栈迭代展开（闭包图会互相引用，
  递归会栈溢出）。
- 锁文件键形如 `<name>@<version>(peer@x)`：`@` 在 scope 名与 peer 后缀里都出现，
  必须用 `indexOf("@", 1)` 找分隔符，不能用 `lastIndexOf("@")`。
- `scanInstalledPackages` 未改（本来就是逐目录 `readdir`，没有无限制并发）。
- `yaml@2.9.0` 加了显式 devDependency（合并前它只是 `vite` / `knip` 的传递依赖，
  直接从 `scripts/` import 不稳）。

结果：

- `node scripts/licenses.mjs notices` → exit 0，`1135 package versions, 8 copied components, 18 native archives`
- `node scripts/licenses.mjs check` → **exit 0**（`1724 个实装包`，15 项待补齐材料为既有 `reviewRequired`）
- `third-party/inventory.json` / `THIRD-PARTY-NOTICES.md` 无冲突标记，无 `@arms/rum`
- `notInstalled` 只剩 3 个 `@napi-rs/canvas-*` 交叉编译目标（既有 `unsupportedCanvas` 白名单）
- 用一份独立原型脚本交叉核对，生产图与重生后的清单**完全一致**，唯一差异就是上面 3 个 canvas 条目

## 验证结果（真实退出码）

仓库根目录执行：

| 命令 | 退出码 | 说明 |
|------|--------|------|
| `pnpm typecheck` | **0** | |
| `pnpm lint` | **0** | 99 warnings / 0 errors；warnings 为既有基线 |
| `pnpm architecture:check --changed` | **0** | `violations: 0, new: 0` |
| `pnpm --dir apps/zcode-cli check` | **1** | **仅**因既有 `registry:check` 陈旧，见下 |
| `pnpm exec tsx --test packages/shared/test/session-send-merge.test.ts` | **0** | pass 1 / fail 0 |
| `pnpm exec tsx --test apps/zcode-cli/packages/cli/test/slash-command-merge.test.ts` | **0** | pass 1 / fail 0 |
| `node scripts/licenses.mjs check` | **0** | |

两个新回归测试按交接说明改用 `pnpm exec tsx --test <file>`：直接用
`node --experimental-strip-types --test` 会因 `.js` 后缀的 TS 源导入解析失败（`ERR_MODULE_NOT_FOUND`
于 `packages/shared/src/database-startup.js`）。测试内容未改动。

CLI 的 `check` = `pnpm registry:check && turbo run typecheck`：

- `turbo run typecheck` 单独跑 **27/27 successful，exit 0**。
- `registry:check` 失败是**既有环境问题，不是本次 merge 回归**：
  - 生成物 `bash-command-registry.ts` 在 `HEAD` 与 `MERGE_HEAD` 上**逐字节相同**，本次 merge 没碰它；
  - 重新生成后与提交版本相比，**只有第 3 行的 `hash:` 注释不同**，注册表内容逐字节一致；
  - 在**合并前的 pristine `b61b58c` worktree** 上跑同一个 `--check`，**同样失败**。

## 没验成的运行时检查

**未做交互验证**：本机未起 Web / Desktop，因此以下都**没有实际验证**，不能当作通过：

- `/workflow` 在真实命令面板中的表现
- 侧栏远控入口（`WorkspaceWebRemoteControlTrigger`）
- onboarding dismiss 真的写入 `onboarding-record.json`
- 侧栏确认没有套餐 / UsageSummary UI

另外仓库里本就没有 workflow、协议或远程 attachment 的单测；已有 4 个 `*.test.ts` 与本次冲突无关，
按要求没有为凑数去跑。

## 静态核对（已跑，均干净）

```bash
rg -n "<<<<<<<|=======|>>>>>>>" -g "!THIRD-PARTY-NOTICES.md" -g "!node_modules/**"
# → 无输出

rg -n "oauthService|appARMSBootstrap|telemetryCore|zhipu-account|getRemoteConnectionStats|resolveModelProviderFamilyIdByProviderId|captureEnd" \
   -g "!node_modules/**" -g "!docs/**" -g "!THIRD-PARTY-NOTICES.md"
# → 无输出

rg -n "offPeakTaskId|activeOffPeakTaskId|offPeakRunType|buildOffPeakRequestAuthForTicket|-start-plan|-coding-plan" \
   -g "!node_modules/**" -g "!*.md"
# → 无输出

rg -n "PlanBadge|UsageSummary" -g "!node_modules/**" -g "!*.md"
# → 无输出
```

另外逐文件确认：`git diff --name-only --diff-filter=A HEAD MERGE_HEAD` 里 137 个
telemetry / arms / oauth / zhipu / bigmodel / offpeak / coding-plan 相关文件，
**在合并后的工作树里存在数量为 0** —— 即 merge 正确地没有把它们从 main 带回。

## 完成定义

- [x] `ycode` tip 经 merge 同时包含 rebrand 意图 + `29628c9` 上游功能
- [x] 无 `<<<<<<<` 等 marker
- [x] 无官方遥测 / 内置智谱 / `/login` 账号链复活
- [x] `inventory.json` 与合并后树一致，`licenses.mjs check` exit 0
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 全绿

## 遗留（非本次 merge 引入）

- `apps/zcode-cli` 的 `registry:check` 在本机始终陈旧（见上），合并前就失败；
  若要修，跑 `pnpm --dir apps/zcode-cli registry:generate`，但那是独立于本次合并的改动。
- 界面交互未验（见上）。

## 元数据

- Repo: https://github.com/yuuuuuuc/ZCode
- 上游: https://github.com/zai-org/ZCode
- 取消的 cloud agent: https://cursor.com/agents/bc-adfcaf25-946c-5687-9253-7cb82c4ed13c
- Transcript（本机 box）: `cloud-agent-transcripts/bc-adfcaf25-946c-5687-9253-7cb82c4ed13c.jsonl`
