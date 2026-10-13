# 平均输出速度：暂存工具参数导致计时窗口塌缩 —— 设计与修复方案

> 状态：已按方案 A 实现。真实流量核对（7.2）仍待 GLM Anthropic model-io。
> 关联：`docs/context-cache-hit-rate.md` 的 *Average Output Speed* 一节、`memory/context-panel-output-speed.md`

## 1. 现象

GLM 通过 **Anthropic 接口**接入时，上下文面板的「平均输出速度」显示几千到上万 tok/s；
同一个模型走 **OpenAI Chat 接口**时显示几十 tok/s，与实际体感相符。

## 2. 已确认的根因

### 2.1 涉及的两条规则

| 位置 | 规则 |
| --- | --- |
| `core/src/runtime/methods/model-output-timing.ts` `createTimedModelStream` | 计时窗口 = core reader **读到**首个非空输出事件（`text_delta` / `reasoning_delta` / `tool_input_delta`）→ 读到 `finish`。分子取 `finish.usage.outputTokens`。 |
| `adapters/src/model/stream-retry-boundary.ts` + `runner-stream.ts` `applyStreamEventsToRetryBoundary` | 在第一个「提交边界」（非空 text/reasoning delta、`tool_call`、`finish` 等）之前，`tool_input_start/delta/end` 都属于可重试前奏，**先暂存在 `pendingRetrySafeEvents` 里，不 yield**，遇到边界才一次性放出。这样做是为了网络中断时能丢掉半截工具参数，再重放整个 HTTP 请求。 |

两条规则单独看都没问题，但组合起来以后：core 看到的「首输出时刻」其实是 adapter 的**放出时刻**，
不是 provider 的**生成时刻**。

### 2.2 时序

```text
provider SSE   delta₁ ──100ms── delta₂ ──100ms── delta₃ ──100ms── delta₄ ── tool_call ── finish
                 │                                                            │            │
adapter        [pendingRetrySafeEvents 暂存 ………………………………………………]   一次性 yield    yield
                                                                              │            │
core reader                                                       firstOutputAt        finishAt
                                                                              └── 几 ms ───┘
分子：outputTokens = 整段工具参数（可达上千 token）
分母：finishAt - firstOutputAt ≈ 几 ms         ⇒ 上千～上万 tok/s
```

### 2.3 复现证据

在 adapters 测试环境里构造了一个纯工具调用流，每个 chunk 间隔 100ms
（`start → tool-input-start → 4×tool-input-delta → tool-input-end → tool-call → finish`），
记录 adapter yield 每个事件的时刻：

```text
873 start
873 tool_input_start
873 tool_input_delta   ← 4 个 delta 在 provider 侧跨度 ≥ 300ms
873 tool_input_delta
873 tool_input_delta
873 tool_input_delta
873 tool_input_end
873 tool_call
984 finish
```

4 个 delta 在同一毫秒放出。core 测得的窗口约 111ms，真实窗口约 500ms 以上。真实网络下
`tool_call` 和 `finish` 往往只隔几毫秒，失真会更严重。（这个复现用的临时测试已经删除，
正式回归测试见第 6 节。）

### 2.4 为什么只有 Anthropic 接口明显受影响（推断，待真实流量佐证）

累计平均按 token 加权：`Σ outputTokens / Σ duration`。只要有少量「大 token、近零耗时」的样本，
就会把整体数值拉到上千。

- **OpenAI Chat**：GLM 返回 `reasoning_content`。adapter 把它判定为 `complete` 推理，
  非空 `reasoning_delta` 不属于前奏，会立即放出。于是绝大多数 step 从推理开始计时，
  后面跟着的工具参数虽然被暂存，起点已经是正确的；纯工具、无推理的 step 很少，被稀释掉了。
- **Anthropic**：仓库没有给 Anthropic provider 发送 `thinking` 参数，可能出现两种情况：
  1. GLM 不返回可见 thinking，于是纯工具 step 的首输出全部被暂存，直接命中 2.2 的问题；
  2. GLM 返回了 thinking，但只有 Claude 3.7 被认定为完整推理，其它模型的推理是 `unknown`，
     对应 step 被判为 `unaligned_reasoning` 后排除。剩下能进入统计的样本，主要就是失真的纯工具 step。

两种情况都会让失真样本占主导。具体是哪一种，需要用 model-io 抓一次 GLM Anthropic 流来确认
（见 7.2），但不影响本方案：本方案修的是 provider 无关的计时起点问题。

