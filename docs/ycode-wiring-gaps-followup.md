# Ycode 合并漏接线：审计结论与后续工单

> 面向**新会话**的可执行工单。背景、审计方法、每项任务的精确位置与验证方式都在本文里。
> 动手前先读 §0；§1 是**已经做完、不要重做**的部分。

## 执行状态（2026-10-11）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| P0-1 真机验收 gen-ui | ⚠️ **真机未通过 → 已修，待复验** | 真机验收抓到了第 5 处漏接线：`desktopWindowChrome.ts` 的 will/did-attach 沙箱分支被剪，`zcode-sandbox://` webview 掉进内置浏览器白名单被拦（`[browser-pane] blocked unsupported webview url`）。已修 + 补回归用例（见提交 `97a0e420`），需重新真机确认卡片渲染 |
| P0-2 冒烟清单 | ✅ 完成 | `docs/RELEASE-PRERELEASE-FLOW.md` §3 加了两条：gen-ui 卡片（第 7 条）与资源管理器网络页（第 8 条） |
| P1 网络抓包接线 | ✅ 完成 | host/main 两侧按上游 `aac47556` 补齐；`desktopHostProcess.test.ts` 补了回归用例 |
| P2-1 main 类型棘轮 | ✅ 完成 | `scripts/check-desktop-main-type-baseline.mjs` + `.desktop-main-type-baseline.json`（117 条 / 85 键），已挂 `verify:pre-push` |
| P2-2 channel 覆盖测试 | ✅ 完成 | `packages/services/test/localServiceChannelCoverage.test.ts`（含与客户端源码的漂移守卫） |
| P2-3 孤儿扫描进 CI | ✅ 完成 | `scripts/check-desktop-orphan-modules.mjs` + `.desktop-orphan-modules-baseline.json`，已挂 `verify:pre-push` |
| P3 红名单 | ❌ 未做（本会话范围外） | **推送仍会被存量红挡住**，见下 |
| P4-1 plugin-ui-bridge 决策记录 | ✅ 完成 | 记入 `docs/MERGE-MAIN-INTO-YCODE-HANDOFF.md` |
| P4-2 UI capability 探测 | ❌ 未做（本会话范围外） | |
| P5 文档与小账 | ✅ 完成 | 交接文档订正；`schedulerProtocol.*` 移出版本控制并 gitignore；删除 `mcpUserDirectory/{claude,opencode,toml}.ts`、`zcodeDataSize{Scanner,Worker,WorkerClient}.ts`、`output-style/` |

> ⚠️ **P3 未做 → `pnpm verify:pre-push` 仍会被 194 文件 / 791 例存量红挡住**（`channels.ts` / `node.ts`
> 是 hub，`vitest related` 会展开成全量）。本次改动含 `channels.ts`，所以推送前必须先清 P3 的最小集合，
> 否则只能用非 pre-push 路径交付。

---

## 0. 必读（开工前）

1. `node scripts/check-workspace-freshness.mjs` —— 基线过期就先 `git merge --ff-only origin/ycode`。
2. 读记忆索引 `MEMORY.md`，再按需打开：
   - `memory/ycode-opensource-audit.md`（开源化改造裁剪清单 + 3.15.5 两次漏接线修复）
   - `memory/visualize-vendor-crlf-hashes.md`（vendor 哈希 / CRLF 坑）
3. 读 `docs/MERGE-MAIN-INTO-YCODE-HANDOFF.md`（上次 main→ycode 合并的交接）。
4. **参考基线**：`git show aac47556:<file>`。
   `aac47556` = 上游 v3.15.1，且 `origin/main` 在本文涉及的所有文件上与它**逐字相同**（已验证）。

---

## 1. 已经做完的部分（不要重做）

`df6b4647`（开源化改造）重写装配时，把整条 gen-ui 链路剪断了。已在 `150d89a5` 修复并验证，记忆落在 `3a259003`：

