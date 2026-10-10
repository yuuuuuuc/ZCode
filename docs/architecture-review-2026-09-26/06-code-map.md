# 06 代码地图

> 按"我想做 X → 看 Y"组织的入口索引。路径相对仓库根；行号为 2026-09-26 检出版本，随演进可能漂移。

## 1. 进程与生命周期

| 我想…… | 看 |
| --- | --- |
| 理解桌面启动全流程 | `packages/desktop/src/main/index.ts`（入口，:1515 `createWindowInstance()`） |
| 窗口/标题栏/托盘 | `packages/desktop/src/main/desktopWindowChrome.ts`（:364 `createBrowserWindow()`） |
| Host 进程派生与端口分发 | `packages/desktop/src/main/desktopHostProcess.ts`（:165 `spawnHostProcess()`、:78 `loadWindow()`） |
| Host 侧服务图与 attachment | `packages/desktop/src/host/index.ts`（:1-25 设计注释、:1693 attachment registry 实例化、:2290 attach 流程） |
| cron/off-peak 调度 | `packages/desktop/src/scheduler/index.ts`、`src/main/desktopCronScheduler.ts:45` |
| Agent 进程如何被解析与拉起 | `packages/services/src/zcode-agent/zcodeAgentProcessManager.ts`（:444 `resolveDefaultZCodeAgentCommand()`、:415 Electron runtime、:369/386 spawn 参数）；`shared/src/zcode-agent-runtime.ts:29-36` |
| Web server 入口与路由 | `packages/server/src/entry-http.ts`、`src/http.ts` |
| 发行包组装 | `scripts/build-zcode.mjs`、`scripts/zcode-distribution/runner.mjs` |
| 守护/更新/回滚 | `packages/zcode-server-cli/src/supervisor/supervisor.ts`、`src/runtime/platform/serviceManager.ts` |

## 2. 协议与通信

| 我想…… | 看 |
| --- | --- |
| v3 协议 method/schema 全集 | `packages/shared/src/zcode-protocol/index.ts`（3490 行，74 method） |
| v4 wire/命令/CAS | `packages/shared/src/zcode-protocol-v4/`（`wire.ts`、`command.ts` 的 `COMMANDS_REQUIRING_BASE_REVISION`） |
| 宿主命令收口 | `packages/services/src/zcode-agent/zcodeV4HostCommand.ts` |
| CLI 侧命令准入（CommandInbox） | `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/command-inbox.ts`；v4 网关 `v4-gateway.ts` |
| RPC 框架分层 | `packages/rpc/src/index.ts` 头注释；`channelServer.ts`、`proxy-channel.ts` |
| WS 通道（/ws、/ws/host、/ws/remote） | `packages/server/src/http.ts` |
| 客户端连接 | `packages/client/src/websocket.ts`、`messageport.ts`、`remoteServiceAccess.ts` |
| 实时流/lease/重放 | `packages/desktop/src/main/taskRealtimeBus.ts`；类型 `shared/src/task-realtime.ts`；端口 `services/src/session/sessionRealtimePort.ts` |

## 3. Agent 内核（apps/zcode-cli/packages/…）

| 我想…… | 看 |
| --- | --- |
| 执行循环 | `core/src/runtime/agent-runtime.ts`（`AgentRuntime`）、`runtime/internal-turn-methods.ts` |
| Turn 状态机 | `core/src/agent/turn-machine.ts`（`TurnMachineImpl`）、`agent/turn-state.ts` |
| 工具调度（并行/拓扑） | `core/src/tool/scheduler.ts`（`DEFAULT_MAX_CONCURRENCY = 10`） |
| 工具注册与元数据 | `core/src/tool/registry.ts`、`tool/types.ts` |
| 具体工具实现 | `core/src/tool/handlers/`（bash.ts、edit.ts、webfetch.ts、agent.ts、todo.ts、cron.ts…） |
| 权限决策 | `core/src/permission/service.ts`、`permission/broker.ts`、`permission/rule-matching.ts`、`bootstrap/src/permission-options.ts` |
| Bash 只读判定 | `core/src/tool/handlers/bash-readonly-policy-*.ts` |
| 提示词组装 | `core/src/context/builder.ts`、`context/sections/*.ts`（identity/memory/env-info…）、`context/dynamic-sections.ts` |
| Subagent | `core/src/subagent/`（profile.ts、runner.ts、system-prompt.ts、tool-policy.ts） |
| 压缩 | `core/src/compact/policy.ts`（`AutoCompactPolicy`）、`microcompact.ts`、`prompt.ts` |
| 记忆 | `core/src/memory/`（memory-file-path.ts、extraction.ts、recall/） |
| MCP | `core/src/mcp/index.ts`（`mcp__<server>__<tool>`）、`adapters/src/mcp/`（transport/pool/oauth） |
| 会话持久化 | `adapters/src/storage/session-store.ts`（SQLite）、`core/src/runtime/methods/message-persistence.ts` |
| TUI | `packages/tui/src/tui.tsx`（`runTui()`）、`app.tsx`；CLI 接线 `packages/cli/src/tui-command.ts` |
| 遥测 | `packages/telemetry/src/otlp-exporter.ts`、`agent-metrics.ts` |
| 日志 | `adapters/src/logging/index.ts`（`NodeFileLogger`、`DefaultLogRedactor`） |

## 4. UI 与平台边界

