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
**P2 已落地（zcode2）**：启动路径不再调用 `maybeBlockStartupForForceUpdate`，第二实例 / open-url 不再因强更拒绝开窗。`autoUpdater.ts` 与 `requestForceAutoUpdate` 保留。`/api/v1/client/configs` 仍被 `desktopContextPromptRollout.refresh()`、renderer action trace、帮助配置读取；那些不是闸门。`getForceUpdateConfig` / `getForceUpdateMinimalVersionFromConfig` 按原则 ③ 留着。main 类型基线仍是 55 键 / 82 条；字面量联合的打印顺序会变，门禁按字母序归一化。

**已落地（2026-10-11）**：P0/P1/P2 全部完成并真机验证，只剩 P4-1（rc → dogfood → 正式版）。`zcode2` = `origin/main` + 6 提交，差异面 205 文件 / +2.2k / −39k（ycode 是 908 文件 / −147k）。四条陷阱全部守住，`verify:pre-push` 全绿，全量单测 17287 passed。差异见 `UPSTREAM.md`（zcode2 自己的偏离清单，不是 ycode 那份）。复核时又修了三处，见方案文档「2026-10-11 复核补记」。

**How to apply:** 新会话直接读 `docs/FRESH-BRANCH-FROM-MAIN-PLAN.md`（含执行清单、遥测删除清单、验收标准、可移植资产列表）与 `UPSTREAM.md`；从 ycode 搬护栏脚本与 memory，基线用 `--update` 重新生成。相关：[[ycode-opensource-audit]]、[[ycode-wiring-guardrails]]、[[local-machine-ipv6-blocked]]、[[nsis-makensis-encoding]]
