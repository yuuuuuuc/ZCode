# 04 设计改进建议

> 每条包含：问题（现状事实）→ 影响 → 建议方案 → 收益/成本/风险 → 优先级 → 迁移步骤。标注"推断"处为分析推演，其余为源码证据。

## P0-1 建立 CI 流水线

- **问题（事实）**：`.github/` 目录不存在，无任何托管 CI；质量门禁是本地的 `verify:pre-push`（lint + architecture:check --changed）+ husky——而 `.husky/` 内只有自动生成的 `_` 目录，**没有任何被 git 跟踪的 hook 文件**，lint-staged 也无配置。即"提交前检查"目前纯靠开发者自觉。
- **影响**：架构红线（400 行、循环依赖、publicEntrypoints）与类型正确性只在意向层面被执行；fork 合并上游（已有一次 v3.14.3 merge）时无回归网。
- **建议**：GitHub Actions 两条 workflow——① `verify`（node 24 + pnpm install → typecheck → lint → architecture:check --changed → knip），PR 触发；② `distribution-smoke`（`scripts/zcode-distribution-smoke.mjs`），主干触发。
- **收益/成本/风险**：收益最高、成本最低（脚本全部现成）；风险小（Windows runner 上 node-pty/electron 安装可能慢，可先跑 Ubuntu + 缓存）。
- **迁移步骤**：新增 `.github/workflows/verify.yml` → 用 `mise` 或直接 `pnpm` 安装 → 跑通后把 AGENTS.md"提交前检查"节指向 CI。

## P0-2 补齐测试底盘

- **问题（事实）**：全仓仅 6 个测试文件（services 3、shared 1、ui 1、cli 1），全部用 `node:test`；无 e2e 目录；核心 Agent 运行时（turn-machine、ToolScheduler、PermissionService、CommandInbox、compaction policy）零测试。
- **影响**：Agent 行为回归只能靠人工 dogfood；对上游 merge 的验证靠 `specs/merge-main-v3.14.3-into-ycode.md` 的手工验收清单。
- **建议**：按"纯逻辑优先"补测（见 03-B2），框架沿用 `node:test`（与现有 6 个测试一致、零新依赖，符合 CLI 子仓零生产依赖精神）。
- **迁移步骤**：先测 `shared/src/zcode-protocol-v4`（wire 编解码往返、CAS 集合）→ `core/src/tool/scheduler.ts`（拓扑分组）→ `permission/rule-matching.ts`（wildcard）→ `compact/policy.ts`（阈值边界）。

## P1-1 收敛 server-core 复制

- **问题（事实）**：`packages/zcode-server-cli/src/server-core/{core,http,entry}.ts` 是 `packages/server/src/http.ts` 的**精简复刻**（同款 `/api/server-info`、`/ws`、`/ws/host`、capability 签发），非 import 复用。
- **影响**：认证/capability 逻辑双写，安全修复需同步两处（推断：漏同步即产生准入差异）。
- **建议**：把 `packages/server` 的 http 装配抽成可参数化函数（如 `createZCodeHttpServer(services, { trustedHostRoute?: boolean, staticRoot?: … })`），server-cli 复用并关闭静态托管；若两形态有意保持解耦，至少把 capability 签发/校验抽到 shared。
- **收益/成本/风险**：消除双写；成本中等（需梳理 server-cli 对"精简"的具体差异点）；风险是两处行为存在隐性差异，抽取前需 diff 对齐。
- **迁移步骤**：逐路由 diff 两份实现 → 抽公共装配 → server-cli 改 import → 发行包冒烟（`zcode-distribution-smoke.mjs`）。

## P1-2 修正架构治理的"假覆盖"

- **问题（事实）**：`architecture-policy.yaml` 中 14+ 模块仅 `storage` 为 `managed: true`；session 模块声明的 `publicEntrypoints` 指向 `packages/services/src/session/contract.ts`——**该文件不存在**（session 域实际契约是 `zcode-session/zcodeSession.ts` 的 `IZCodeSessionService`）；`.architecture-baseline.json` 为空（0 条）。
- **影响**：治理脚本对绝大多数模块不产生约束，AGENTS.md 中的架构红线实际靠 prompt 约定执行；policy 声明与代码漂移无人发现。
- **建议**：① 修正 session 的 entrypoint 声明或补建契约文件；② 分批把改动最频繁的模块（services/zcode-agent、shared/zcode-protocol-v4、ui/store）转 managed；③ `architecture:report` 定期全量跑，把存量违规入 baseline，只拦新增。
- **收益/成本/风险**：让既有治理基建真正生效；成本是清理存量违规的人力；风险低（baseline 机制本身支持渐进）。

## P1-3 完成 v3→v4 协议收敛

