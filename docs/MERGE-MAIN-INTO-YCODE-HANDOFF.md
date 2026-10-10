# Handoff: merge `main` (upstream v3.15.1) into `ycode`

> **已完成合并提交准备**（2026-10-10，本机 box）。  
> 上一完成态：v3.14.3 merge（见下文历史）。本次将 `origin/main`（`aac4755` / tag `v3.15.1`）以 **merge commit** 合入 `ycode`。

## 结果（目标）

| Ref | SHA | 说明 |
|-----|-----|------|
| 合并前 ycode tip | `fdf8c3d3652ea1e5c1cf22920fe46597b3c7affe` | `docs: 更新 ycode 开源审计文档…` |
| MERGE_HEAD (`main`) | `aac4755666d09fdcd70272fcf063c077a639015f` | `feat: update to v3.15.1` |
| merge-base | `29628c9a` | `feat: update v3.14.3` |

- 未改 `main`，未 rebase，未强推。
- 偏好 merge commit（非 squash）。

## Ycode 功能裁剪（本次继续保留）

1. 移除官方遥测（ARMS / `@arms/rum`）
2. 移除内置智谱供应商 / Start Plan / Coding Plan 产品链
3. 移除官方账号 / OAuth 登录（`zhipu-account`、CLI `/login`、Web login）
4. 移除 off-peak / 闲时任务逻辑
5. 移除 PlanBadge / UsageSummary 套餐用量 UI
6. 保留 `/workflow`、远程控制、Gen UI / UI plugin sandbox 等上游独立能力（以能编译为度）

## 冲突处理摘要

- **modify/delete（约 145）**：保持 ycode 删除（遥测 / 账号 / coding-plan / off-peak / ARMS 等）。
- **content（约 122）**：
  - 裁剪回归类：取 ours 或丢掉 main 加回的 cut 内容
  - 上游功能：取 theirs（如 MCP App / Gen UI result-display、plugin sandbox chrome、workflow settings refactor、web remote shell 布局）
  - 品牌：README / i18n / ignore marker 等保持 **Ycode**，版本记为 v3.15.1
  - `package.json`：保留 `yaml` + 吸收 `vitest` patches；**丢弃** `@arms/rum-electron` patch
  - `scripts/third-party-npm.mjs`：保留 ycode 的 lockfile 解析路径（避免 pnpm ls EMFILE）
  - `pnpm-lock.yaml` / `inventory.json` / notices：先跟 main，再去掉 `@arms` 条目；**完整 licenses 重生未在本环境跑通**（见下）

## 额外清理（auto-merge 带入后又删）

- 官方营销触达 `marketing-touch`、Rewards OAuth Webview、Highspeed 加速卡**产品实现**（改为 stub，避免会话 UI 断链）
- Web login / OAuth 页面与 `browserOAuth*` 等
- 大量 coding-plan / off-peak / ARMS 测试与 e2e helper

## 检查结果

| 命令 | 结果 | 说明 |
|------|------|------|
| conflict markers | 无 | |
| `pnpm install --ignore-scripts` | 通过 | 本机缺 `make`，原生模块未编 |
| `@zcode/shared` `tsc --noEmit` | **0** | |
| 全仓 `pnpm typecheck` | **未全绿** | 约 200 个生产代码错误 + 测试/e2e（cut 相关测试未删净 / 部分上游类型与 ycode 裁剪边界未对齐）。**需 follow-up** |
| `pnpm lint` / `architecture:check` | 未跑 | 时间与 typecheck 债优先 |
| `node scripts/licenses.mjs notices/check` | 未跑 | 建议在可完整 install 的环境重生 inventory |

### 静态裁剪核对（应保持）

```bash
rg -n "appARMSBootstrap|telemetryCore|@arms/rum" -g '!node_modules/**' -g '!docs/**' -g '!*.md'
# 工作树中官方 ARMS bootstrap / telemetryCore 已移除；协议层仍可能保留 unused schema 常量文件 official-mcp-auth.ts（仅类型，未装配）
```

## Follow-ups（建议下一 agent）

1. 清掉剩余 typecheck：优先 `packages/ui`、`packages/services`（plugin-ui / bots channel reply / AppSettings 新字段 / DesktopCloseToTray 等）
2. 删除或改写仍引用 cut API 的 desktop e2e / wdio 配置
3. 在 Node≥24 + 完整原生依赖环境跑 `pnpm typecheck` / `licenses.mjs notices` 重生 inventory
4. 交互验证：`/workflow`、侧栏远控、无套餐 UI、无 `/login`

## 历史：v3.14.3 merge（已完成，2026-09-26）

见 git 历史 merge commit `6cc93f21` 与当时手记；本文件此前记录了 12 文件冲突决议与 licenses 卡点解法。

## 元数据

- Repo: https://github.com/yuuuuuuc/ZCode
- 上游: https://github.com/zai-org/ZCode
- 执行环境: 本机 box `/workspace/ZCode`（非 Cursor CloudAgent）
