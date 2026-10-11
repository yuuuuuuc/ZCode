---
name: ycode-wiring-guardrails
description: 漏接线类事故的两道自动化护栏（main 类型棘轮 + host/main 孤儿扫描）及其基线文件、归一化技巧与更新方式
metadata:
  type: project
---

2026-10-11 为「裁剪上游后漏接线」这类反复事故（plugin-sync 注册、WRC 回调、gen-ui、网络抓包，共四次）加了两道护栏，都挂在 `pnpm verify:pre-push`。

**P2-1 main 类型棘轮**：`scripts/check-desktop-main-type-baseline.mjs`（`pnpm check:desktop-main-types`），基线 `.desktop-main-type-baseline.json`（85 键 / 117 条）。因为根 `pnpm typecheck` 只跑 `tsconfig.host.json`，不含 `tsconfig.main.json`。
- 错误键 = `(文件, TS 错误码, 规范化后的首行消息)`，忽略行列号。
- **关键技巧**：必须把**长于 60 字符的引号片段**替换成 `'X'`。tsc 打印的 union/object 类型渲染会随**无关**的窄化变化（实测：给 `desktopHostProcess.ts` 加/删一个 `if (msg.type === ...)` 分支，同一批存量错误的消息文本就变了），不归一化会每次无关改动都误报。实测该归一化对增删分支稳定。
- 多行诊断（嵌套类型渲染）只取首行，续行丢弃，所以 117 条错误在 `--pretty false` 下是 187 行。
- 重写基线：`node scripts/check-desktop-main-type-baseline.mjs --update`。

**P2-3 孤儿扫描**：`scripts/check-desktop-orphan-modules.mjs`（`pnpm check:desktop-orphans`），基线 `.desktop-orphan-modules-baseline.json`。
- 判定：`packages/desktop/src/{host,main}` 下 git 跟踪的 `.ts`（排除 `.test.ts`），在 `packages/**`/`apps/**` 里找不到 `/<basename>.js"` 形式的相对 import = 孤儿。
- 排除声明式清单（任何名为 `module.ts` 的文件）；基线每条**必须带 reason**，缺 reason 直接判失败。
- 实现要点：**一次** `git grep -h -o -E "['\"][^'\"]*\.js['\"]"` 收集全部被 import 的 basename，再集合比对。逐文件起 `git grep` 会慢到 180s+（226 个文件 × 一次 git 进程）；批量后 2.5s。
- 用 `git ls-files` 读索引，所以**未暂存的删除会假报孤儿**，已用 `existsSync` 过滤；新文件必须 `git add` 后才会被扫到（pre-push 时已暂存，符合预期）。
- 当前基线 1 条：`packages/desktop/src/main/webRemoteControlRendererReconnect.ts`（WRC 有意停用）。

**这两道护栏抓不到的第三类（2026-10-11 真机发现）**：**文件内某个分支被删**——模块还在、还在被 import、类型也对，只是某段调用被剪掉。gen-ui 的 `desktopWindowChrome.ts` will/did-attach 沙箱分支就是这么漏的，孤儿扫描（按文件）和类型棘轮（按错误）都看不见。这类只能靠真机冒烟或 E2E 覆盖，所以 `docs/RELEASE-PRERELEASE-FLOW.md` §3 的清单条目（gen-ui 卡片、网络页）是必要补充，不能靠这两条命令替代。

**Why:** 这两类缺口静态类型检查都抓不到，只能靠运行时或人工比对，已连续多次漏到线上。棘轮/基线让它们变成可自动发现，且不必先清存量。
**How to apply:** 再遇「通道超时」「必填回调未接线」「模块在但没人 import」，先跑这两条命令定位；新增豁免必须写 reason。若两条命令都过但功能仍然坏，按「文件内分支被剪」的方向查，并回上游 `git show aac47556:<file>` 比对。相关：[[ycode-opensource-audit]]
