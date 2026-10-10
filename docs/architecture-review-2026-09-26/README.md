# Ycode 架构审查（2026-09-26）

> 分析对象：当前仓库（`ycode` 分支，基于上游 v3.14.3 合入后的开源化版本）。
> 分析方式：只读审查，未修改任何业务代码。分析深度：架构级审查。
> 目标读者：架构师、技术负责人、后续接手的开发者。
> 事实基准：以 2026-09-26 检出的源码为准，行号引用可能随代码演进而漂移。

## 文档索引与阅读顺序

| 顺序 | 文档 | 内容 |
| --- | --- | --- |
| 1 | [00-overview.md](00-overview.md) | 项目概览、技术栈、目录结构、整体架构图、核心数据流 |
| 2 | [01-modules.md](01-modules.md) | 各模块职责、关键文件、依赖关系、被依赖关系 |
| 3 | [02-integration.md](02-integration.md) | 启动流程、进程拓扑、配置项、环境变量、部署方式、时序图 |
| 4 | [03-agent-maximization.md](03-agent-maximization.md) | Agent（zcode-cli）设计分析 + 如何让 AI Agent 在本仓库发挥最大作用 |
| 5 | [04-design-improvements.md](04-design-improvements.md) | 设计问题、改进方案、权衡、迁移步骤、优先级 |
| 6 | [05-risks-and-roadmap.md](05-risks-and-roadmap.md) | 风险、技术债、待确认问题、路线图 |
| 7 | [06-code-map.md](06-code-map.md) | 按功能组织的关键代码地图 |

## 核心结论摘要

1. **项目本质**：Ycode 是一个 AI 编程工作台的三形态统一产品——Electron 桌面端、浏览器 Web 端、终端 TUI/CLI——三者共享同一套 Agent 运行时（`apps/zcode-cli`）、同一套协议（`packages/shared/src/zcode-protocol*`）和同一套 UI 组件库（`packages/ui`，609 个 tsx）。
2. **进程模型是理解本仓库的钥匙**：桌面端「每窗口一个 Host utilityProcess」，Host 通过 `@zcode/services` 的进程管理器以 `zcode.cjs app-server --stdio` 拉起 Agent 子进程；Web 端由 `packages/server`（hono HTTP + WS）承载同样的 services 集合，同样以 stdio 方式拉起 Agent。协议分 v3（JSON/zod）与 v4（二进制分帧 wire）两代并存。
3. **Agent 实现质量较高**：`apps/zcode-cli/packages/core` 有清晰的分层（core/contracts/adapters/bootstrap）、显式 turn 状态机（`TurnMachineImpl`）、依赖拓扑排序的 `ToolScheduler`（默认并发 10）、三级权限模型（allow/ask/deny）、SQLite 会话持久化、OTel 遥测，且 AGENTS.md 中"零生产依赖、外部 IO 全收敛 adapter、单文件 ≤400 行"等约束在代码中可验证。
4. **最大的短板在工程化而非架构**：全仓无 CI（`.github/` 不存在）、测试仅 6 个文件（`node:test`）、husky 已声明但无任何 hook 文件、架构治理（`scripts/architecture/` + `architecture-policy.yaml`）只覆盖 1 个 managed 模块（storage），其余 13+ 模块均为 legacy。**架构设计先进，但守护设计的自动化防线几乎缺席。**
5. **双协议、双 server-core、v3/v4 并存是主要技术债**：`packages/zcode-server-cli/src/server-core/` 是 `packages/server/src/http.ts` 的精简复刻而非复用；`zcode-protocol`（v3）与 `zcode-protocol-v4`（二进制 wire）长期共存，状态所有权边界清晰但迁移未完成。

## 方法与证据等级

- **现状事实**：来自源码阅读与调研，引用具体文件/符号。
- **合理推断**：由事实推演，标注"推断"。
- **改进建议**：在 04/05 中单列，均标注优先级 P0/P1/P2。
- 无法从代码确认的问题统一放入 05 的"待确认问题"，不做猜测。