| 层 | 补回的内容 | 文件 |
| --- | --- | --- |
| 服务装配 | `IGenUiService` 注册、`createGenUiService` 装配、`registerPluginSandbox` 强类型、两条 dispose | `packages/services/src/node.ts` |
| 沙箱登记链 | `createPluginSandboxRegistrationBridge`（send/accept/dispose）、`createLocalServices` 注入、`PluginSandboxRegisterRequest` 转发分支、`registerPluginSandbox` 实现、`installPluginSandboxHost` 启动装配、`PLUGIN_SANDBOX_PRIVILEGED_SCHEME` 注册 | `packages/desktop/src/{host,main}/…` |
| 构建接线 | vite `plugin-sandbox.html` 入口；tsup `preload/pluginSandbox` 入口 + `plugin-sandbox-alias` 块 + `copyGenUiRuntimeAssets`；`PluginSandboxChannels` 常量 | `vite.config.ts` / `tsup.config.ts` / `packages/shared/src/channels.ts` |
| 换行 | `.gitattributes` 强制 visualize vendor 按 LF 检出 | `.gitattributes` |

已验证：`pnpm typecheck` 0 错误；`pnpm lint` 0 错误（108 warning = 基线）；`npx tsc -b packages/desktop/tsconfig.main.json` 118 → 117（无新增）；`pnpm exec tsup` 5/5 全绿；`vite build` 产出 `out/renderer/plugin-sandbox.html`；vendor 4 个 `.js` 的 sha256 与 manifest 一致；gen-ui 17 例 + pluginSandbox 24 例单测通过。

**唯一未验证**：真机 GUI 里卡片是否真的渲染并可交互 → 见 P0。

---

## 2. 审计方法与结论

### 2.1 方法（可复用，别再对着 diff 硬看）

`git diff aac47556 HEAD` **不是**可用的漏接线探测器：它输出 14 万删除行，绝大部分是整块重写，噪声淹没信号。正确做法是**按集合比对**，逐层比"上游有的键 / 现在有的键"：

```bash
# services 注册链（注意 .register( 后面的描述符可能换行）
git show aac47556:packages/services/src/node.ts \
  | perl -0777 -ne 'while(/\.register\(\s*(I[A-Za-z]+)/g){print "$1\n"}' | sort -u > /tmp/up.txt
perl -0777 -ne 'while(/\.register\(\s*(I[A-Za-z]+)/g){print "$1\n"}' packages/services/src/node.ts | sort -u > /tmp/head.txt
comm -23 /tmp/up.txt /tmp/head.txt     # 仅上游有 = 现在缺失

# 客户端请求的 channel vs 本地注册的 channel
grep -oE "ProxyChannel\.toService<[A-Za-z]+>" packages/client/src/remoteServiceAccess.ts \
  | sed -E 's/.*<([A-Za-z]+)>/\1/' | sort -u > /tmp/requested.txt
comm -23 /tmp/requested.txt /tmp/head.txt   # 请求了但没注册 = 会 1000ms 超时

# 构建入口 / 协议分支 / 常量，同理比集合
git show aac47556:packages/desktop/tsup.config.ts | perl -0777 -ne 'while(/name:\s*"([^"]+)"/g){print "BLOCK:$1\n"} while(/^\s*"([^"]+)":\s*"src\//mg){print "ENTRY:$1\n"}'
git show aac47556:packages/shared/src/channels.ts | grep -oE "export const [A-Za-z]+Channels"
# 协议分支：grep -oE "HostResponseTypes\.[A-Za-z]+" / "HostMessageTypes\.[A-Za-z]+"
```

**孤儿模块扫描**（零引用源文件，抓"接线被删、模块还在"这类）：

```bash
for f in $(git ls-files 'packages/desktop/src/host/*.ts' 'packages/desktop/src/main/*.ts' | grep -v '\.test\.ts'); do
  b=$(basename "$f" .ts)
  n=$(git grep -c "/$b\.js\"\|/$b\.js'" -- 'packages/**' 'apps/**' 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
  [ "$n" -eq 0 ] && echo "ORPHAN? $f"
done
```

> 该方法的边界：它按"注册 / 入口 / 分支 / 孤儿"四个维度比集合，**抓不到**"接线被删、改用等价内联表达式补上"的情况。比文本 diff 强，但不等于完备。

### 2.2 结论