| 我想…… | 看 |
| --- | --- |
| UI 根组件与启动编排 | `packages/ui/src/Root.tsx`（:92 PlatformProvider）、`root/` |
| 会话主状态 | `packages/ui/src/store/zcodeSessionStore.ts`（+ slices） |
| 服务访问 hooks | `packages/ui/src/hooks/useServices.tsx`、`useWorkspaceServices.tsx` |
| 平台抽象 | `packages/shared/src/platform.ts`（`IPlatformService`，941 行）；desktop 实现 `desktop/src/renderer/src/desktopPlatform.ts`；web 实现 `web/src/main.tsx:144` |
| 日志 | `packages/ui/src/logger.ts`（生产 no-op + 桥转发） |
| 多标签 | `packages/ui/src/store/tabStore.ts` |
| 远程会话状态 | `packages/ui/src/store/remoteWorkspaceSessionStore.ts` |

## 5. 配置、模型与生态

| 我想…… | 看 |
| --- | --- |
| 内置模型提供商 | `config/provider/zcode-builtin.json`；构建注入 `scripts/builtin-provider-config.mjs` |
| Provider 注册/校验 | `packages/provider/src/registry.ts`、`resolver.ts`、`config/` |
| Provider 运行时物化 | `packages/provider-node/src/`（materializer、facade） |
| LLM 请求落地 | `apps/zcode-cli/packages/adapters/src/model/model-execution.ts`、`anthropic-stream-compat.ts` |
| ai-sdk patch（视频输入） | `patches/@ai-sdk__anthropic@3.0.81.patch`、`patches/@ai-sdk__openai-compatible@2.0.60.patch` |
| 每模型请求体改写 DSL | `packages/model-option-map/src/compiler.ts`、`option-maps.ts` |
| 客户端内置默认配置 | `config/default.json`、`config/README.md` |
| 插件体系 | `apps/zcode-cli/README.md`（plugin.json 规范）、`services/src/plugins|plugin-sync/`、`ui/src/store/pluginStore.ts` |
| 插件商店词汇 | 根 `CONTEXT.md` |
| UI 设计约束 | 根 `DESIGN.md` |

## 6. 远程与部署

| 我想…… | 看 |
| --- | --- |
| SSH/WSL/Docker 后端 | `packages/server/src/remote/{ssh,wsl,docker}-backend.ts`、`deploy.ts` |
| 远程单文件服务端 | `packages/server/build-remote.ts` → `dist/remote/zcode-server.cjs` |
| 远程连接（desktop 侧） | `desktop/src/main/desktopRemoteSessions.ts`、`src/host/windowRemoteConnectionRegistry.ts` |
| 远程组件分发/缓存 | `desktop/src/main/desktopRuntimeEnv.ts`（:291 `resolveRemoteAssetDirs()`、:325 bundled agent 解析）、`scripts/prepare-prebuilds.mjs`、`packages/desktop/mock-cdn/` |
| workspace identity | `packages/shared/src/remote-workspace-identity.ts`；规则见根 AGENTS.md「Workspace Identity」 |
| 远程测试容器 | `harness/remote/`（Dockerfile，端口 2222） |

## 7. 工程化与治理

| 我想…… | 看 |
| --- | --- |
| 架构策略 | `architecture-policy.yaml`；检查器 `scripts/architecture/architecture-check.mjs` + `index.mjs` + `policy.mjs`；baseline `.architecture-baseline.json` |
| 模块受控上下文 | `pnpm architecture:context <module-id>` |
| 未用导出/引用 | `knip.json`、`pnpm dep:refs --list-exports <file>`、`scripts/dep-refs.mjs` |
| 版本固定 | `mise.toml`（node 24.14.0 / pnpm 10.33.2） |
| workspace 划分 | `pnpm-workspace.yaml`（含 `apps/zcode-cli/packages/*`、`tools/*`） |
| TS 基线 | `tsconfig.base.json`（es2024、nodenext、composite、**无 paths 别名**） |
| 提交检查约定 | 根 `AGENTS.md`「实现与验证」、`pnpm verify:pre-push` |
| Agent 技能 | `.agents/skills/`（architecture-governance、feature-boundary-planner、dep-refs、agent-browser、electron、dogfood、ai-elements、react-best-practices） |
| 长期记忆 | `MEMORY.md` + `memory/`（3 条：windows-license-lockfile-graph、ycode-main-v3143-merge、ycode-opensource-audit） |
| 历史 spec | `specs/ycode-rebrand.md`、`specs/merge-main-v3.14.3-into-ycode.md`、`docs/MERGE-MAIN-INTO-YCODE-HANDOFF.md` |

## 8. 快速理解顺序（新人 6 步）

1. 根 `README.md` + 本目录 `00-overview.md` → 知道三形态与进程拓扑。
2. `packages/desktop/src/host/index.ts:1-25` 头注释 → 10 分钟看懂 Host/attachment 模型。
3. `packages/shared/src/zcode-protocol-v4/command.ts` → 理解宿主↔Agent 命令语义（CAS/ack）。
4. `apps/zcode-cli/AGENTS.md` + `packages/core/src/agent/turn-machine.ts` → 理解 Agent 内核约束与循环。
5. 根 `AGENTS.md` + `architecture-policy.yaml` → 知道改动前要跑什么检查。
6. `packages/ui/src/Root.tsx` + `shared/src/platform.ts` → 理解双宿主 UI 复用机制。
