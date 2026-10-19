# 平均输出速度远程 / 多会话修复 Implementation Plan

> **For agentic workers:** 按任务顺序逐个执行，步骤用 checkbox（`- [ ]`）跟踪。每个任务先写失败测试（RED），再做最小实现（GREEN）。
> 设计与根因见 [spec](../specs/2026-10-18-output-speed-remote-multi-session-design.md)，动手前先读完。

**Goal:** 让平均输出速度在 SSH 远程工作区可用；同一会话拿到速度后，不再因主轮缺 `cacheHit` 或 compact 而消失；让「为什么没有速度」在生产环境也能诊断；取证后再决定是否调大 reader 缓冲上限。

**Architecture:** 速度的唯一所有者仍是每个 `AgentRuntime` 的主轮聚合。v4 `ProductProjection` 只在缺失时沿用旧 `cache`，不合成数值。不可测原因的计数保存在 runtime 内存，只经 `session/debug` 诊断查询暴露，不进 `ModelComplete`、持久化历史和聊天 UI。远端问题靠发布链路与开发态构建新鲜度解决。

**Tech Stack:** TypeScript、Vitest、Zod、React（Developer Tools 面板）、Node 构建脚本。

## Global Constraints

- 开工前运行 `node scripts/check-workspace-freshness.mjs`；按 `.agents/skills/architecture-governance/SKILL.md` 先跑 `pnpm architecture:check --changed`。
- 不持久化生成耗时，不改消息存储结构，不做 migration（用户已确认）。
- 不改速度口径与可测判定；Task 5 的缓冲上限调整必须等 Task 4 拿到证据，并经用户确认后才做。
- CLI 单文件不超过 400 行；`product-projection.ts` 已远超 400 行，只做局部改动，不新增大段逻辑。
- 常量提取为命名常量；修复点写中文注释说明根因。
- UI 文案走 i18n（`zh-CN.ts` / `en-US.ts`），日志用 `packages/ui/src/logger.ts`，遵守 `DESIGN.md`。
- 完成前运行：`pnpm typecheck`、`pnpm lint`、`pnpm --dir apps/zcode-cli typecheck`、`pnpm --dir apps/zcode-cli lint`，以及受影响包的定向测试。如实报告结果。

---

### Task 1: v4 投影在缺 `cacheHit` / compact 后保留速度

**Files:**

- Modify: `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts`（`onModelComplete` 约 4866-4879 行；compact success 分支约 5004-5022 行）
- Test: `apps/zcode-cli/packages/bootstrap/tests/product-projection.test.ts`（参照该文件现有 `SessionEventType.ModelComplete` 用例的 fixture 写法）

- [ ] **Step 1: 写失败测试**

  覆盖 spec 的验收场景 1-4：
  1. 主轮 `ModelComplete` 带 `cacheHit.outputTokensPerSecond = 40` 后，再来一条主轮 `ModelComplete` 不带 `cacheHit`：`snapshot.usage.contextWindow.cache.outputTokensPerSecond` 仍为 40，`usedTokens` 按新 usage 更新。
  2. 有速度后 compact 成功（`tokensAfter` 有值）：`usedTokens` 回落，`cache` 保留，`breakdown` 不保留。
  3. 再来一条带新 `cacheHit`（速度 55）的主轮：整体覆盖为 55。
  4. `querySource: "session_title"` 的 `ModelComplete` 不改变主会话 `cache`（回归）。

- [ ] **Step 2: 确认 RED**

  Run: `pnpm --dir apps/zcode-cli/packages/bootstrap exec vitest run tests/product-projection.test.ts`

  Expected: 场景 1、2 失败（`cache` 为 undefined）。

- [ ] **Step 3: 最小实现**

  ```ts
  // onModelComplete 内，重建 contextWindow 前：
  // 修复原因：主轮 ModelComplete 在 usage 缺失或 input/cache 全 0 时不带 cacheHit，
  // 而 state.updated 按键整替，过去会把已显示的平均输出速度一并抹掉。
  // Agent 聚合单调累计，缺失时沿用上一份即可；下一份 cacheHit 会整体覆盖。
  const cache = payload.cacheHit ?? this.snapshot.usage.contextWindow?.cache;
  // ...
  ...(cache ? { cache } : {}),
  ```

  compact success 分支同样展开 `this.snapshot.usage.contextWindow?.cache`（存在才带），注释说明 cache 是会话级聚合、不随压缩失效，而 breakdown 会失效所以不保留。

- [ ] **Step 4: 确认 GREEN**，并跑 `tests/product-projection-cold-hydration.test.ts` 确认冷恢复种子行为不变。

### Task 2: runtime 不可测原因计数

**Files:**