| 层 | 结果 |
| --- | --- |
| services 注册链 | 上游 48 → 现在 38。缺 10 = 6 个有意裁剪（cloud-content / coding-plan / highspeed / marketing / oauth / offpeak）+ plugin UI 三件套（有意停用）+ `IOutputStyleService`（模块在、**全仓无消费者**，属死能力） |
| 客户端请求 42 vs 本地注册 38 | 真缺口 4：`IOutputStyleService` + plugin UI ×3。（`IWindowControllerService` 在 `host/index.ts` 单独注册，不是漏） |
| vite renderer 入口 | 一致（已补齐） |
| tsup 块 / 入口 | 只差 `preload/codingPlanWebview`、`preload/rewardsWebview`（账号时代，有意裁剪） |
| shared `*Channels` 常量 | 只差 `CodingPlanWebviewChannels`（有意） |
| `desktopHostProcess` 分支 | 差 11：8 个纯遥测 + `AgentProcess{Error,Exception,Ready}`（纯 ARMS 上报）+ **`NetworkCaptureBatch` / `NetworkTelemetryBatch`** |
| `host/index.ts` 分支 | 差 2：`OffPeakRun`（有意）+ **`NetworkCapture`** |
| 孤儿模块 | `host/hostNetworkCapture.ts`（**真漏，见 P1**）、`mcpUserDirectory/{claude,opencode,toml}.ts`、`zcodeDataSizeWorkerClient.ts`、`pluginSandbox/module.ts`（误报：声明式清单）、`webRemoteControlRendererReconnect.ts`（WRC 有意停用） |

**一句话结论**：服务注册层的唯一活缺口是 gen-ui，已修好；**剩下带用户可见影响的活缺口是网络抓包（P1）**。

---

## 3. 任务清单

### P0 · 本次交付闭环（先做）

**P0-1 真机验收 gen-ui**
- 目的：代码 / 构建 / 单测三层已过，唯一没验证的是"用户能不能看到卡片"。
- 做法：Windows 真机起桌面端，用带可视化的 skill 发一条消息（例如让 `visualize` 插件画个图），确认卡片正常渲染且可交互，日志里**不再出现** `Channel name 'gen-ui' timed out after 1000ms`。
- 失败时排查顺序：① `out/plugin-sandbox/` 下 `gen-ui.js` / `visualize.css` / `visualize.html` / `calendar.js` / `vendor/` 是否齐；② `out/renderer/plugin-sandbox.html` 是否存在；③ host 日志里 `[plugin-sandbox] … -> 404/500`（协议 handler 的请求日志会打出 CSP 与状态码）。

**P0-2 冒烟清单补一条**
- 位置：`docs/RELEASE-PRERELEASE-FLOW.md` §3「晋升前 5 分钟手动冒烟清单」的表格（现在是 6 条）。
- 为什么：现有 6 条**没有一条**能发现 gen-ui 断线——这次事故正是清单覆盖盲区的产物。
- 加一条，例如：`| 7 | 让模型产出一张内联可视化卡片 | 卡片渲染出来且可交互；无 gen-ui 通道超时 |`

### P1 · 恢复网络抓包接线（唯一已知带活功能的缺口）

**证据（已核实）**
- `packages/desktop/src/host/hostNetworkCapture.ts` **存在但零引用**（孤儿）。
- 上游在 `packages/desktop/src/host/index.ts` 有 5 处接线：`import { createHostNetworkCapture }`、`const hostNetworkCapture = createHostNetworkCapture(parentPort)`、两处 dispose 的 `hostNetworkCapture.setCaptureId(null)`、以及 `if (msg.type === HostMessageTypes.NetworkCapture) { hostNetworkCapture.setCaptureId(msg.control.captureId); return; }`。
- main 侧消费端是活的：`resourceManagerNetwork.ts` 的 `configureNetworkCaptureHost`（在 `resourceManagerWindow.ts` 被调用）、`registerResourceManagerNetworkIpc`（在 `desktopMainIpcPlatform.ts` 被调用）、`ingestHostNetworkCapture`（**目前只有自己的测试在调，生产无调用者**）。
- UI 是活的：`packages/ui/src/resource-manager/NetworkSection.tsx`。

**影响**：资源管理器「网络」页只能看到 main 进程自己的流量（`createNodeNetworkCapture("main", …)` 那条还在），看不到 host / agent 子进程的。是**静默的数据不完整**——页面照样有数据，比超时更难发现。

**要改的地方（照 `git show aac47556:<file>` 抄）**
1. `packages/desktop/src/host/index.ts`
   - 补 `import { createHostNetworkCapture } from "./hostNetworkCapture.js";`
   - 在模块级创建 `const hostNetworkCapture = createHostNetworkCapture(parentPort);`（放 `pluginSandboxRegistrationBridge` 附近的桥接区）
   - 两处 host dispose（`disposeHostResources` 的 in-flight 闭包内、`disposeHostResourcesBestEffort`）各补 `hostNetworkCapture.setCaptureId(null);`
   - 在 `parentPort.on("message", …)` 里补 `HostMessageTypes.NetworkCapture` 分支（照上游，紧邻 `DatabaseStartupControl` 附近）
