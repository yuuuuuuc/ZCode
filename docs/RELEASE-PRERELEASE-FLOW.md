# ZCode 预发布（rc）发版流程

本文约定 ZCode（分支 `zcode2`，仓库 [yuuuuuuc/ZCode](https://github.com/yuuuuuuc/ZCode)）如何用 **pre-release（rc）** 做维护者试吃，再晋升正式版，避免再次出现「装完即崩、当晚连发多个 hotfix」的情况。

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
- **`patch`**：ZCode 自己的递增，不跟上游 patch 一一对应。
- **正式版**：标签 `vX.Y.Z`（例 `v3.15.6`），`package.json` / 产物版本为 `X.Y.Z`。
- **预发布（rc）**：标签与版本使用 **semver prerelease**：`vX.Y.Z-rc.N`（例 `v3.15.6-rc.1`）。同一正式号可连续出 `rc.1`、`rc.2`…
- **安装包命名**：与正式版同一模板，版本段带 prerelease 标识，例如  
  `ZCode-3.15.6-rc.1-win-x64.exe`（具体后缀以 electron-builder 产物为准）。

> `zcode2` 从官方 v3.15.1 基线重开，版本号从 **3.15.1** 起算，**不延续** `ycode` 的 3.15.5 线。上面几处的 `3.15.6` 只是示例号。

> 注意：应用内更新比较依赖 `semver.coerce`（见下文「自有更新与 prerelease」）。正式 `package.json` 版本仍须是可解析的 semver；**不要用四段式**（如 `3.15.6.1`）。

---

## 2. 发版流程（merge → rc → dogfood → 正式）

### 2.1 合入 `zcode2`

功能与修复先合入分支 `zcode2`（PR 或直推均可，以仓库习惯为准）。非崩溃类改动优先积攒，见 §5。

### 2.2 质量门禁（发 rc 前必跑）

环境：**Node >= 24** + **pnpm**（见根 `package.json` `engines`）。

门禁分两处执行：

| 位置 | 内容 |
| --- | --- |
| **CI**（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)，`windows-latest`） | `lint` / `typecheck` / `architecture:check`（全量）/ 两条护栏 / **全量 `pnpm test:unit`** |
| 本地 `pre-push` 钩子（`pnpm verify:static`） | `lint` / `typecheck` / `architecture:check --changed` / 两条护栏 |

**发 rc 前以 CI 绿为准**，本地钩子只保证提交前没有明显问题。要手动复跑同一套：

```bash
pnpm lint
pnpm typecheck
pnpm architecture:check          # 不要加 --changed，见下
pnpm check:desktop-main-types
pnpm check:desktop-orphans
pnpm test:unit
```

全部通过后再打 rc。门禁不能替代真机冒烟，但能挡住类型/架构/默认策略回归。

三个容易踩的坑：

- **`architecture:check` 不要加 `--changed`**（CI 里）。`--changed` 读的是**工作区未提交改动**，
  干净 checkout 里恒为空 → 恒通过。它只适合本地边改边查。
- **CI 用 `pnpm test:unit`，不要用 `test:unit:affected`**。后者按本地推送增量设计，在 CI 的
  detached HEAD + 浅克隆下会退化，且 diff 为空时直接返回 0——绿勾可能代表一个测试都没跑。
- **`pnpm typecheck` 曾经不在门禁链里**（`verify:static` 已补上）。它不含
  `packages/desktop/tsconfig.main.json`，那一半由下面的护栏兜。

其中两条是「漏接线」类事故的护栏（见 [`ycode-wiring-gaps-followup.md`](./ycode-wiring-gaps-followup.md)）：

- `check:desktop-main-types`：`pnpm typecheck` **不含** `packages/desktop/tsconfig.main.json`，
  该工程有 82 条存量错误（55 个错误键）。这条用冻结基线只拦**新增**错误（漏传必填回调、漏 import 等）。
