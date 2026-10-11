# Ycode 预发布（rc）发版流程

本文约定 Ycode（分支 `ycode`，仓库 [yuuuuuuc/ZCode](https://github.com/yuuuuuuc/ZCode)）如何用 **pre-release（rc）** 做维护者试吃，再晋升正式版，避免再次出现「装完即崩、当晚连发多个 hotfix」的情况。

## 背景（2026-10-10）

当晚从 **3.15.2 → 3.15.5** 连发四版，其中三版是用户装完立刻踩到的崩溃热修：

| 版本相关 | 现象 | 根因摘要 |
| --- | --- | --- |
| 关窗崩溃 | `clearOAuthRoutesForWindow` undefined | OAuth 剥离后符号更名，关窗路径仍调用旧名 |
| 关窗崩溃 | `webRemoteControlManager.disposeWindow` undefined | 裁剪 WRC 后未注入 manager，关窗仍直调 |
| 启动/同步标签崩溃 | `restorePreviouslyEnabledWebRemoteControl` 未接线 | `registerPlatformIpcHandlers` 缺必填回调 |
| 功能 | API Key 报 `Provider request auth is unavailable` | 官方账号路径剥离后 API-key 鉴权未接好 |

共同模式：**裁掉厂商能力后，调用点仍假定旧符号/旧回调存在**；发版前没有在真实机器上做冒烟。本流程用 rc + 维护者 dogfood + 短清单，把这类问题挡在正式用户之前。

版本规则细节见根目录 [`UPSTREAM.md`](../UPSTREAM.md)。

---

## 1. 版本与标签规则

- **`major.minor`**：跟踪上游发布线（当前 `3.15`）。上游升到 `3.16` 时才换前两段。详见 [UPSTREAM.md § 版本号](../UPSTREAM.md)。
- **`patch`**：Ycode 自己的递增，不跟上游 patch 一一对应。
- **正式版**：标签 `vX.Y.Z`（例 `v3.15.6`），`package.json` / 产物版本为 `X.Y.Z`。
- **预发布（rc）**：标签与版本使用 **semver prerelease**：`vX.Y.Z-rc.N`（例 `v3.15.6-rc.1`）。同一正式号可连续出 `rc.1`、`rc.2`…
- **安装包命名**：与正式版同一模板，版本段带 prerelease 标识，例如  
  `Ycode-3.15.6-rc.1-win-x64.exe`（具体后缀以 electron-builder 产物为准）。

> 注意：应用内更新比较依赖 `semver.coerce`（见下文「自有更新与 prerelease」）。正式 `package.json` 版本仍须是可解析的 semver；**不要用四段式**（如 `3.15.6.1`）。

---

## 2. 发版流程（merge → rc → dogfood → 正式）

### 2.1 合入 `ycode`

功能与修复先合入分支 `ycode`（PR 或直推均可，以仓库习惯为准）。非崩溃类改动优先积攒，见 §5。

### 2.2 质量门禁（发 rc 前必跑）

环境：**Node >= 24** + **pnpm**（见根 `package.json` `engines`）。

```bash
pnpm typecheck
pnpm lint
pnpm architecture:check
pnpm check:defaults
pnpm check:desktop-main-types
pnpm check:desktop-orphans
```

全部通过后再打 rc。门禁不能替代真机冒烟，但能挡住类型/架构/默认策略回归。

其中两条是「漏接线」类事故的护栏（见 [`ycode-wiring-gaps-followup.md`](./ycode-wiring-gaps-followup.md)）：

- `check:desktop-main-types`：`pnpm typecheck` **不含** `packages/desktop/tsconfig.main.json`，
  该工程有 117 条存量错误。这条用冻结基线只拦**新增**错误（漏传必填回调、漏 import 等）。
- `check:desktop-orphans`：扫描 `packages/desktop/src/{host,main}`，发现「零相对引用」的新孤儿模块即失败
  （接线被删、模块还在）。已确认的豁免记录在 `.desktop-orphan-modules-baseline.json`，每条必须带原因。

### 2.3 打 Windows 生产包

```bash
ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64
```

产物落在 desktop 打包输出目录；确认文件名含目标版本（含 `-rc.N`）。

### 2.4 创建 GitHub **pre-release**

始终显式传 `--repo`：本机 `gh` 默认远程常解析到上游 `zai-org/ZCode`，不传会发错仓库。

```bash
gh release create vX.Y.Z-rc.N \
  --prerelease \
  --repo yuuuuuuc/ZCode \
  --title "Ycode vX.Y.Z-rc.N" \
  --notes "预发布：维护者试吃。变更摘要：…" \
  path/to/Ycode-X.Y.Z-rc.N-*.exe   # 按实际产物追加
```

在 GitHub UI 中确认该 Release 已勾选 **Set as a pre-release**。

### 2.5 维护者 dogfood（Yuuc）

在维护者机器（Yuuc）上安装该 rc，**正常使用 1～2 天**（崩溃热修可缩短为同日数小时，但仍须走完 §3 清单）。期间重点留意：开关窗、多项目标签、API Key 模型对话、检查更新、退出。

### 2.6 晋升正式版

Dogfood 通过且 §3 清单全绿后，在**同一提交**上：

1. 将 `package.json`（及桌面包版本字段）从 `X.Y.Z-rc.N` 改为 `X.Y.Z`（若 rc 构建时已写入 prerelease 版本）。
2. 打正式标签并发布（二选一）：
   - **推荐**：`gh release create vX.Y.Z --repo yuuuuuuc/ZCode …`（正式 Release，**不要**加 `--prerelease`），附件为正式版安装包；或
   - 将已有 rc Release **编辑为非 prerelease** 并改 tag/标题为 `vX.Y.Z`（仅当附件与版本号已一并改对时使用，易混，慎用）。
3. rc 标签/Release：**可删可留**。留下便于对照；删除可减少「latest 以外列表」噪音。正式用户不会通过 `/releases/latest` 看到 prerelease（见 §4）。

### 2.7 不要做的事

- 不要跳过 rc 直接对外部用户发正式版（崩溃热修也不例外，只是 dogfood 可以缩短）。
- 不要在未传 `--repo yuuuuuuc/ZCode` 的情况下执行 `gh release create`。
- 不要在本流程文档合入时顺便 bump 版本或打 tag（文档变更单独提交）。

---

## 3. 晋升前 5 分钟手动冒烟清单

在 **Windows 真机**上，对即将晋升的构建（通常是刚 dogfood 过的 rc，或同 commit 打出的正式包）逐项勾选：

| # | 步骤 | 期望 |
| --- | --- | --- |
| 1 | 安装并启动 | 无安装失败；主窗口正常出现；无启动即崩溃 |
| 2 | 打开/关闭窗口，含关掉最后一个窗口 | 可再开；关最后一窗不崩（回归 OAuth clear* / WRC disposeWindow） |
| 3 | 切换项目标签页 | 切换流畅；无「WRC 回调未接线」类崩溃 |
| 4 | 用 API Key 模型发一条消息（如 DeepSeek） | 正常流式回复；无 `Provider request auth is unavailable` |
| 5 | 菜单「检查更新」 | 能完成检测（已是最新 / 有新版本 / 明确错误），不白屏不崩 |
| 6 | 退出应用 | 进程干净退出，无残留崩溃对话框 |
| 7 | 让模型产出一张内联可视化卡片（如让 `visualize` 插件画个图） | 卡片渲染出来且可交互；日志无 `Channel name 'gen-ui' timed out after 1000ms` |
| 8 | 打开资源管理器 →「网络」页，同时跑一个会产生网络请求的会话 | 能看到 `host` / `cli` 进程的记录，而不是只有 `main` |

任一项失败：**不要晋升**；修在 `ycode` 上后重新出 `rc.(N+1)`。

---

## 4. 自有更新与 prerelease 行为

实现：`packages/desktop/src/main/githubReleaseUpdates.ts`。

### 4.1 查询接口

应用内「检查更新」请求：

```text
GET https://api.github.com/repos/yuuuuuuc/ZCode/releases/latest
```

GitHub 约定：**`/releases/latest` 不返回标记为 pre-release 的 Release**。因此：

- **rc 构建不会通过应用内更新推给普通用户**（只要创建时带了 `--prerelease` / UI 勾选 pre-release）。
- 普通用户只会看到最新的**正式** Release。

### 4.2 版本比较

```ts
// isReleaseNewerThan：两侧都先 semver.coerce 再 semver.gt
const next = semver.valid(semver.coerce(candidate));
const current = semver.valid(semver.coerce(baseline));
return semver.gt(next, current);
```

`semver.coerce` 会**丢掉 prerelease 段**（`3.15.6-rc.1` → `3.15.6`）。

| 当前安装 | `/releases/latest` 返回 | 实际行为 |
| --- | --- | --- |
| 正式 `3.15.5` | 正式 `3.15.6` | 提示有更新（正确） |
| 正式 `3.15.5` | 仅有 `3.15.6-rc.1`（prerelease） | latest 仍指向旧正式版 → **不会**把 rc 推给用户（符合预期） |
| rc `3.15.6-rc.1` | 正式 `3.15.6` | coerce 后两侧都是 `3.15.6`，`gt` 为 false → **不会**提示升级到正式版 |
| rc `3.15.6-rc.1` | 正式 `3.15.7` | 会提示（patch 已前进） |

按 semver，`3.15.6-rc.1 < 3.15.6`，正式版应视为比同号 rc **更新**；当前实现做不到。

### 4.3 已知缺口（文档记录，本次不改代码）

- **缺口**：安装了 `X.Y.Z-rc.N` 的维护者，应用内「检查更新」**看不到**同号正式版 `X.Y.Z`。
- **影响范围**：主要是 dogfood 机器；普通用户不装 rc 则无感。晋升后维护者需**手动下载正式包**覆盖安装，或依赖下一 patch。
- **建议修复方向**（未实施）：比较时保留 prerelease，使用 `semver.clean` / `semver.parse` 得到完整版本再 `semver.gt`；或对 `coerce` 结果在「候选与当前数字版本相等且当前含 prerelease、候选为正式」时视为有更新。补单测覆盖上表用例。

---

## 5. 节奏与热修

- **非崩溃修复**：继续积攒在 `ycode`；大约 **每 1～2 周**发一版，或在合并较大上游同步后发一版。
- **崩溃 / 装完即坏的热修**：仍然**先出 rc**，再晋升；dogfood 可缩短为**同日**完成 §3 清单 + 数小时真实使用，但不要跳过 pre-release。
- 上游大合并：合并后先跑门禁与 `pnpm check:defaults`，再按本流程出 rc（参见 [`UPSTREAM.md`](../UPSTREAM.md) 与 [`MERGE-MAIN-INTO-YCODE-HANDOFF.md`](./MERGE-MAIN-INTO-YCODE-HANDOFF.md)）。

---

## 6. 后续（尚未做）

1. **Windows CI 冒烟**（`windows-latest`；仓库公开则 Actions 分钟免费）：
   - 构建桌面包 → 静默安装 → 启动约 30s → 正常关闭；
   - 断言无错误对话框、进程退出码可接受。
2. **扩展 `check:defaults`**：断言 `registerPlatformIpcHandlers` 调用时传入了裁剪后仍需要的 IPC 回调（如 WRC 相关 no-op / optional），避免再出现「类型能过、运行时缺回调」的盲区。

---

## 快速命令备忘

```bash
# 门禁
pnpm typecheck && pnpm lint && pnpm architecture:check && pnpm check:defaults

# Windows 生产包
ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64

# 预发布（务必 --repo）
gh release create vX.Y.Z-rc.N --prerelease --repo yuuuuuuc/ZCode \
  --title "Ycode vX.Y.Z-rc.N" --notes "…" ./path/to/installer

# 正式发布（同 commit，非 prerelease）
gh release create vX.Y.Z --repo yuuuuuuc/ZCode \
  --title "Ycode vX.Y.Z" --notes "…" ./path/to/installer
```