2. `packages/desktop/src/main/desktopHostProcess.ts`
   - 补 `import { ingestHostNetworkCapture } from "./resourceManagerNetwork.js";`
   - 在 result 分发里补：
     ```ts
     if (result.data.type === HostResponseTypes.NetworkCaptureBatch) {
       ingestHostNetworkCapture(result.data.batch, child.pid ?? 0);
       return;
     }
     ```

**⚠️ 只补 capture 那半，不要补 telemetry 那半**
上游同时 import 了 `hostNetworkTelemetry.ts` 的 `registerHostNetworkTelemetry` / `stopHostNetworkTelemetry`，并处理 `HostResponseTypes.NetworkTelemetryBatch` → `ingestHostNetworkObservations`。**这两个文件/函数在 ycode 里已被删除**（`hostNetworkTelemetry.ts` 不存在；`ingestHostNetworkObservations` 全仓无定义），因为它们喂的是已移除的 ARMS 遥测。所以只恢复 capture 链路，`NetworkTelemetryBatch` 分支保持不恢复。动手前值得跟作者确认一次这个判断。

**验证**
- `npx tsc -b packages/desktop/tsconfig.main.json`：与改动前对比**错误集**（只许减少，不许新增；注意行号会位移，要按 `(file, TS code)` 比，不要按行号）。
- `pnpm exec vitest run packages/desktop/test/resourceManagerNetwork.test.ts packages/desktop/test/resourceManagerLifecycle.test.ts`
- 真机：打开资源管理器 → 网络页，一边跑一个会产生网络请求的会话，确认能看到 host/agent 进程的记录（而不是只有 main）。

### P2 · 防复发护栏（结构性，收益最高）

同类事故已发生三次（plugin-sync 注册、WRC 回调、gen-ui + 网络抓包）。根因有两个，都还没堵。

**P2-1 main 的类型棘轮**
- 问题：`pnpm typecheck` 只跑 `packages/desktop/tsconfig.host.json`，**不含 `packages/desktop/tsconfig.main.json`**（该工程现有 117 个存量错误）。WRC 那次"漏传必填回调"如果 main 在门禁里就会被类型拦住。
- 做法（棘轮，不必先清 117 个）：把当前错误冻结成基线文件（按 `(file, TS 错误码, 消息文本)` 三元组，**忽略行列号**，否则行号位移会误报），在门禁里跑 `tsc -p packages/desktop/tsconfig.main.json --noEmit --pretty false`，只拒绝**新增**三元组或同键计数增加。
- 落点：新增脚本（参考现有 `scripts/check-*.mjs` 的写法）并挂进 `pnpm verify:pre-push` 与 `docs/RELEASE-PRERELEASE-FLOW.md` §2.2 的质量门禁。
- 注意：`pnpm typecheck` 本身必须保持全绿（现在就是 0 错误），棘轮只针对 main 这个额外工程。

**P2-2 channel 覆盖测试**
- 问题：`RemoteServiceAccess` 请求的 42 个 channel 与 `createLocalServices` 注册的 38 个是**两份独立手写清单**，没有任何东西保证对齐。这次是手工集合比对才发现的。
- 做法：一个单测，枚举 `remoteServiceAccess.ts` 里的描述符（或直接维护一份显式列表），对本地服务集合断言 `services.getOptional(D) !== undefined`；不满足的必须出现在**显式白名单**里并注明原因（例如 `IWindowControllerService` 由 host 层单独注册、plugin UI 三件套是有意停用）。
- 价值：一次覆盖 gen-ui、plugin-sync、output-style、plugin-ui-bridge 与未来所有同类。
- 这正是 `docs/RELEASE-PRERELEASE-FLOW.md` §6 第 2 条那个思路（IPC 回调层）在**服务层**的对应物。
- 参考：现有 `packages/services/test/localServicesRemoteAuthority.test.ts` 试图做类似的事，但它已因 import 已删除的 `accountProviderCredentialKey.js` 而整体失败（见 P3），可以直接改造它而不是新写。

**P2-3 孤儿模块扫描进 CI（成本最低）**
- 做法：把 §2.1 的孤儿扫描做成脚本，针对 `packages/desktop/src/{host,main}`，对**新增**孤儿报警（维护基线，只拒绝新增）。仓库已有 `pnpm knip`，也可以评估用它统一承载。
- 必须排除声明式清单（如 `**/module.ts` 的架构模块清单）这类"故意不被 import"的文件。

