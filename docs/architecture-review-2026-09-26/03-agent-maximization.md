# 03 Agent 分析与最大化利用

本仓库的"Agent"**两层含义都成立**，分两半分析：

- **A 部分**：项目内含有一个完整的 LLM Agent 实现（`apps/zcode-cli`），即产品本身——分析其设计与能力边界。
- **B 部分**：本仓库自身的开发也依赖 AI Agent（AGENTS.md、`.agents/skills/`、记忆系统都是为此服务）——给出让 Agent 在本仓库发挥最大作用的建议。

---

# A 部分：项目内的 Agent（zcode-cli）

## A1. 定位与总体设计

`apps/zcode-cli` 是产品的 Agent 内核，以三种入口被消费：

1. TUI（`zcode` 无参数）；2. `app-server --stdio`（被桌面 Host 或 Web server 以子进程方式拉起，走 v4 wire 协议）；3. headless / workflow 模式（`packages/cli/src/headless-workflow.ts`）。

分层（现状事实，`apps/zcode-cli/packages/`）：`contracts`（schema/类型）← `core`（纯运行时，零生产依赖）← `adapters`（全部外部 IO）← `bootstrap`（组装）← `cli`/`tui`（入口壳）。依赖方向单一，`AGENTS.md` 以硬约束形式维护（外部 IO 必须收敛 adapter、单文件 ≤400 行、全链路 traceId）。

## A2. 输入输出契约

- **对宿主的契约**：`packages/shared/src/zcode-protocol-v4/`——`CommandEnvelope`（uuidv7、CAS：`COMMANDS_REQUIRING_BASE_REVISION` 集合按 revision+logEpoch 守护）、`commandResultSchema`/`commandAckSchema`、二进制分帧 wire（`wire.ts`/`wire-codec`/`wire-binary`/`wire-reassembly`）。admission 语义：**已接受的 busy/running 输入由 CLI 的 `CommandInbox` 串行 admission**（`bootstrap/src/zcode-protocol-v4/command-inbox.ts`，in-flight/live-input 与 512/session LRU 分离，`CommandInboxOutcome { ack | execute }`）。
- **对 LLM 的契约**：AI SDK 消息流（`adapters/src/model/model-execution.ts`），API 类型支持 `anthropic-messages`、`openai-chat-completions`、`openai-responses`。
- **对工具的契约**：每个 tool 声明 input/output schema + 只读/破坏性/并发安全/副作用范围（`none/workspace/git/network/system`）+ riskLevel（`core/src/tool/types.ts` 的 `ToolEntry`/`ToolMetadata`）。

## A3. 执行循环与规划

- **Runtime**：`core/src/runtime/agent-runtime.ts` 的 `AgentRuntime`；turn 入口 `runtime/internal-turn-methods.ts`（`executeTurn`/`executeTurnCommand`）。
- **状态机**：`core/src/agent/turn-machine.ts` 的 `TurnMachineImpl`，相位 `start → startModelRequest → scheduleTools → startToolExecution → completeTool → requestPermission/resolvePermission → aggregateResults → complete/fail`（相位定义 `agent/turn-state.ts`）。
- **调度**：`core/src/tool/scheduler.ts` 的 `ToolScheduler`——依赖拓扑排序 + 并行分组，`DEFAULT_MAX_CONCURRENCY = 10`；只读工具集（`READ_ONLY_TOOLS`）可并行，有副作用/并发不安全者串行。
- **Plan mode**：工具 `EnterPlanMode`/`ExitPlanMode`（`tool/handlers/plan-mode.ts` + `plan-mode-prompts.ts`），策略 `permission/plan-mode-policy.ts`（`resolvePlanModeTransitionPermission`），模式口 `runtime/session-mode-port.ts`。
- **Subagent**：`core/src/subagent/`——profile frontmatter 解析、`runner.ts`（`createExploreSubagentPort`）、explore/general-purpose 预设、独立 system-prompt/context-builder/tool-policy、与父 agent 的完成通知（`completion-notification.ts`）与协调者应答（`coordinator-response.ts` + `RespondToCoordinator` 工具）。另有 `dynamic-workflow(-runtime)` 包提供 TS 脚本编排的多 subagent 工作流（`agent()`/gate 等）。
- **动态工作流**：`CreateWorkflow`/`AmendWorkflow` 等工具（`core/src/tool/handlers/create-workflow.ts` 等 9 个），DWF run 有独立 journal 持久化（`adapters/src/storage/session-store/repositories/dwf-journal.ts`）。

