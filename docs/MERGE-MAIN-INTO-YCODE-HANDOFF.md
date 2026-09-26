# Handoff: merge `main` (upstream v3.14.3) into `ycode`

> 给后续 agent / 本机继续用的交接文档。  
> 来源：已取消的 Cursor cloud agent `bc-adfcaf25-946c-5687-9253-7cb82c4ed13c`（2026-09-26）的完整 transcript 提炼。  
> **未完成**：冲突已分析、解法已定大半，但**没有 push、没有 PR、工作树未落地**。远程也没有留下 `cursor/merge-main-into-ycode-*` 分支。

## 目标（不变）

把 fork 的 `main`（已与 `zai-org/ZCode:main` 同步）**merge** 进长期自定义分支 `ycode`，解决冲突后更新 `ycode`。

- **不要**改 `main`
- **不要** rebase；要 **merge commit**
- **不要**重新引入官方遥测、内置智谱供应商、账号体系里被 rebrand 删掉的东西
- `feature/rebrand-ycode` 可保留作历史 tip，不必 force-push

## 当前远程状态（写文档时）

| Ref | SHA | 说明 |
|-----|-----|------|
| `ycode` | `e0d5ea2de49f348aa9cc47fe9aa5ce87e64386e2` | 与 `feature/rebrand-ycode` 同 tip |
| `main` / upstream tip | `29628c9acdb81b703bbd4080c207a0e7ce5e276e` | `feat: update v3.14.3` |
| merge-base | `872ad96`（`feat: open source`） | ycode 比 base 多 2 commit；main 比 base 多 1 |

### `ycode` 上多出的 2 个 commit

1. `df6b4647` — `feat: 开源化改造 —— 移除官方遥测与内置智谱供应商，UI 品牌更名为 Ycode`（约删 7.8 万行量级）
2. `e0d5ea2d` — `docs: 增加AGENTS.md 记忆系统内容`

### `main` 上多出的 1 个 commit

- `29628c9a` — `feat: update v3.14.3`（功能面很大：workflow、bundled skills、UI、协议等；与 rebrand 重叠约 63 个文件）

GitHub API `POST .../merges` base=`ycode` head=`main` → **HTTP 409 Merge conflict**（已验证）。

## 冲突解决总原则（已定）

| 侧 | 保留什么 |
|----|----------|
| **优先 `main`（上游）** | 功能性产品代码、workflow、skills、protocol 增量、deps/lockfile、THIRD-PARTY 正文、v3.14.3 版本相关 |
| **优先 `ycode`（rebrand）** | 产品名 Ycode、去官方遥测、去内置智谱 provider、去账号/OAuth/闲时套餐相关定制、AGENTS.md 记忆文档 |
| 混合冲突（如 README） | 品牌用 Ycode；可吸收上游仍适用的版本/功能说明 |
| 硬禁 | 不要恢复 ARMS/官方 telemetry、`zhipu-account`、oauth 账号链、off-peak/coding-plan 智谱闲时逻辑 |

## 已确认的 12 个冲突文件 + 解法

`git merge origin/main` 后 `diff-filter=U`（数字 = conflict hunk 数）：

### 1. `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/prompt-turn.ts`（7）

- 冲突形态多为：**ycode 已删字段 vs main 又加回**（deletion vs addition）。
- **丢弃** main 加回的：`activeOffPeakTaskId` / `offPeakTaskId`、以及与智谱闲时套餐绑定的字段。
- **丢弃** 若同属账号/智谱链的 bot-delivery 字段时需再核对：`activeBotDeliveryTarget` 等——前 agent 判断「bot delivery target 可能是独立产品功能」，但若依赖 `zhipu-account`/oauth 则一并丢掉。
- 与 off-peak **无关**的 v3.14.3 功能改动：跟 main。

### 2. `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts`（3）

- 同 prompt-turn：不要恢复 off-peak / 智谱账号相关 operation。
- 纯 workflow / 通用 server op：跟 main。

### 3. `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-types.ts`（1）

- 同上：类型定义里 off-peak / 账号链字段保持 ycode（删掉）；功能类型跟 main。

