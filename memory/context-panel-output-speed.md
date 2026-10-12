---
name: context-panel-output-speed
description: 上下文面板平均输出速度走 cacheHit aggregate 链；首 token 口径、分子分母同权、resume 后从零累计的三个设计决定
metadata:
  type: project
---

2026-10-12 在「上下文容量」面板的平均缓存命中率下方加了「平均输出速度 xx tok/s」（commit 45a475ea）。数据不走新通道，完全复用 `cacheHit` aggregate 的既有管道：CLI core `recordMainTurnCacheHitUsage` → `ModelComplete.cacheHit` → 桌面两处投影归一化 → store 相等性比较 → `contextUsage.tsx` 渲染。

**2026-10-12 code review 后的修订**：两处投影的聚合解析已收敛到 `packages/shared/src/zcode-context-cache-usage.ts` 的 `parseContextCacheUsageAggregate`（原来 `zcodeSessionProjection.ts` + `zcodeTaskServiceAdapter.ts` 各内联一份，加字段要改两遍），**以后加聚合字段只改这一处**；最终计时移到模型流消费边界（不是事件落库/模型函数返回），采用单调时钟；可测条件要求 token 与完整可观测耗时同口径，推理 token 与背压阻塞请求保守跳过；单位 tok/s 走 i18n。

**三个设计决定（改这块前先知道为什么）**：

1. **耗时口径是「消费首个非空输出 delta → 消费 provider finish」**：`runModelTextRequest` 用 `performance.now()` 在入写队列前记录 text/reasoning/tool-input delta 与 finish，通过私有 `outputGenerationDurationMs` 交给主轮累计。不能再用 `firstModelTokenAt()` 的落库事件时刻或模型函数返回时刻：前者在写队列执行时才创建，后者已等完 terminal drain，两端都受 IO 影响。输出开始后发生写队列背压或 pre-finish tool drain 时，整条不计速，不能减掉等待时间（生成可能与等待重叠）。事件排序、drain 和背压语义不改。
2. **分子分母同口径，且两个方向都要挡**：只有首输出、finish、有限正耗时与正 `outputTokens` 同时可得才计入，否则 output 和耗时**都不**累计。`outputTokens` 包含推理 token；只要 provider 报告 `reasoningTokens > 0` 就保守不计速，因为即使有 `reasoning_delta` 也可能只是摘要，不能证明完整生成窗口。异常推理 token 元数据也不计速；不影响原始 usage/cacheHit 统计，也不把指标偷偷改成可见文本速度。跳过样本保留已有可测平均，没有样本时仍隐藏。
3. **resume 后速度从零累计**：持久化消息只有 token 数没有耗时，恢复路径 `mainTurnCacheHitAggregateFromMessages` 的速度计数器是 0（`hitRate` 却是全历史窗口）。面板显示的其实是「本次运行」口径，字段为 null 时整行隐藏。**也是累计平均而非滑动窗口**——越跑越钝，这是刻意的，不是 bug。

**面板行为上刻意的两处不对称**（别当成遗漏去「修」）：速度行**没有**生产阈值（命中率行低于 0.78 会隐藏，是为了不干扰「上下文容量」这个主信息；速度没有好坏阈值，有样本就显示）。

**顺带的坑**：`zcodeSessionContextCacheUsageSchema` 是 `.strict()`（v3 legacy 桥），加字段必须同步三处类型：contracts 的 `ModelCompletePayload.cacheHit`、shared 的 `ZCodeContextCacheUsage`、该 strict schema；UI 侧 `ChatContextUsage` 的 props 里还有一份内联 `cache?: {...}`。

**Why:** 输出速度看似 UI 小功能，实际横跨 CLI runtime、协议 schema、两处桌面投影和 store 去重；口径选错（整请求时长/只跳一侧）会得出系统性偏慢或偏快的数字，比没有这行更糟。**How to apply:** 动 cacheHit aggregate、`ZCodeContextCacheUsage` 或 context 面板时按上面链路逐层核对；设计变更同步 `docs/context-cache-hit-rate.md` 的 Average Output Speed 节。相关：[[zcode2-ci-gate]]
