---
name: context-panel-output-speed
description: 上下文面板平均输出速度走 cacheHit aggregate 链；首 token 口径、分子分母同权、resume 后从零累计的三个设计决定
metadata:
  type: project
---

2026-10-12 在「上下文容量」面板的平均缓存命中率下方加了「平均输出速度 xx tok/s」（commit 45a475ea）。数据不走新通道，完全复用 `cacheHit` aggregate 的既有管道：CLI core `recordMainTurnCacheHitUsage` → `ModelComplete.cacheHit` → 桌面两处投影归一化（`zcodeSessionProjection.ts` + `zcodeTaskServiceAdapter.ts`，**两处是平行副本，改一处必须同步另一处**）→ store 相等性比较 → `contextUsage.tsx` 渲染。

**三个设计决定（改这块前先知道为什么）**：

1. **耗时口径是「首流式 token → 模型步完成」**，用现成的 `firstModelTokenAt()`（从 `ModelStreaming` 事件推首个非空 delta）而非整个请求时长，与 usage 观测的 `timeToFirstTokenMs`、debug 旁路的 `durationMs - timeToFirstContentMs` 同钟。别用 `Date.now() - modelStartedAt`——那会把首 token 延迟（网络/排队，与生成速度无关）算进去。
2. **分子分母同口径**：拿不到首 token 的请求（非流式/异常兜底）output 和耗时**都不**累计。曾考虑只跳过分母——那样无耗时请求的 token 会白进分子，平均速度被高估。
3. **resume 后速度从零累计**：持久化消息只有 token 数没有耗时，恢复路径 `mainTurnCacheHitAggregateFromMessages` 的速度计数器是 0（`hitRate` 却是全历史窗口）。面板显示的其实是「本次运行」口径，字段为 null 时整行隐藏。这是接受的妥协，不是 bug。

**顺带的坑**：`zcodeSessionContextCacheUsageSchema` 是 `.strict()`（v3 legacy 桥），加字段必须同步三处类型：contracts 的 `ModelCompletePayload.cacheHit`、shared 的 `ZCodeContextCacheUsage`、该 strict schema；UI 侧 `ChatContextUsage` 的 props 里还有一份内联 `cache?: {...}`。

**Why:** 输出速度看似 UI 小功能，实际横跨 CLI runtime、协议 schema、两处桌面投影和 store 去重；口径选错（整请求时长/只跳分母）会得出系统性偏慢或偏快的数字，比没有这行更糟。**How to apply:** 动 cacheHit aggregate、`ZCodeContextCacheUsage` 或 context 面板时按上面链路逐层核对；设计变更同步 `docs/context-cache-hit-rate.md` 的 Average Output Speed 节。相关：[[zcode2-ci-gate]]
