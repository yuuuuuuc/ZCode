---
name: ycode-wiring-guardrails
description: 漏接线类事故的两道自动化护栏（main 类型棘轮 + host/main 孤儿扫描）及其基线文件、归一化技巧与更新方式
metadata:
  type: project
---

2026-10-11 为「裁剪上游后漏接线」这类反复事故（plugin-sync 注册、WRC 回调、gen-ui、网络抓包，共四次）加了两道护栏，都挂在 `pnpm verify:pre-push`。

**P2-1 main 类型棘轮**：`scripts/check-desktop-main-type-baseline.mjs`（`pnpm check:desktop-main-types`），基线 `.desktop-main-type-baseline.json`。2026-10-11 在 `zcode2` P1 去掉官方遥测后用 `--update` 重生成：**55 键 / 82 条**（P0 刚挂上时是 58 键 / 85 条，少掉的是已删的 `appARMSBootstrap.ts` 和 `index.ts` 里 `DesktopTelemetryFetchSource`；ycode 上曾是 85 键 / 117 条，不要把旧数字抄过来）。根 `pnpm typecheck` 含 `tsconfig.host.json` 和 `tsconfig.e2e.json`，仍不含 `tsconfig.main.json`。
- 错误键 = `(文件, TS 错误码, 规范化后的首行消息)`，忽略行列号。
- **关键技巧**：必须把**长于 60 字符的引号片段**替换成 `'X'`。tsc 打印的 union/object 类型渲染会随**无关**的窄化变化（实测：给 `desktopHostProcess.ts` 加/删一个 `if (msg.type === ...)` 分支，同一批存量错误的消息文本就变了），不归一化会每次无关改动都误报。实测该归一化对增删分支稳定。
- 多行诊断（嵌套类型渲染）只取首行，续行丢弃。ycode 上 117 条错误在 `--pretty false` 下是 187 行；zcode2 的 85 条不要套这个行数。
- **归一化盲区（2026-10-12 已修）**：TS6059/TS6307 会把 rootDir、project 的**绝对路径**打进消息，这些路径短于 60 字符不触发 `'X'` 替换，被原样冻进基线；换机器或改仓库目录名（`2_WorkProject` → `2_Project`）后同一条存量错误的消息文本漂移，棘轮把存量误报成「新增」卡住 pre-push。当时的处理是 `--update` 重写基线（等于把本机路径冻进去，换机器再犯一次）。
- **修法**：归一化前先把**仓库根绝对路径**替换成 `<repo>`（`createRepoRootStripper`，覆盖正/反斜杠两种写法、Windows 大小写不敏感，并避开 `…/ZCode2` 这类同前缀兄弟目录）。必须放在长度归一化**之前**——否则同一段路径会因各机器上长度不同，分别落到「保留原文」和 `'X'` 两侧，仍不稳定。规则与单测在 `scripts/lib/desktop-main-type-baseline.mjs` + `scripts/test/desktop-main-type-baseline.test.mjs`（已挂 `vitest.config.ts` 的 unit include，随 `pnpm test:unit` 跑）。脚本另有 `assertNoAbsolutePathLeak`：归一化后若仍残留盘符绝对路径直接 exit 2，**不许**用 `--update` 绕过。判据（`findAbsolutePathLeaks`）必须独立于 stripper——用 stripper 自己测自己的残留是自证循环，漏掉大小写/分隔符变体时两边一起漏。
- 重写基线：`node scripts/check-desktop-main-type-baseline.mjs --update`（55 键/82 条不变，diff 只应出现在含绝对路径的消息上）。

**P2-3 孤儿扫描**：`scripts/check-desktop-orphan-modules.mjs`（`pnpm check:desktop-orphans`），基线 `.desktop-orphan-modules-baseline.json`。
- 判定：`packages/desktop/src/{host,main}` 下 git 跟踪的 `.ts`（排除 `.test.ts`），在 `packages/**`/`apps/**` 里找不到 `/<basename>.js"` 形式的相对 import = 孤儿。
- **只数生产引用**（2026-10-11 复核后修正）：`git grep` 用 `:(exclude)**/test/**` 等 pathspec 排掉测试目录与 `*.test.*` / `*.spec.*`。原先测试 import 也算接线，导致「只剩自己的测试还在引用」的模块永远显示为已接线——`longTaskAttributionSummary.ts`（唯一消费方 `appARMSBootstrap.ts` 已删）和 `processResourceSampleSourceRegistry.ts` 就是这样漏掉的。
- 排除两类约定文件：声明式清单（任何名为 `module.ts`）与契约示例（`*.example.ts`，全仓 10 个，都只被同目录 `contract.test.ts` 引用）。基线每条**必须带 reason**，缺 reason 直接判失败。
- 实现要点：**一次** `git grep -h -o -E "['\"][^'\"]*\.js['\"]"` 收集全部被 import 的 basename，再集合比对。逐文件起 `git grep` 会慢到 180s+（226 个文件 × 一次 git 进程）；批量后 2.5s。
- 用 `git ls-files` 读索引，所以**未暂存的删除会假报孤儿**，已用 `existsSync` 过滤；新文件必须 `git add` 后才会被扫到（pre-push 时已暂存，符合预期）。
- **按 basename 匹配**，所以同名文件（`index.ts` 之类）会互相遮蔽——这是已知漏报，没修。
- zcode2 基线 7 条（修掉测试引用盲区后从 5 条升上来）。上游存量 3 条不接线也不删：`mcpUserDirectory/claude.ts`、`opencode.ts`、`toml.ts`；另有上游就零生产引用的 `host/remoteConnectionServiceCollection.ts`。P1 造成 3 条：只给已删上报投影供数、样本摄入仍在的 `processResourceSystemWindowEvent.ts`、`processResourceSampleSourceRegistry.ts`、`zcodeDataSizeWorkerClient.ts`（`longTaskAttributionSummary.ts` 直接删了）。ycode 上那条 `webRemoteControlRendererReconnect.ts` 在官方 main 有引用，不要再豁免。

**这两道护栏抓不到的第三类（2026-10-11 真机发现）**：**文件内某个分支被删**——模块还在、还在被 import、类型也对，只是某段调用被剪掉。gen-ui 的 `desktopWindowChrome.ts` will/did-attach 沙箱分支就是这么漏的，孤儿扫描（按文件）和类型棘轮（按错误）都看不见。这类只能靠真机冒烟或 E2E 覆盖，所以 `docs/RELEASE-PRERELEASE-FLOW.md` §3 的清单条目（gen-ui 卡片、网络页）是必要补充，不能靠这两条命令替代。

**Why:** 这两类缺口静态类型检查都抓不到，只能靠运行时或人工比对，已连续多次漏到线上。棘轮/基线让它们变成可自动发现，且不必先清存量。
**How to apply:** 再遇「通道超时」「必填回调未接线」「模块在但没人 import」，先跑这两条命令定位；新增豁免必须写 reason。若两条命令都过但功能仍然坏，按「文件内分支被剪」的方向查，并回上游 `git show aac47556:<file>` 比对。相关：[[ycode-opensource-audit]]