### 4. `apps/zcode-cli/packages/cli/src/command-center/slash-commands.ts`（1）

- **保留 main** 的 `/workflow`（v3.14.3 功能）。
- **丢弃 main** 的 `/login`（rebrand 已去掉账号体系）。

### 5. `packages/desktop/src/main/desktopRemoteSessions.ts`（2）

已定：

- **保留** `normalizeServerRemoteUrlForComparison`、`isSameRemoteTarget`（main 侧 helper；auto-merge 后的调用方需要，否则编不过）。
- **保留并导出** `hasRemoteWorkspaceSessionForTarget`、`createBotRemoteWorkspaceRuntimePort`（若 merge 后仍被引用）。
- **丢弃** `buildRemoteTargetTelemetryKey`、`getRemoteConnectionStats`、以及依赖 `remoteUsageTelemetryEligible` 的 ARMS/官方遥测路径（rebrand 已撕掉 telemetry 模块时，留导出但无实现会坏）。
- 注意：若 auto-merge 留下「只 export、函数体在冲突里被清空」的半残状态，必须对齐整段 return/export，不要留悬空符号。

### 6. `packages/services/src/node.ts`（2）

- **丢弃** main 加回的：`oauthService`、`zhipu-account`、off-peak credentials、依赖账号的 bot remote workspace 装配。
- onboarding 里 `userId: null`（ycode）合理；main 的 `hasExistingLocalTask` 若与账号无关可吸收——前 agent 倾向「可保留功能性 onboarding 逻辑」，合并时对照 `onboardingRecord` API 是否仍存在。

### 7. `packages/services/src/zcode-agent/zcodeAgentService.ts`（3）

- 去掉遥测/账号/闲时相关注入；其余 agent 服务增量跟 main。
- 合并后全文搜：`arms`、`telemetry`、`oauth`、`zhipu`、`offPeak`、`off-peak`、`coding-plan`、`Start Plan`。

### 8. `packages/shared/src/zcode-protocol/index.ts`（1）

- 协议导出：workflow 等跟 main；offPeak / botDelivery 等若 rebrand 已从 v4 command 去掉，不要从 index 再导出死类型。

### 9. `packages/ui/src/WorkspaceSidebarFooter.tsx`（1）

- **保留** main 的 `WorkspaceWebRemoteControlTrigger` import/用法（远程控制功能）。
- **不要**恢复 PlanBadge / 智谱套餐 UsageSummary 一类账号计划 UI（ycode 已删）。

### 10. `packages/ui/src/onboarding/OccupationOnboarding.tsx`（1）

- **保留** main 的 dismiss → 写入 onboardingRecord 的行为（功能）。
- **不要**恢复 `captureEnd` 一类遥测/采集回调。
- dependency 数组按合并后实际仍存在的符号收敛（ycode 曾简化过）。

### 11. `packages/ui/src/v4/composer/modelTriggerDisplay.ts`（1）

- **整段跟 ycode**。
- 原因：main 用 `resolveModelProviderFamilyIdByProviderId` 隐藏内置智谱 family 前缀；ycode 已删该 helper / 内置智谱。取 main 会 **编译失败** 且恢复智谱展示特例。
- 同文件里 `formatModelChangeLabel` 等：ycode 更简；main 增量若全是 coding-plan/Zhipu 特例，继续用 ycode。

### 12. `third-party/inventory.json`（6）

- **不要**瞎选某一侧的 sha256：merge 后树两边都不等于单侧 hash。
- **正确做法**：冲突先临时消掉 → 保证 `THIRD-PARTY-NOTICES.md` / `package.json` / `pnpm-lock.yaml` / `builtinSkillI18n.ts` 内容是「合并后真相」→ **再跑官方 inventory 生成脚本**（或按仓库既有脚本）重生 `inventory.json`。
- **省略** `@arms/rum` 等遥测包条目；若 patch 文件已不存在，对应 inventory / patches 条目不要留。
- 前 agent 观察到：`patches/` 里仍有 ai-sdk 相关 patch；`third-party/npm-overrides.json` 仍存在；lock 里未必再有 `@arms/rum`。
- 无 `node_modules` 时不要假装重生成功；优先 `pnpm install` 再生成，或对合并后文件 **手动计算 sha256** 写回（备选，易错）。

