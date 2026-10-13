---
name: context-panel-output-speed
description: 上下文面板平均输出速度走 cacheHit aggregate 链；首 token 口径、分子分母同权、resume 后从零累计的三个设计决定
metadata:
  type: project
---

2026-10-12 在「上下文容量」面板的平均缓存命中率下方加了「平均输出速度 xx tok/s」（commit 45a475ea）。数据不走新通道，完全复用 `cacheHit` aggregate 的既有管道：CLI core `recordMainTurnCacheHitUsage` → `ModelComplete.cacheHit` → 桌面两处投影归一化 → store 相等性比较 → `contextUsage.tsx` 渲染。

**2026-10-12 code review 后的修订**：两处投影的聚合解析已收敛到 shared 的 `parseContextCacheUsageAggregate`，以后加聚合字段只改这一处。计时由有界模型流 reader 在写事件前采样，采用单调时钟；推理、正文和工具参数都是输出，完整推理参与统计。摘要、隐藏/未知推理或 reader 真正背压时明确不可测，不再按 reasoningTokens > 0 或 tool drain 一刀切排除。单位 tok/s 走 i18n。

**三个设计决定（改这块前先知道为什么）**：

1. **耗时口径是「首个非空输出到达 adapter → reader 读取 provider finish」**：有界 reader 与业务消费/落库分离，正常工具 drain 和写背压不再污染采样；仅 reader 缓冲真正满而停止读取时不可测。事件顺序、工具回调、落库语义不变，异常跟随已读事件，取消关闭 reader。不能用落库时间、请求起点或减去 IO 等待反推耗时。起点以 provider 到达 adapter 为准；adapter 为重试安全暂存的前奏通过 `finish.deferredOutputLeadMs` 回填，core 仍是唯一计时 owner。坑：暂存的 tool_input_delta 会让放出时刻冒充生成时刻。
2. **分子分母同口径，且两个方向都要挡**：首输出、finish、有限正耗时与正 `outputTokens` 同时可得才成对累计。Adapter 在 finish 标记 reasoning provenance：compatible 原始 reasoning_content 与所有推理 delta 匹配、Claude 3.7 native thinking 可认定完整；Responses 摘要、Anthropic redaction、其他未知来源不可测。完整推理包含在 outputTokens 中且不重复相加；不能仅凭 reasoning_delta 或模型名称猜测完整性。异常 token 元数据仍跳过，原始 usage/cacheHit 不变；没有样本时返回 null，不造零值。
3. **resume 后速度从零累计**：持久化消息只有 token 数没有耗时，恢复路径 `mainTurnCacheHitAggregateFromMessages` 的速度计数器是 0（`hitRate` 却是全历史窗口）。面板显示的其实是「本次运行」口径，字段为 null 时整行隐藏。**也是累计平均而非滑动窗口**——越跑越钝，这是刻意的，不是 bug。

**面板行为上刻意的两处不对称**（别当成遗漏去「修」）：速度行**没有**生产阈值（命中率行低于 0.78 会隐藏，是为了不干扰「上下文容量」这个主信息；速度没有好坏阈值，有样本就显示）。

**顺带的坑**：`zcodeSessionContextCacheUsageSchema` 是 `.strict()`（v3 legacy 桥），加字段必须同步三处类型：contracts 的 `ModelCompletePayload.cacheHit`、shared 的 `ZCodeContextCacheUsage`、该 strict schema；UI 侧 `ChatContextUsage` 的 props 里还有一份内联 `cache?: {...}`。

**Why:** 输出速度看似 UI 小功能，实际横跨 CLI runtime、协议 schema、两处桌面投影和 store 去重；口径选错（整请求时长/只跳一侧）会得出系统性偏慢或偏快的数字，比没有这行更糟。**How to apply:** 动 cacheHit aggregate、`ZCodeContextCacheUsage` 或 context 面板时按上面链路逐层核对；设计变更同步 `docs/context-cache-hit-rate.md` 的 Average Output Speed 节。相关：[[zcode2-ci-gate]]