## A4. 工具清单（`core/src/tool/handlers/`，现状事实）

| 类别 | 工具 |
| --- | --- |
| 文件 | `read.ts`（Read，含 image/pdf/video/text）、`write.ts`、`edit.ts`（+`edit-matchers.ts`/`diff.ts`）、`glob.ts`、`grep.ts` |
| 执行 | `bash.ts`（+约 40 个 `bash-readonly-policy-*` 支撑文件，内置 sandbox：`sandboxed: input.dangerouslyDisableSandbox !== true`）、`node-repl.ts` |
| 网络 | `webfetch.ts`（+`webfetch-preapproved.ts` egress guard/缓存）、`websearch.ts` |
| 编排 | `agent.ts`（Agent/Task）、`task-output.ts`/`task-stop.ts`、`send-message.ts`、`respond-to-coordinator.ts`、`submit-result.ts`、`escalate.ts` |
| 交互 | `ask-user-question.ts`、`plan-mode.ts`、`list-models.ts`、`read-session-context.ts` |
| 记忆/计划 | `todo.ts`（TodoRead/TodoWrite）、Cron 四件套（`cron.ts`） |
| 工作流 | create/amend/get/list/resume/save/eval/resolve-workflow 9 个 |
| 扩展 | `skill.ts`（Skill）、MCP 投影（`mcp__<server>__<tool>` 命名，`mcp/name.ts`，默认超时 30s） |

注册中心：`tool/registry.ts` 的 `ToolRegistryImpl`（支持 alias，`toContracts()` 输出模型侧工具契约）。执行：`tool/executor/impl.ts` + `call-runner.ts` + `permission-rules.ts`。

**native-search（事实澄清）**：仓库脚本里的 "native-search-tools" 是打包概念（ripgrep/ugrep 原生二进制）；运行时机制是 **embedded search branch**——`core/src/embedded-search/capability.ts` 评估后向 Bash 注入托管的原生 find/grep prelude（`cli/src/internal-search/embedded-search-cli.ts`），开关为 `nativeSearchEnhancementsEnabled`。

## A5. 提示词系统

- 组装器：`core/src/context/builder.ts` 的 `ContextBuilder.build()`，按 section 拼装，`cacheHint` 控制 prompt cache 断点。
- Sections（`core/src/context/sections/`）：`identity.ts`（安全声明 `SECURITY_NOTICE` + harness block + "You are an interactive ZCode agent…"）、`env-info.ts`、`skills.ts`、`memory.ts`（AGENTS.md/记忆注入）、`current-date.ts`、`cli-prefix.ts`、`workflow-actor.ts`、`desktop.ts`、`request-user-context.ts`；动态部分 `context/dynamic-sections.ts`（output style、context management、session guidance）。
- 工具说明不镜像进 system prompt，由请求的 tools 字段承载（减少 token 重复）。
- 子代理提示词：`subagent/system-prompt.ts`、`persistent-memory-prompt.ts`。

## A6. 记忆与上下文管理