## 自动合并后仍需人工检查（无 conflict marker，但可能回退品牌）

前 agent 已点名，但**未做完回归**：

- `README.md` / `README.en.md`：应保持 Ycode 品牌；可吸收上游版本说明
- i18n：`packages/ui/.../en-US.ts`、`zh-CN.ts` 与 CLI i18n——搜是否又出现 `ZCode` / `Z.ai` / `智谱` / `Start Plan` / Coding Plan 文案回归
- `package.json` / desktop product 名 / `index.html` 标题
- 全文：`telemetry`、`appARMSBootstrap`、`oauthService`、`zhipu-account` 等文件是否被 merge 加回（ycode 曾删：`packages/desktop/.../appARMSBootstrap.ts`、`packages/services/.../telemetryCore.ts`、`oauthService.ts` 等）

建议命令：

```bash
git diff e0d5ea2 -- packages/ui/src/i18n apps/zcode-cli/packages/i18n README.md README.en.md \
  | rg -n '^[+-].*(Ycode|ZCode|Z\.ai|智谱|Start Plan|Coding Plan|telemetry|arms)'
git diff --name-only --diff-filter=A e0d5ea2 MERGE_HEAD \
  | rg -i 'telemetry|arms|oauth|zhipu|bigmodel|offpeak|coding-plan'
```

## 推荐继续步骤（本机或任意 agent）

```bash
git fetch origin
git checkout ycode
git pull origin ycode
git checkout -b merge/main-into-ycode   # 或直接在 ycode 上 merge
git merge origin/main
# 按上文 12 文件决议解冲突
# 清理 marker 后：
#   - 重生 third-party/inventory.json
#   - rg 检查遥测/智谱/账号回归
#   - 能跑的 typecheck / 相关测试尽量跑
git add -A
git commit   # merge commit message 建议：merge(main): 合入上游 v3.14.3，保留 Ycode 开源化改动
git push origin HEAD:ycode             # 或 PR base=ycode
```

### Merge commit message 建议

```
merge(main): 合入上游 v3.14.3，保留 Ycode 开源化改动

- 功能/workflow/skills/协议跟 main
- 保留去遥测、去内置智谱、去账号登录、Ycode 品牌
- slash：保留 /workflow，丢弃 /login
- inventory.json 按合并后树重生
```

## 完成定义

- [ ] `ycode` tip 同时包含 rebrand 两 commit 的意图 + `29628c9` 的上游功能（经 merge）
- [ ] 无 `<<<<<<<` 等 marker
- [ ] 无官方遥测 / 内置智谱 / `/login` 账号链复活
- [ ] `inventory.json` 与合并后文件 hash 一致（或生成脚本通过）
- [ ] `gh api repos/yuuuuuuc/ZCode/compare/main...ycode` 合理：ahead ≥ 2（rebrand+merge），behind = 0

## 前 agent 卡在哪里（续做起点）

1. 已 `git checkout -b cursor/merge-main-into-ycode-d13c` 并 `git merge origin/main`（仅在云 VM，**未 push**）。
2. 12 个冲突文件列表与大部分策略已写清。
3. **卡点**：`third-party/inventory.json` 的 6 处 hash 冲突——在未装依赖时无法轻松跑生成器；正在核对 arms/keyv/THIRD-PARTY-NOTICES 是否完整时任务被取消。
4. 其他冲突文件的编辑**可能未全部写入工作树**；续做时不要假设 VM 状态还在，应 **重新 merge 再按本文决议应用**。

## 元数据

- Repo: https://github.com/yuuuuuuc/ZCode  
- 上游: https://github.com/zai-org/ZCode  
- 取消的 cloud agent: https://cursor.com/agents/bc-adfcaf25-946c-5687-9253-7cb82c4ed13c  
- Transcript（本机 box）: `cloud-agent-transcripts/bc-adfcaf25-946c-5687-9253-7cb82c4ed13c.jsonl`
