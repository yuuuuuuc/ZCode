# Reasoning Output Provenance（推理输出完整性判定）

Status: L1 Implemented

## 文档定位

本文是 `packages/adapters/src/model/stream-reasoning-provenance.ts` 的行为契约。

它回答一个问题：**provider 返回的可见推理流，是否等于模型真正生成的完整推理？**

这个问题只服务一个下游用途——上下文面板的「平均输出速度」口径对齐
（见 [`docs/context-cache-hit-rate.md`](../../../../../../docs/context-cache-hit-rate.md) 的
*Average Output Speed* 与
[`docs/output-speed-deferred-tool-input-timing.md`](../../../../../../docs/output-speed-deferred-tool-input-timing.md)）。

它**不是**模型能力，不参与能力解析，不影响请求参数。

## 为什么需要这个判定

计速口径是 `Σ outputTokens / Σ 生成耗时`，其中

- 分子取 provider usage 的 `outputTokens`，Anthropic / OpenAI 都把推理 token 计入其中；
- 分母取「首个非空输出到达 adapter → 读到 finish」。

只有当**可见推理流覆盖了全部推理 token 的生成过程**时，分子和分母才描述同一段区间。
如果模型在内部推理却不下发、或只下发摘要，分母起点会晚于真实生成起点，速度虚高。

因此 adapter 必须把「这条推理流的来源」作为事实交给 core，
由 core 决定这个 step 能不能计入（判定 owner 是
`core/src/runtime/methods/model-output-timing.ts` 的 `result()`，adapter 不自己算速度）。

## 事实模型

`finish` 事件上可选携带 `reasoningOutput`，四个取值：

| 值 | 含义 | core 的处理 |
| --- | --- | --- |
| `complete` | 可见推理流就是完整推理 | 计入 |
| `summary` | 可见推理是摘要（token 数多于可见文本） | `unaligned_reasoning`，不计入 |
| `hidden` | 有推理 token 但完全没有可见推理流 | `unaligned_reasoning`，不计入 |
| `unknown` | 有可见推理，但完整性无法确认 | `unaligned_reasoning`，不计入 |

字段不出现表示「本 step 没有可见推理」，按普通正文 step 处理。
判定失败只会退化成 `unknown`（该 step 不计入），**不会算出偏快的数字**。

## 判定规则

`providerKind` 由 provider 的 `api.type` 推导（`anthropic-messages` → `anthropic`，
`openai-responses` → `openai`，`openai-chat-completions` → `openai-compatible`），
见 `packages/adapters/src/model/model-execution.ts:toAiSdkProviderConfig`。

```text
redacted_thinking / redactedData 出现
      └─▶ hidden

没有可见推理 delta，但 reasoningTokens > 0
      └─▶ hidden

没有可见推理 delta，但 raw 流里出现过推理字段
      └─▶ unknown

有可见推理 delta
      ├─ providerKind = openai        ─▶ summary
      ├─ providerKind = openai-compatible
      │      且 raw reasoning_content 与全部推理 delta 逐字匹配
      │      且从未落到泛化 reasoning 字段   ─▶ complete
      ├─ providerKind = anthropic 且命中完整原生 thinking 白名单 ─▶ complete
      └─ 其他                          ─▶ unknown
```

`openai-compatible` 分支是**流内证据**判定：把 provider 原始 `reasoning_content`
与 SDK 归一化后的推理流逐字比对，前缀全部消费完才算完整。
泛化 `reasoning` 字段（来源不可辨）一律不算证据。

## 完整原生 thinking 白名单

Anthropic 的 SSE 流里没有「这是摘要」的标记——摘要和完整推理都是
`content_block_delta.delta.type === "thinking_delta"`。
所以 `anthropic` 传输上只能按**后端契约**声明哪些模型返回完整推理，
不能用流内证据判定。

| 条目 | 依据 |
| --- | --- |
| `claude-3-7-sonnet`（含 `-20250219` / `-latest`） | Anthropic 文档保证 3.7 Sonnet 的 thinking 原样返回。Claude 4+ 可能是摘要，不能类推。 |
| GLM 系列（`glm-` 前缀，忽略大小写，取 id 最后一段） | 智谱 GLM 的 Anthropic-compatible 端点返回完整推理。见下节核对记录。 |