### P3 · 推送门禁的红名单（它现在直接挡着交付）

**现状**：`pnpm verify:pre-push` 的单测阶段 **194 个文件 / 791 例失败**（通过 749 / 8818）。
**已确认这是存量、不是本次改动引入**：把源码回退到 `HEAD~2` 跑同一套，数字逐项相同；失败文件集只差两个**时序 flaky**（`packages/server/test/remoteDeploy.test.ts`、`packages/services/test/subagentRuntimeConfigWatcher.test.ts`），两者都与改动无关。

**为什么会挡住你**：`lint-staged.config.mjs` 对源码改动走 `vitest related`，而 `packages/shared/src/channels.ts`、`packages/services/src/node.ts` 是 hub 模块，`related` 会展开成全部 944 个文件。所以**任何**改这两个文件的推送都会撞上这堆存量红。

**建议**
- **不要**用 `--no-verify`（会把绕过正常化）。
- 按成因分类清理：
  - 一类是**模块加载即失败**（import 已删除的 `accountProviderCredentialKey.js` / `telemetryCore.js` / `useRootOAuthEffects.js` 等）——对应功能已有意移除，正确处置是**删除或 `describe.skip` 并注明原因**，不是修。
  - 另一类是**断言裁剪后行为**（如 `bigmodelIndividualCodingPlan` 之类）——需判断"测试该改"还是"代码漏裁"。
- 先只清"让本次改动（含 P1）能推上去"的最小集合，再逐步收敛全量。
- 配套策略：新增 `describe.skip` 必须带原因 + 指针，否则红名单会变成永久垃圾场。

### P4 · 明确"不做"并留下记录

**P4-1 plugin-ui-bridge：今天不做，但要记录触发条件**
- 价值为零：全部 16 个内置插件**没有一个**声明 `ui.surfaces`，也没有内置插件提供 `ui://` 资源。这条能力是给第三方插件的。
- 一旦要做，顺序是：① 跟作者确认那批 `throw new Error("MCP UI host bridge is unavailable in this Ycode build")` 是**有意停用**还是权宜（措辞看着像有意）；② 定 `accountContext` 在无账号语境下的口径（上游从 OAuth 账号仓库哈希 provider + profile.id，而账号体系已在 `specs/ycode-rebrand.md` 第 2 节有意移除；协议里该字段可选）；③ 按现成 `client.request(zcodeProtocolMethods.xxx, params, schema)` 模式补 host 门面转发——**agent（CLI bootstrap）侧是完整的**，`bootstrap/src/zcode-protocol/mcp-ui/protocol.ts`、`server.ts:696/734`、`plugin-ui-surfaces.ts` 都是真实现，不需要重建。

**P4-2（可选，独立于 P4-1）修 UI 的能力探测**
- 缺陷：`packages/client/src/remoteServiceAccess.ts` 对每个 channel **无条件**建 proxy，所以 `services.pluginUiBridgeService` 恒为真值；`usePluginUiHost` / `usePluginUiSurfaces` 的探测是"服务对象存在即判支持"，于是通道缺失时**不降级为"不支持"，而是走真调用再超时**（卡片进 error 态显示原始超时文案；侧栏面板入口静默为空）。
- 做法：改成显式 capability 声明（注册方声明能力，UI 读声明）。改动小、收益明确，即使 plugin-ui-bridge 一直不做也值得修。

### P5 · 文档与小账

1. `docs/MERGE-MAIN-INTO-YCODE-HANDOFF.md:24` 仍写着 Gen UI / UI plugin sandbox「以能编译为度」保留——**已过期**，且第 31 行"取 theirs"的指令正是这次出错的来源。改成事实：gen-ui 已完整恢复；plugin sandbox 基建已恢复；plugin-ui-bridge 门面有意停用。
2. `packages/desktop/src/scheduler/schedulerProtocol.{js,d.ts,d.ts.map}` 是 **checked-in 生成物且相对 `.ts` 已过期**；每次 `tsc -b` / tsup 都会重新生成把工作树弄脏（本次就误改了两次、需手动 `git checkout --` 还原）。要么重新生成后提交并注明"生成物勿手改"，要么从版本控制移除、改构建期生成。
3. `mcpUserDirectory/{claude,opencode,toml}.ts` 与 `zcodeDataSizeWorkerClient.ts` 也是零引用；且 `packages/desktop/src/main/index.ts` 里 `loadCliMcpFromUserDirectory` / `saveCliMcpToUserDirectory` / `migrateLegacyCommonMcp` 是未使用 import（`pnpm lint` 已在报）。这批要么是"从 Claude/OpenCode 导入 MCP 配置"功能漏接线，要么是该删的死代码——单独判定一次。
4. `packages/services/src/output-style/` 模块完整但注册被删且无消费者。要么补注册（如果产品上还要 output style），要么按死代码清理。