- **Compaction**：`core/src/compact/`——`policy.ts` 的 `AutoCompactPolicy`（默认 200k 窗口、`AUTOCOMPACT_BUFFER_TOKENS = 13_000`、输出预留 32k、连续失败上限 3）、`microcompact.ts`（局部压缩）、`prompt.ts`（摘要提示词）、`rounds.ts`；持久化 `runtime/methods/compact-persistence.ts`，用量 `runtime/methods/context-usage.ts`。
- **长期记忆**：`core/src/memory/`——受控目录与敏感路径黑名单（`memory-file-path.ts`）、后台提取（`extraction.ts` 的 `buildMemoryExtractionPrompt` + 调度器）、`memory-agent-loop.ts`、recall 索引（`recall/`）、origin-session 追踪、project-root 判定；注入 section 为 `context/sections/memory.ts`。
- **Todo**：`tool/handlers/todo.ts`。

## A7. 权限与安全

- **核心**：`core/src/permission/service.ts` 的 `PermissionService`——allow/ask/deny 三值决策、会话级 allow 规则（`grantSessionPermission`）、`alwaysAsk` 不可被 hook 覆盖的结构化标记。
- **交互审批**：`permission/broker.ts`（v4 wire `optionId` 命中）；选项构造在 `bootstrap/src/permission-options.ts`（`buildProtocolPermissionOptions`，"Always allow in this session"，规则键 `command/url/file_path/path/pattern`）。
- **规则匹配**：`permission/rule-matching.ts`（`wildcardToRegExp`、webfetch URL 规则）；webfetch 预批准域列表 `tool/webfetch-preapproved.ts`。
- **Bash 只读判定**：`tool/handlers/bash-readonly-policy*.ts` allowlist（约 40 个文件，按命令分类）。
- **Sandbox**：bash handler 内置 sandbox 元数据；子进程安全 `adapters/src/exec/` 与 Windows Job Object（`adapters/src/mcp/windows-job-object.ts`）。
- **Hooks 信任**：`core/src/hooks/workspace-hook-trust-*.ts`（配合 shared 的 `workspace-hook-*` 子域）。
- **旁路与恢复**：full access 旁路 `runtime/permission-full-access.ts`，授权恢复 `runtime/permission-grant-recovery.ts`。

## A8. 状态与持久化

- 会话 = SQLite（`adapters/src/storage/session-store.ts`，`createSqliteSessionStore`/`getDefaultSessionDbPath`，含 migration runner）；消息/checkpoint 持久化 `core/src/runtime/methods/message-persistence.ts`。
- Resume：`cli/src/resume.ts`（`--resume <id>` 或 `--continue` 取 `resolveLatestSession`）。
- 命令准入：见 A2（CommandInbox）。

## A9. 可观测性与评测

- **日志**：`adapters/src/logging/index.ts`（`NodeFileLogger`、`createNodeLoggerFactory`、`DefaultLogRedactor` 脱敏、retention；启动日志 `bootstrap/src/startup-logging.ts`）。
- **遥测**：`telemetry/src/` OTel OTLP（GZIP、trace 采样 0.1、指标间隔 300s、`error-sanitizer.ts` 脱敏、`model-api-recorder.ts`），bootstrap 异步动态加载，未启用则零开销。
- **评测（现状事实）**：**无独立 eval/bench 套件**。最接近的是 `tools/prompt-trajectory/`（OpenAI 协议轨迹录制/派生，检查 prompt 组装）与 `scripts/shadow-replay.mjs`（影子回放）；`EvalWorkflowSnippet` 是产品工具而非评测基建。→ 改进建议见 04。

## A10. 能力边界（合理推断，基于代码结构）

- 强项：协议化宿主集成（v4 CAS/lease/ack）、细粒度权限与只读判定、上下文工程（compaction/memory/cacheHint）、多形态一致性。
- 边界：评测体系缺位使行为回归只能靠人工；Windows 支持是显式目标但 sandbox 深度各平台不一；Computer Use 当前 fail-closed 占位。

---

# B 部分：如何让 AI Agent 在本仓库发挥最大作用

## B1. 现有资产盘点（现状事实）

