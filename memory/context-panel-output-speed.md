---
name: context-panel-output-speed
description: 上下文面板平均输出速度走 cacheHit aggregate 链；首 token 口径、分子分母同权、resume 后从零累计的三个设计决定
metadata:
  type: project
---

2026-10-12 在「上下文容量」面板的平均缓存命中率下方加了「平均输出速度 xx tok/s」（commit 45a475ea）。数据不走新通道，完全复用 `cacheHit` aggregate 的既有管道：CLI core `recordMainTurnCacheHitUsage` → `ModelComplete.cacheHit` → 桌面两处投影归一化 → store 相等性比较 → `contextUsage.tsx` 渲染。

**2026-10-12 code review 后的修订**：两处投影的聚合解析已收敛到 `packages/shared/src/zcode-context-cache-usage.ts` 的 `parseContextCacheUsageAggregate`（原来 `zcodeSessionProjection.ts` + `zcodeTaskServiceAdapter.ts` 各内联一份，加字段要改两遍），**以后加聚合字段只改这一处**；耗时时刻改在 `runModelTextRequest` 返回处取（不再等两个 part 落库之后）；可测条件收紧为「首 token 与 outputTokens 同时可得」；单位 tok/s 走 i18n。

**三个设计决定（改这块前先知道为什么）**：

1. **耗时口径是「首流式 token → 模型步完成」**，用现成的 `firstModelTokenAt()`（从 `ModelStreaming` 事件推首个非空 delta）而非整个请求时长，与 usage 观测的 `timeToFirstTokenMs`、debug 旁路的 `durationMs - timeToFirstContentMs` 同钟。别用 `Date.now() - modelStartedAt`——那会把首 token 延迟（网络/排队，与生成速度无关）算进去。**完成时刻必须在 `runModelTextRequest` 返回处立刻取**（`modelCompletedAtMs`）：放到两个 `persistPart` 落库 await 之后再取 `Date.now()`，写盘延迟会进分母，短响应上能压低近 10%。
2. **分子分母同口径，且两个方向都要挡**：只有首 token 可得**且** `outputTokens` 有值才计入，否则 output 和耗时**都不**累计。只跳分母 → 无耗时请求的 token 白进分子，速度被高估；只跳分子 → provider 没回报 usage 时耗时白进分母，速度被低估。非流式/异常兜底命中前者，provider 不报 usage 命中后者。
3. **resume 后速度从零累计**：持久化消息只有 token 数没有耗时，恢复路径 `mainTurnCacheHitAggregateFromMessages` 的速度计数器是 0（`hitRate` 却是全历史窗口）。面板显示的其实是「本次运行」口径，字段为 null 时整行隐藏。**也是累计平均而非滑动窗口**——越跑越钝，这是刻意的，不是 bug。

**面板行为上刻意的两处不对称**（别当成遗漏去「修」）：速度行**没有**生产阈值（命中率行低于 0.78 会隐藏，是为了不干扰「上下文容量」这个主信息；速度没有好坏阈值，有样本就显示）。

**顺带的坑**：`zcodeSessionContextCacheUsageSchema` 是 `.strict()`（v3 legacy 桥），加字段必须同步三处类型：contracts 的 `ModelCompletePayload.cacheHit`、shared 的 `ZCodeContextCacheUsage`、该 strict schema；UI 侧 `ChatContextUsage` 的 props 里还有一份内联 `cache?: {...}`。

**Why:** 输出速度看似 UI 小功能，实际横跨 CLI runtime、协议 schema、两处桌面投影和 store 去重；口径选错（整请求时长/只跳一侧）会得出系统性偏慢或偏快的数字，比没有这行更糟。**How to apply:** 动 cacheHit aggregate、`ZCodeContextCacheUsage` 或 context 面板时按上面链路逐层核对；设计变更同步 `docs/context-cache-hit-rate.md` 的 Average Output Speed 节。相关：[[zcode2-ci-gate]]