- **问题（事实）**：`shared/src/zcode-protocol/`（v3，3490 行 zod，74 method）与 `shared/src/zcode-protocol-v4/`（约 50 文件二进制 wire）并存；`bootstrap/src/zcode-protocol/` 与 `zcode-protocol-v4/` 两代网关并存（v4-gateway.ts 注释明示旧 v3 在旁边）。
- **影响**：双轨维护、双倍 schema 面积、新开发者需理解两套语义；共享协议文件已 3490 行，接近单文件可维护边界。
- **建议**：确认 v4 覆盖 v3 全部宿主场景后（待确认项见 05），冻结 v3 新增、按域迁移 method、最后移除 v3 网关；迁移期在 v3 method 上标注"已由 v4 command X 承接"。
- **收益/成本/风险**：单一协议事实源；成本高（跨三端）；风险是远程/手机链路（web-remote-replayable）对 v3 有隐含依赖，需按 AGENTS.md 要求双链路验证。
- **迁移步骤**：梳理 v3 method ↔ v4 command 映射表 → 逐域迁移 + 双跑 shadow → 删 v3。

## P1-4 husky 落地或删除

- **问题（事实）**：`package.json` 声明 `prepare: husky`、devDeps 含 husky + lint-staged，但 `.husky/` 无任何自定义 hook，lint-staged 无配置文件。
- **影响**：安装期执行无效 prepare；承诺的钩子防护不存在。
- **建议**：二选一——加 `pre-commit`（oxlint + oxfmt --check 对 staged 文件）与 `pre-push`（`pnpm verify:pre-push`）；或移除 husky/lint-staged 依赖并在 AGENTS.md 说明依赖 CI。与 P0-1 配合取前者的价值更大。

## P2-1 ui 包结构治理

- **问题（事实）**：`packages/ui/src` 顶层平铺 100+ 业务组件入口，共 609 个 tsx；`exports` 直出源码；根 store 文件 26 个。
- **影响**：导航成本高；knip 需要显式 ignore `packages/ui/src/components/**`；顶层与子目录边界靠约定。
- **建议**：按现有域子目录（app-shell/terminal/mentions/…）继续归拢顶层文件，`exports` 收紧为按域子路径；不引入预打包（保持源码直出以服务双宿主）。
- **迁移步骤**：先出顶层文件→域映射清单（可复用 `pnpm architecture:context`）→ 机械搬移 + import 更新，分批 PR。

## P2-2 文档与事实同步

- **问题（事实）**：README.md:80 称 dev 下 `/api/v1/oauth/token` 单独代理到产品服务，但 `packages/web/vite.config.ts` 只代理 `/ws` 与 `/api`，未见该条（若属 vite 代理默认覆盖 `/api` 前缀则描述误导）；根 `AGENTS.md` 描述的包清单与实际有出入（未列 provider/provider-node/formal-proof/model-option-map/zcode-cua/zcode-server-cli；`session/contract.ts` 描述与实际不符）。
- **影响**：AI Agent 与新人按文档行事会走错路——文档即 Agent 的 prompt，失真即行为失真。
- **建议**：以本审查的 01-modules.md 为底稿校订 AGENTS.md 与 README；对每个包补一句话职责。
- **迁移步骤**：核对 vite 代理规则与 oauth 实际链路 → 修 README → 校订 AGENTS.md 包清单与命令表。

## P2-3 评测基建（面向 Agent 产品本身）

- **问题（事实）**：无 eval/bench 套件；现有最近物为 `apps/zcode-cli/tools/prompt-trajectory/`（轨迹录制/派生）与 `scripts/shadow-replay.mjs`。
- **影响**：prompt 修改（`context/sections/`、`compact/prompt.ts`）与工具策略调整（bash-readonly-policy 约 40 文件）无回归度量。
- **建议**：基于 prompt-trajectory 扩展：录制一组代表性会话轨迹 → 断言 prompt 组装 diff 与工具权限决策（不追求端到端质量评分，先守护"结构回归"）；配合 03-B2 的单测形成两级防线。

## 改进优先级总览

| 项 | 问题 | 优先级 | 成本 | 前置 |
| --- | --- | --- | --- | --- |
| CI 流水线 | 无任何托管 CI | P0 | 低 | 无 |
| 测试底盘 | 6 个测试文件 | P0 | 中 | 无 |
| server-core 收敛 | 双写认证/capability | P1 | 中 | diff 对齐 |
| 架构治理落真 | 13+ 模块未纳管、声明漂移 | P1 | 中 | 存量清理 |
| v3→v4 收敛 | 双协议并存 | P1 | 高 | 映射表 |
| husky 落地 | 声明与事实不符 | P1 | 低 | 与 CI 合并做 |
| ui 结构治理 | 顶层 100+ 平铺 | P2 | 中 | 映射清单 |
| 文档校订 | AGENTS/README 漂移 | P2 | 低 | oauth 链路确认 |
| 评测基建 | 无 eval | P2 | 中高 | P0-2 |