- Modify: `apps/zcode-cli/packages/core/src/runtime/types.ts`（新增 `OutputSpeedDiagnostics` 类型；把 894 行 `outputGenerationUnavailableReason` 注释改为「仅 runtime 内部与 session/debug 诊断查询可读」）
- Modify: `apps/zcode-cli/packages/core/src/runtime/agent-runtime.ts`（221 行附近新增字段 `outputSpeedDiagnostics` 与公开方法 `getOutputSpeedDiagnostics()`）
- Modify: `apps/zcode-cli/packages/core/src/runtime/internal.ts`（`AgentRuntimeInternal` 增加该字段）
- Modify: `apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step-usage.ts`（新增 `recordMainTurnOutputSpeedDiagnostics(runtime, result)`）
- Modify: `apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step.ts`（633-636 行，仅 `querySource === "main_turn"` 时调用）
- Modify: `apps/zcode-cli/packages/core/src/runtime/methods/resume.ts`（226 行）、`rewind-message.ts`（727 行）：与 `mainTurnCacheHitAggregate` 一起重置计数
- Test: `apps/zcode-cli/packages/core/tests/turn-model-step-usage.test.ts`

**Interfaces:**

- Produces: `OutputSpeedDiagnostics = { measurableCount: number; unavailableCounts: Partial<Record<OutputGenerationUnavailableReason, number>>; lastUnavailableReason: OutputGenerationUnavailableReason | null }`
- Produces: `AgentRuntime.getOutputSpeedDiagnostics(): OutputSpeedDiagnostics`，返回副本，调用方不能修改内部状态。

- [ ] **Step 1: 写失败测试**：在现有 `describe("main-turn output speed stream timing")` 的 `streamFixture` 基础上：
  - 可测请求后 `measurableCount === 1`，`lastUnavailableReason === null`。
  - 复用现有 `reader_backpressure` 用例（约 372-404 行）的构造：`unavailableCounts.reader_backpressure === 1`，`lastUnavailableReason === "reader_backpressure"`。
  - 可测样本之后再出现不可测：计数各自累加，速度聚合不变（回归）。
  - resume 之后计数清零。
  - 同一测试内两个 runtime 实例的计数互不影响（spec 验收场景 5）。
- [ ] **Step 2: 确认 RED**：`pnpm --dir apps/zcode-cli/packages/core exec vitest run tests/turn-model-step-usage.test.ts`
- [ ] **Step 3: 最小实现**：「可测」判定与 `recordMainTurnCacheHitUsage` 一致（`outputGenerationDurationMs` 有效且 `outputTokens > 0`），不另立一套口径。可以复用同一个 `measurable` 计算，避免两处漂移。
- [ ] **Step 4: 确认 GREEN**

### Task 3: `session/debug` 暴露诊断，Developer Tools 展示

**Files:**

- Modify: `packages/shared/src/session-debug.ts`（导出 `OUTPUT_SPEED_UNAVAILABLE_REASONS` 常量数组；`sessionDebugSnapshotSchema` 新增 `outputSpeed` strict 对象，`.optional()`）
- Modify: `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-debug.ts`（扩展局部 `SessionRecord` 类型，加入可选 `runtime`；`readSessionDebug` 合并 `outputSpeed`）
- Modify: `packages/ui/src/DeveloperToolsPane.tsx`（汇总区展示诊断）、`packages/ui/src/hooks/useSessionDebug.ts`（通常无需改，确认类型透传即可）
- Modify: `packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`（新增诊断文案和 6 个原因的可读文案）
- Test: `apps/zcode-cli/packages/bootstrap/tests/session-debug.test.ts`；`packages/shared/test/` 下补 schema 用例（若已有 session-debug schema 测试就追加）

- [ ] **Step 1: 写失败测试**
  - record 带 fake runtime（返回固定诊断）时，`readSessionDebug(record).outputSpeed` 等于该诊断，且能通过 `sessionDebugSnapshotSchema.parse`。
  - record 不带 runtime（现有 `record()` fixture）时没有 `outputSpeed` 字段，现有用例全部不变。
  - schema 拒绝未知原因字符串与多余键（strict）。
- [ ] **Step 2: 确认 RED**：`pnpm --dir apps/zcode-cli/packages/bootstrap exec vitest run tests/session-debug.test.ts`
- [ ] **Step 3: 实现**。core 的原因联合类型与 shared 常量数组要一一对应：在 core 侧加一个编译期断言或单测，防止两边漂移。
- [ ] **Step 4: UI**：汇总区一行展示，例如：

  ```text
  ┌────────────────────────────────────────────┐
  │ 输出速度样本  可测 12 · 不可测 3             │
  │ 最近不可测原因  读取背压（reader_backpressure）│
  └────────────────────────────────────────────┘
  ```

  `outputSpeed` 缺失时整行不渲染。复用面板现有的汇总行组件与样式，不新增颜色。