### 2.5 同源的次要影响

`runner-stream.ts` 的 `observeVisibleStreamEvent` 也在放出时刻记录 `model_first_content`
遥测里程碑，所以纯工具 step 的「首内容耗时」同样偏晚。这不在本次修复范围内，见 8.1。

## 3. 设计目标与约束

1. 计时起点必须是首个非空输出**到达 adapter 的时刻**，不能是放出时刻。
2. **不改变**重试边界语义：暂存/丢弃/放出顺序、HTTP 重放条件、工具回调、落库都保持不变。
3. 计时 owner 唯一：core `createTimedModelStream.result()` 仍然是可测性和耗时的唯一判定者。
   adapter 只提供「放出延迟」这一条事实，不自己计算速度，也不判定可测性。
4. 不进入 wire 协议、session history 或 UI，和现有的 `reasoningOutput` 一样只是 Model port 内部事实。
5. 不依赖跨层共享的绝对时钟：adapter 只给出**相对时长**，即使 Model port 将来跨进程也成立。
6. 每次 attempt 独立：失败重试时丢弃的前奏不能把上一次 attempt 的时间带进来。

## 4. 方案对比

| | A. 回填暂存延迟（推荐） | B. 标记不可测 |
| --- | --- | --- |
| 做法 | adapter 记录首个非空暂存输出从到达到放出的延迟，挂在 `finish` 上；core 把计时起点前移这段时长 | adapter 在 `finish` 上标注「首输出曾被暂存」；core 新增不可测原因并跳过该 step |
| 准确性 | 纯工具 step 也能正确计入 | 不会算错，但 Anthropic 路径的纯工具 step 全部不计入，样本偏向正文 step |
| 改动量 | contracts 1 个可选字段，adapter 一个小跟踪器，core 修正 1 处 | contracts 1 个可选字段，core 新增 1 个原因 |
| 风险 | 需要保证延迟只取「首个输出」且按 attempt 重置 | 几乎没有 |

**推荐 A。** B 可以作为评审不通过时的退路，两者的契约字段形状接近，日后切换成本低。

## 5. 方案 A 详细设计

### 5.1 所有者与事件顺序

```text
                 ┌──────────── adapter attempt（每次 attempt 新建跟踪器）────────────┐
provider chunk ─▶│ handleStreamChunk                                                │
                 │   ├─ 暂存? ── 是 ─▶ pending.push(ev)                             │
                 │   │               └─ 若 ev 是首个非空输出 && 尚未放出过输出:      │
                 │   │                    heldSince = performance.now()             │
                 │   └─ 放出 pending（边界到达）─▶ 若 heldSince 已记录且未结算:      │
                 │                                 deferredLeadMs = now - heldSince  │
                 │ finish ─▶ { ...finish, deferredOutputLeadMs }  (仅 >0 时附带)    │
                 └──────────────────────────────────────────────────────────────────┘
                                         │ yield（顺序不变）
                                         ▼
                 ┌──────────── core createTimedModelStream（唯一计时 owner）─────────┐
                 │ observe(首非空输出) → firstOutputAt                               │
                 │ observe(finish)     → finishAt, finish                           │
                 │ result():                                                        │
                 │   既有校验（missing_finish / reader_backpressure / usage / 推理） │
                 │   lead = finish.deferredOutputLeadMs ?? 0（非法 → invalid_duration）│
                 │   duration = finishAt - (firstOutputAt - lead)                   │
                 └──────────────────────────────────────────────────────────────────┘
```

为什么可以直接把 lead 加回去：暂存期间 core reader 一直在 `iterator.next()` 上等待 adapter，
没有 reader 背压（背压只发生在 core 缓冲满时，那种情况仍由 `readBlocked` 判为不可测）。
adapter 放出那一刻 core reader 立即读到，所以
`真实首输出时刻 ≈ core firstOutputAt − lead`，误差只有同步 yield 的微秒级开销。

### 5.2 契约变更（`contracts/src/model/index.ts`）

```ts
| {
    type: "finish";
    finishReason: string;
    reasoningOutput?: "complete" | "summary" | "hidden" | "unknown";
    /**
     * Adapter 为重试安全暂存首个非空输出（目前只有 tool_input_delta）的时长，单位毫秒，
     * 只用于把同口径计速的起点回填到 provider 真实到达时刻；不进入 session streaming/history。
     */
    deferredOutputLeadMs?: number;
    providerMetadata?: Record<string, unknown>;
    usage: ModelUsage;
  }
```