GLM 条目与 OpenAI-compatible 分支是**同一个后端事实的两种投影**：
GLM 的 OpenAI-compatible 路径已经能靠逐字比对证明推理完整，
Anthropic-compatible 路径只是同一后端换一种 SSE 投影，
所以在传输层声明它的完整性。

### GLM 条目的核对记录与证伪条件

**依据（2026-10-13）**：GLM 在 Anthropic 接口返回的是完整推理，
不是摘要，也不是隐藏推理。

**证伪条件**（任一条成立就要把对应模型移出白名单，退回 `unknown`）：

1. model-io 抓到的原始 SSE 中，`usage.output_tokens` 明显大于可见
   `thinking_delta` 文本量级，且差异不能由文本/工具参数解释；
2. 同一次请求里出现 `redacted_thinking` 或 `redactedData`（已由 `hidden` 分支兜住，
   但说明后端会隐藏推理）；
3. 关闭/调低思考档位后，`output_tokens` 不变而可见推理消失。

**待补**：把一次 GLM + Anthropic 的真实 model-io 抓包结论按上面三条逐条留痕到本节。
在此之前，GLM 条目的证据强度低于 Claude 3.7 条目。

## 边界与约束

- 该判定**不进入** wire 协议、session streaming/history、`ModelProperties`、
  Effective Model Config 或 UI，只存在于 Model port 内部（`finish.reasoningOutput`）。
- 白名单**不得**影响请求参数、思考档位、工具 schema 或任何出站字段。
- 判定不得依赖「猜测」：没有依据的来源一律 `unknown`。
- 单条流内的证据上限 `MAX_RAW_REASONING_CHARACTERS = 512 * 1024`，
  超限即放弃升级为 `complete`，避免长流无界累积。
- 与 Provider Refactor 的关系：`model-capability-resolution.md` 禁止在生产代码里
  **按 modelId 推断模型能力/请求参数**。本白名单不产出能力、不产出请求参数，
  只描述响应流的完整性，因此不在该禁令范围内；但它是同一类「按 id 判断后端行为」的
  写法，一旦 Provider Config 侧出现声明 provider 兼容能力的规则位，
  应迁移过去（见 [anthropic-stream-compat.md](anthropic-stream-compat.md) 的
  provider capability contract 要求）。

## 测试矩阵

`packages/adapters/tests/stream-reasoning-provenance.test.ts`：

| 场景 | 期望 |
| --- | --- |
| openai-compatible：raw `reasoning_content` 与推理 delta 逐字匹配且全部消费 | `complete` |
| openai-compatible：缺 raw / 落到泛化 `reasoning` / 文本不匹配 / 混入泛化字段 / 有未消费残留 / 超出证据上限 | `unknown` |
| openai：有可见推理 | `summary` |
| anthropic：`claude-3-7-sonnet` 三个 id 变体 | `complete` |
| anthropic：GLM 系列 id（大小写、provider 前缀、日期别名、`[1m]` 变体） | `complete` |
| anthropic：白名单外模型（`claude-sonnet-4-5`、`claude-3-7-sonnet-custom`、非 GLM 的第三方 id） | `unknown` |
| anthropic：白名单模型但有 redaction（raw 或 metadata 两条来源） | `hidden` |
| anthropic：白名单模型，raw 有推理但可见流没有 | `unknown` |
| 任意 provider：有推理 token 但没有可见推理 | `hidden` |
| 任意 provider：没有推理，只有正文 | 不携带该字段 |
| 真实 SDK wire：`reasoning_content` 字段端到端 | `complete` |

## 相关文档

- [`docs/context-cache-hit-rate.md`](../../../../../../docs/context-cache-hit-rate.md) — Average Output Speed 口径
- [`docs/output-speed-deferred-tool-input-timing.md`](../../../../../../docs/output-speed-deferred-tool-input-timing.md) — 暂存工具参数的计时回填
- [`anthropic-stream-compat.md`](anthropic-stream-compat.md) — Anthropic provider fetch 边界的兼容层