- [ ] **Step 5: 验证**：`pnpm vitest run packages/ui/test` 中与 DeveloperToolsPane 相关的用例（若无，补一个渲染用例：有 / 无 `outputSpeed` 两种情况）。按 `packages/ui/AGENTS.md`，在桌面与手机宽度、深浅主题、中英文下目测。

### Task 4: 多会话取证（手工，不改代码）

- [x] 用 Task 1-3 的构建，同时在 2-3 个项目各开一个会话，发长回答 prompt（例如生成 2000 字说明），并尽量同时运行。
- [ ] 打开每个会话的 Developer Tools，记录「可测 / 不可测 / 最近原因」，确认面板速度行的显示情况。
  （实际以 debug 日志与 `model_usage` DB 交叉验证代替目测：全日 0 条 `output_speed.unavailable`，面板目测未执行。）
- [x] 把结果记录到 spec 末尾新增的「Recorded validation (2026-10-xx)」小节。
- [x] 决策：
  - 主因是 `reader_backpressure` → 向用户报告证据，确认后执行 Task 5。
  - 主因是其它原因 → **停下**与用户对齐，不自行扩大可测口径。
  - Task 1 之后已全部显示 → 跳过 Task 5，在 spec 中注明 R4 不成立。 **← 本次走此分支（2026-10-19 取证，见 spec）**

### Task 5（不执行）: 调大 reader 缓冲上限

**结论（2026-10-19）：取证显示干净负载下三会话并发 0 个不可测样本，R4 未被证实，本任务不执行，
`MAX_BUFFERED_EVENTS` 维持 128。若未来重负载复现速度缺失，按 spec 的取证方法重跑后再评估。**

**Files:**

- Modify: `apps/zcode-cli/packages/core/src/runtime/methods/model-output-timing.ts`（`MAX_BUFFERED_EVENTS` 128 改为 1024，保留 `MAX_BUFFERED_CHARACTERS`）
- Modify: `docs/context-cache-hit-rate.md`（「128 events」改为新值）
- Test: `apps/zcode-cli/packages/core/tests/turn-model-step-usage.test.ts`

- [ ] **Step 1: 写失败测试**：消费者短暂变慢、累计 300 条小 `text_delta` 未撑满新上限时，请求可测；现有 256 条用例要改成大于 1024 条，或改用字符预算触发，保证背压分支仍被覆盖。
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

### Task 6: 开发态 dist 新鲜度（R2）

**Files:**

- Modify: `scripts/build-desktop-agent-cli.mjs`（约 110-119 行 `runBootstrapWithRemoteBuild` 的复用判断）
- Test: 若 `scripts/` 下已有该脚本的 node:test 用例就追加；否则把判断抽成纯函数 `isAgentBundleFresh({ bundleMtimeMs, sourceMtimeMs })`，用 `node --test` 写最小用例。

- [ ] **Step 1: 写失败测试**：源码 mtime 晚于 bundle 时返回 false；早于或相等时返回 true；bundle 不存在时返回 false。
- [ ] **Step 2: 实现**：异步递归 `apps/zcode-cli/packages/*/src`，跳过 `node_modules`、`dist`，取最新 mtime。不新鲜时打印 `[build-desktop-agent-cli] source newer than dist/zcode.cjs, rebuilding`，然后走原有的完整构建路径。
- [ ] **Step 3: 手工验证**：`touch` 一个 core 源文件后运行 `pnpm dev:desktop`，确认触发重建，`dist/zcode.cjs` 含 `outputTokensPerSecond`。

### Task 7: 远端发布前置条件与文档（R1）

**Files:**

- Modify: `docs/remote/zcode-agent-remote-deployment.md`（新增「发布前置条件」：发布桌面版前，必须用同一 commit 运行 `prepare:remote-assets` 并把 GLM 制品与 manifest 发布到该 App 版本读取的 CDN；附远端核验命令）
- Modify: `docs/context-cache-hit-rate.md`（Average Output Speed 小节补三点：缺 `cacheHit` / compact 时沿用 cache 的语义、`session/debug` 的 `outputSpeed` 诊断、远端制品要求）

- [ ] 写文档。
- [ ] 手工验收（spec 场景 10）：SSH 远端执行 `grep -c outputTokensPerSecond ~/.zcode/server/agents/glm/zcode.cjs`，结果大于 0；完成一轮可测回答后面板显示速度；查看桌面日志 `[zcode-agent-deploy]` 确认部署的 SHA。

### Task 8: 收尾验证

- [ ] `pnpm architecture:check --changed`
- [ ] `pnpm typecheck`、`pnpm lint`
- [ ] `pnpm --dir apps/zcode-cli typecheck`、`pnpm --dir apps/zcode-cli lint`
- [ ] 定向测试：bootstrap（`product-projection*`、`session-debug`）、core（`turn-model-step-usage`）、shared、ui 相关用例
- [ ] 在 spec 末尾记录实际执行的命令、结果和未验证项（例如 macOS / Linux 远端、手机 Web）
