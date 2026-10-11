---
name: zcode2-fresh-branch-plan
description: 2026-10-11 决定放弃 ycode，从官方 origin/main 重开 zcode2 分支；只做减法（去遥测 + 去强更锁），完整方案见 docs/FRESH-BRANCH-FROM-MAIN-PLAN.md
metadata:
  type: project
---

2026-10-11 决定：**不再在 `ycode` 上修补**，改为从官方基线重开分支 `zcode2`（`git checkout -b zcode2 origin/main`），只做减法。

**为什么**：`origin/main` 就是官方 ZCode v3.15.1 原样（tip = `aac47556`）；`ycode` = 它 + 26 提交，其中改造提交 `df6b4647` 一个就动了 **608 文件 / 删 78,491 行**，删的是 `node.ts`、`main/index.ts`、`desktopHostProcess.ts`、`desktopWindowChrome.ts`、`channels.ts` 这些**共享装配文件**——之后每次"恢复接线"都在猜当初删了什么（已补 5 处）。ycode 全量差异 908 文件 / +9,403 / −146,587。

**已拍板决策**：品牌保留 ZCode；版本从 3.15.1 起（代价：已装 ycode 3.15.5 的机器看不到应用内更新）；P3 登录墙不做（接受 WelcomeScreen 走 API-key 入口）；**P2 强更 kill-switch 要删**；数据目录继续共用 `~/.zcode`；分支名 `zcode2`。

**三条原则**：① 只做减法不重写；② 耦合点只做「可选化」不做「删除」（必填回调改 `?` + `opts.x?.()`；服务注册保留、只让实现降级；协议分支保留、处理函数 no-op）；③ 不确定的一律保留上游原样。

**四个必须避开的陷阱**（都会静默破坏通用能力，细节与 file:line 见方案 §6）：① `telemetryCore.ts` 不能整个删——`ensureTelemetryDeviceMid` 喂 remote workspace 的 billing `X-Device-Mid`；② `appLaunchCoordinator` 不能跟着 `appTelemetryRuntime` 删——启动门永远不推进；③ `appCrashCaptureBootstrap.ts` 的 `remoteCrashReporterEnabled` 要改回 `false`，否则本地崩溃上报消失；④ 不要删 `useRootOAuthEffects`/`isRestoringOAuthSession`——`Root.tsx` 硬编码 true，唯一写 false 的就是那个 effect，删了永久黑屏。

**Why:** 在重写过的基线上补漏是无底洞；差异面越小，合并上游越安全、漏接线面越小。
**How to apply:** 新会话直接读 `docs/FRESH-BRANCH-FROM-MAIN-PLAN.md`（含执行清单、遥测删除清单、验收标准、可移植资产列表）；从 ycode 搬护栏脚本与 memory，基线用 `--update` 重新生成。相关：[[ycode-opensource-audit]]、[[ycode-wiring-guardrails]]、[[local-machine-ipv6-blocked]]