| 资产 | 位置 | 作用 |
| --- | --- | --- |
| 工作区 AGENTS.md | 根 `AGENTS.md` | 命令表、架构红线、UI/平台边界、日志规范、Workspace Identity 规则——已相当完善 |
| CLI 子仓 AGENTS.md | `apps/zcode-cli/AGENTS.md` | Agent 内核的硬约束（400 行/adapter 收敛/tool 元数据/traceId） |
| 架构治理 | `architecture-policy.yaml` + `scripts/architecture/` + `.agents/skills/architecture-governance/` | 模块边界/分层/行数/入口检查 + baseline |
| 技能库 | `.agents/skills/` 8 个：architecture-governance、feature-boundary-planner、dep-refs、agent-browser、electron、dogfood、ai-elements、react-best-practices | 覆盖"改架构→定边界→查引用→自动化验证"链路 |
| 领域文档 | `CONTEXT.md`（插件商店词汇）、`DESIGN.md`（UI token 约束）、`specs/`、`docs/` | 约定与历史决策 |
| 记忆系统 | `MEMORY.md` + `memory/`（3 条） | 跨会话事实沉淀 |
| 依赖洞察 | `pnpm knip`、`pnpm dep:refs --list-exports`、`pnpm architecture:context <module-id>` | 未用导出/引用查询/受控上下文 |

## B2. 差距与建议（改进建议，P0/P1/P2）

1. **P0｜把"验收"变成 Agent 可执行的命令**。当前测试仅 6 个文件、无 CI，Agent 改完代码后唯一的机械反馈是 `pnpm typecheck` + `pnpm lint` + 架构检查。建议：为核心纯逻辑包（shared 协议、rpc、model-option-map、core 的 scheduler/permission/compact）补 `node:test` 单测，并在 AGENTS.md 的命令表中固化"改哪类文件必须跑哪个测试"的映射。Agent 的产出质量取决于反馈回路的带宽。
2. **P0｜加最小 CI**。`verify:pre-push`（lint + architecture:check --changed）+ `pnpm typecheck` 直接搬进 GitHub Actions，即可让 Agent（和人）的每次提交获得同一套裁决；后续再挂 knip 与测试。
3. **P1｜把协议变更做成 schema 快照测试**。`zcode-protocol`（3490 行 zod）与 `zcode-protocol-v4` 是三端共享契约，最适合用"协议样本 fixture 往返序列化断言"守护（v4 二进制 wire 尤其需要 `wire-reassembly` 的往返用例）。
4. **P1｜修正治理盲区**。`architecture-policy.yaml` 中 session 模块声明的入口文件不存在、13+ 模块 `managed: false`——建议逐步把高频改动模块（services 的 zcode-agent、ui 的 store）转 `managed: true`，让 Agent 的架构技能有真检查可依，而非仅靠 prompt 约定。
5. **P2｜用记忆系统沉淀"排障结论"**。`memory/` 目前 3 条，均为 merge/rebrand 历程。建议每次复杂排障（如远程凭据 401、Windows 路径问题）后按记忆规范落盘一条 project 记忆——这直接提升后续 Agent 会话的一次通过率。
6. **P2｜技能与文档闭环**。`feature-boundary-planner` 技能已能把行为改动映射到 UI 面/状态所有者/协议命令，建议在 AGENTS.md 的"实现与验证"节显式要求：跨协议/UI 的改动先跑该技能产出边界清单再动手。

## B3. 一个 Agent 友好度自评（合理推断）

| 维度 | 评分 | 依据 |
| --- | --- | --- |
| 仓库地图与导航 | ★★★★★ | AGENTS.md 命令表 + `architecture:context` 模块阅读包 |
| 约定明确度 | ★★★★★ | 根/CLI 两份 AGENTS.md + DESIGN.md/CONTEXT.md |
| 机械可验证性 | ★★☆☆☆ | typecheck/lint/arch-check 强，但测试与 CI 几乎缺席 |
| 变更影响分析 | ★★★★☆ | feature-boundary-planner + dep:refs + knip |
| 经验复用 | ★★★☆☆ | 记忆系统已建，条目少 |