- 可选字段，没有暂存或延迟为 0 时**不附带**，保持现有 `toEqual` 快照测试不受影响。
- 同步内存流里暂存和放出只隔事件循环微任务（远小于 1ms）。不足 1ms 的间隙视为调度噪声，不回填，避免把事件循环开销写进 finish。
- 命名为 `...LeadMs`，表明这是相对时长，不是时间戳。

### 5.3 Adapter 改动（`adapters/src/model/`）

新建 `stream-deferred-output-timing.ts`，风格对齐 `stream-reasoning-provenance.ts`，每个 attempt 创建一次：

```ts
export function createDeferredOutputTiming() {
  let outputReleased = false; // 本 attempt 已有非空输出放出
  let heldSince: number | undefined;
  let leadMs: number | undefined;
  return {
    /** 事件被放入 pendingRetrySafeEvents 时调用。 */
    onHeld(event: ModelStreamEvent): void {
      if (outputReleased || heldSince !== undefined) return;
      if (hasOutputCharacters(event)) heldSince = performance.now();
    },
    /** 任一事件被 yield 给 core 前调用（含 pending 冲刷出的事件）。 */
    onReleased(event: ModelStreamEvent): void {
      if (outputReleased || !hasOutputCharacters(event)) return;
      outputReleased = true;
      if (heldSince !== undefined) leadMs = Math.max(0, performance.now() - heldSince);
    },
    finish(event: FinishEvent): FinishEvent {
      return leadMs && leadMs > 0 ? { ...event, deferredOutputLeadMs: leadMs } : event;
    },
  };
}
```

- `hasOutputCharacters` 的口径与 core `outputCharacters` 一致：非空的 `text_delta` /
  `reasoning_delta` 文本，或非空的 `tool_input_delta.delta`。空 delta（签名占位）不算输出。
- 接入点（`runner-stream.ts`）：
  1. `applyStreamEventsToRetryBoundary` 中 `pendingRetrySafeEvents.push(event)` 处调用 `onHeld`。
     这个函数是纯函数，跟踪器通过参数传入，或者由调用方比较 push 前后的 pending 长度来判断，
     具体实现时选侵入最小的一种。
  2. 所有 yield 给 core 的位置（主循环 `visibleEvents`、EOF `flushedEvents`、EOF
     `pendingRetrySafeEvents.splice(0)`、`directToolCommit` 异常路径）统一先调用 `onReleased`。
     建议把这几处收敛成一个本地 `release(event)` 辅助函数，避免漏接。
  3. `finish` 在已有的 `reasoningProvenance.finish(...)` 之后再套一层 `deferredTiming.finish(...)`。
- 跟踪器和 `pendingRetrySafeEvents` / `toolCallAssembler` 同在每次 attempt 循环体内创建，
  重试时自然重置（满足目标 6）。
- `preserveProviderStreamBoundaries === true`（compact 路径）时只有 `start` 被暂存，
  不会触发 `onHeld`，行为不变。
- 空 completion 暂存（`shouldHoldEmptyCompletionEvents`）会走重试路径，本 attempt 的跟踪器随之丢弃。

### 5.4 Core 改动（`core/src/runtime/methods/model-output-timing.ts`）

在 `result()` 计算 duration 的分支里：

```ts
else if (firstOutputAt === undefined) reason = "missing_output";
else {
  const lead = finish.deferredOutputLeadMs ?? 0;
  if (!Number.isFinite(lead) || lead < 0) {
    reason = "invalid_duration";
  } else {
    // 修复原因：adapter 为重试安全会暂存首段工具参数，reader 读到的是放出时刻；
    // 不回填暂存时长时，纯工具 step 窗口塌缩到 tool_call→finish 的几毫秒，速度虚高上千倍。
    const duration = finishAt - firstOutputAt + lead;
    if (Number.isFinite(duration) && duration > 0) return { outputGenerationDurationMs: duration };
    reason = "invalid_duration";
  }
}
```

- 不新增不可测原因，非法 lead 归入已有的 `invalid_duration`。
- `turn-model-step-usage.ts` 聚合层**不改**：它只消费 `outputGenerationDurationMs`，口径保持唯一。
- `RuntimeModelTextResult.outputGenerationDurationMs` 的注释补一句「起点含 adapter 暂存回填」。

### 5.5 Spec 与文档同步