- `check:desktop-orphans`：扫描 `packages/desktop/src/{host,main}`，发现「零相对引用」的新孤儿模块即失败
  （接线被删、模块还在）。只数**生产引用**——测试文件的 import 不算接线。已确认的豁免记录在
  `.desktop-orphan-modules-baseline.json`，每条必须带原因。

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
  --title "ZCode vX.Y.Z-rc.N" \
  --notes "预发布：维护者试吃。变更摘要：…" \
  path/to/ZCode-X.Y.Z-rc.N-*.exe   # 按实际产物追加
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
3. rc 标签/Release：**可删可留**。留下便于对照；删除可减少「latest 以外列表」噪音。勾了 pre-release 的 Release 不会出现在 GitHub 的 `/releases/latest` 上，也不会出现在仓库首页的 Releases 区块——但这只影响人工浏览，与应用内更新无关（见 §4）。

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

任一项失败：**不要晋升**；修在 `zcode2` 上后重新出 `rc.(N+1)`。

---

## 4. 自有更新与 prerelease 行为

实现：`packages/desktop/src/main/autoUpdater.ts`（`electron-updater`）。

### 4.1 更新源

应用内「检查更新」走的是**服务端 manifest provider**，不是 GitHub Releases：

- `autoUpdater.ts` 的 `applyManifestUpdateProvider()` 用 `provider: "custom"` +
  `ManifestUpdateProvider`（`manifestUpdateProvider.ts`）`setFeedURL`，指向 ZCode endpoint。
- `electron-builder.config.js` 里的 `publish` 只是 `provider: "generic"` 占位
  （`url: http://localhost:8081`），注释写明「新客户端运行时使用服务端 manifest provider」。

**因此：本仓的 GitHub Release 只是手动下载渠道，`--prerelease` 与否不影响应用内更新——不存在那条链路。**
（`ycode` 分支曾有一个读 `api.github.com/.../releases/latest` 的 `githubReleaseUpdates.ts`，
`zcode2` 从官方基线重开，没有这个模块；本文件此前的内容是从那份文档抄来的，已订正。）

### 4.2 版本比较

```ts
// autoUpdater.ts 的 isVersionGreaterThan：两侧都先 semver.coerce 再 semver.gt
function normalizeVersionForCompare(version) { return semver.valid(semver.coerce(version.trim())); }
return semver.gt(normalizeVersionForCompare(candidate), normalizeVersionForCompare(baseline));
```

`semver.coerce` 会**丢掉 prerelease 段**（`3.15.6-rc.1` → `3.15.6`）。

| 当前安装 | 服务端 manifest 下发 | 实际行为 |
| --- | --- | --- |
| 正式 `3.15.5` | 正式 `3.15.6` | 提示有更新（正确） |
| 正式 `3.15.5` | `3.15.6-rc.1` | coerce 后是 `3.15.6` > `3.15.5` → **会**提示（rc 能否下发取决于服务端怎么选 channel） |
| rc `3.15.6-rc.1` | 正式 `3.15.6` | coerce 后两侧都是 `3.15.6`，`gt` 为 false → **不会**提示升级到正式版 |
| rc `3.15.6-rc.1` | 正式 `3.15.7` | 会提示（patch 已前进） |

按 semver，`3.15.6-rc.1 < 3.15.6`，正式版应视为比同号 rc **更新**；当前实现做不到。

### 4.3 已知缺口（文档记录，本次不改代码）

- **缺口**：安装了 `X.Y.Z-rc.N` 的维护者，应用内「检查更新」**看不到**同号正式版 `X.Y.Z`。
- **影响范围**：主要是 dogfood 机器；普通用户不装 rc 则无感。晋升后维护者需**手动下载正式包**覆盖安装，或依赖下一 patch。
- **建议修复方向**（未实施）：比较时保留 prerelease，使用 `semver.clean` / `semver.parse` 得到完整版本再 `semver.gt`；或对 `coerce` 结果在「候选与当前数字版本相等且当前含 prerelease、候选为正式」时视为有更新。补单测覆盖上表用例。

---

## 5. 节奏与热修

- **非崩溃修复**：继续积攒在 `zcode2`；大约 **每 1～2 周**发一版，或在合并较大上游同步后发一版。
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
  --title "ZCode vX.Y.Z-rc.N" --notes "…" ./path/to/installer

# 正式发布（同 commit，非 prerelease）
gh release create vX.Y.Z --repo yuuuuuuc/ZCode \
  --title "ZCode vX.Y.Z" --notes "…" ./path/to/installer
```