---

## 4. 已知坑（工具与环境）

| 坑 | 说明 |
| --- | --- |
| main 不在 typecheck 门禁里 | `pnpm typecheck` 只含 `tsconfig.host.json`。要查 main 必须单独 `npx tsc -b packages/desktop/tsconfig.main.json`，且它有 117 个存量错误，**只能用来对比"改动前后错误集"**，不能当门禁 |
| pre-push 单测红 | 194 文件 / 791 例存量失败（见 P3）。`test:unit:affected` 手工跑（无 hook stdin）会退回默认分支当 base，等于全量跑 |
| 默认 vitest include 很窄 | 只含 `packages/*/test/**`、`packages/*/src/**/contract.test.ts`、`packages/services/src/gen-ui/**`。`packages/desktop/src/main/pluginSandbox/**`、`packages/desktop/scripts/**` 下的测试**不在**默认范围，且 `vitest run <path>` 也不会收集它们——要用临时 `--config` 指定 `include` |
| 用 `pnpm exec vitest` | 裸 `npx vitest` 会拉错二进制（记忆里已记） |
| `oxfmt`（`pnpm fmt:check`）不可用 | 本机对大量**未改动**文件也报格式问题，不是可用门禁。不要为了它跑 `oxfmt` 写模式，会产生整文件无关 diff |
| 构建会弄脏工作树 | `tsc -b` / tsup 会重新生成 `packages/desktop/src/scheduler/schedulerProtocol.*`，提交前用 `git checkout -- packages/desktop/src/scheduler/` 还原 |
| `git diff aac47556 HEAD` 不是探测器 | 14 万删除行，噪声极大。用 §2.1 的集合比对 |
| `out/` 已被 gitignore | 构建产物不会污染 git status，可以放心跑 tsup / vite |

---

## 5. 明确不要做的事

- 不要按"上游缺失"补回账号/登录/OAuth/off-peak/highspeed/cloud-content/marketing-touch/coding-plan 相关装配——这些是 `specs/ycode-rebrand.md` 有意的裁剪。
- 不要补 `NetworkTelemetryBatch` / `hostNetworkTelemetry`（喂的是已移除的 ARMS 遥测）。
- 不要重建 agent 侧 MCP UI 桥（它完整存在）；plugin-ui-bridge 的缺口在 host 门面与 `accountContext` 口径。
- 不要用 `--no-verify` 绕过 pre-push 门禁。
- 不要把 `packages/services/src/gen-ui/` 或 `packages/desktop/src/main/pluginSandbox/` 当"待重建"——它们完好，缺的只是接线。

---

## 6. 建议执行顺序

1. **P0**（真机验收 + 冒烟清单）——先确认交付物真的可用，否则后面排期都要改。
2. **P1**（网络抓包）——唯一已知带用户可见影响的活缺口，位置已精确定位，照抄即可。
3. **P2-3**（孤儿扫描）→ **P2-2**（channel 覆盖测试）→ **P2-1**（main 类型棘轮）——从成本最低的开始，逐步把这类事故变成可自动发现。
4. **P3**（红名单，至少清到"能推送"）——否则前面所有改动都交付不出去。
5. **P4-2**（UI capability 声明）——小改动、收益明确，可与 P3 并行。
6. **P4-1 / P5**（plugin-ui-bridge 决策记录、文档与小账）——有空再做。

---

## 元数据

- 审计基线：`aac47556`（上游 v3.15.1，`origin/main` 在其上逐字相同）
- 相关提交：`150d89a5`（gen-ui 接线修复）、`3a259003`（记忆落盘）
- 相关记忆：`memory/ycode-opensource-audit.md`、`memory/visualize-vendor-crlf-hashes.md`
- 相关文档：`docs/MERGE-MAIN-INTO-YCODE-HANDOFF.md`、`docs/RELEASE-PRERELEASE-FLOW.md`、`specs/ycode-rebrand.md`