- `docs/context-cache-hit-rate.md` *Average Output Speed* 第一条，把 “Both instants are captured
  before buffering …” 改成：首输出时刻以 provider 到达 adapter 为准；adapter 为重试安全暂存的
  前奏输出通过 `finish.deferredOutputLeadMs` 回填，core 仍是唯一计时 owner。
- `memory/context-panel-output-speed.md` 的设计决定 1 补充同样的说明，并记下这个坑：
  「暂存的 tool_input_delta 会让放出时刻冒充生成时刻」。

## 6. 测试计划（先写测试再实现）

### 6.1 Adapter（`adapters/tests/`，用 fake timer 或带间隔的 `slow` 流）

| 场景 | 期望 |
| --- | --- |
| 纯工具流：多个 `tool-input-delta` 间隔 100ms → `tool-call` → `finish` | `finish.deferredOutputLeadMs ≥ 300`（fake timer 下精确等于跨度）；事件顺序和内容与现有 “maps tool input stream chunks” 用例一致 |
| 正文先到：`text-delta` → 工具参数 → `finish` | 不带 `deferredOutputLeadMs` |
| 完整推理先到：`reasoning-delta` → 工具参数 | 不带 `deferredOutputLeadMs` |
| 只有空 delta / 签名占位被暂存 | 不带该字段 |
| 第一次 attempt 在暂存期间网络失败、第二次 attempt 是纯正文 | 第二次的 `finish` 不带该字段（不串 attempt） |
| `preserveProviderStreamBoundaries: true` | 不带该字段 |
| 现有 `toEqual` 快照用例 | 无回归（同步流里 lead 为 0，不附带字段） |

### 6.2 Core（`core/tests/turn-model-step-usage.test.ts` 或新建 `model-output-timing.test.ts`）

| 场景 | 期望 |
| --- | --- |
| 首输出到 finish 间隔 5ms，`deferredOutputLeadMs: 500`，`outputTokens: 50` | duration ≈ 505ms，速度约 99 tok/s，而不是 10000 |
| `deferredOutputLeadMs` 为负数或 NaN | `invalid_duration`，不计入 |
| `reader_backpressure` 和 lead 同时出现 | 仍是 `reader_backpressure`（既有判定优先） |
| 混合会话：一个正文 step + 一个带 lead 的纯工具 step | 累计速度落在两者真实速度之间 |

### 6.3 不需要 E2E

UI 渲染、协议和 schema 都不变，只有数值口径变化，不涉及交互改动。

## 7. 验证

### 7.1 静态与单测

```bash
pnpm typecheck
pnpm lint
pnpm --filter <adapters 包名> exec vitest run tests/runner.test.ts tests/stream-deferred-output-timing.test.ts
pnpm --filter <core 包名> exec vitest run tests/turn-model-step-usage.test.ts
```

（包名以 `apps/zcode-cli/packages/*/package.json` 为准。）

### 7.2 真实环境

1. 开启 model-io 记录，用 GLM + Anthropic 接口跑一个包含「写大文件」（大工具参数）的任务，
   确认面板速度回到几十 tok/s 的量级，并与 OpenAI Chat 接口同模型的结果对比。
2. 从 model-io 原始 SSE 确认 2.4 的两种可能里实际是哪一种（有没有 `thinking` content block），
   把结论回写到本文档和 memory。
3. 同时关注 debug 日志里的 `model.runtime.output_speed.unavailable` 分布，确认没有大量新增的
   `invalid_duration`。

## 8. 范围外 / 后续

1. **遥测首内容耗时同源偏差**：`model_first_content` 里程碑同样在放出时刻打点。可以复用同一个
   跟踪器，把 `contentMs` 改成到达时刻。这属于遥测口径变更，单独评审。
2. **GLM Anthropic thinking 不计速**：如果 7.2 证实 GLM 会返回完整 thinking，可以评估把它加入
   完整推理白名单。这需要 GLM 官方对 Anthropic 兼容 thinking 完整性的契约依据，
   不能只凭模型名推断（与现有设计决定一致）。
3. **隐藏推理 token 风险**：Anthropic usage 没有单独的 reasoning token 字段。如果某个兼容端点
   在内部推理却不下发 thinking block，`outputTokens` 里会混入窗口外生成的 token，导致速度偏高
   （量级远小于本 bug）。现有 `hidden` 判定依赖 `reasoningTokens > 0`，在这条路径上拿不到这个信号。
   需要 7.2 的数据确认是否存在。
