# WebSearch Client Wrapper Tool

## 结论

`WebSearch` 是主模型可见的普通 client-side tool。模型调用 `WebSearch` 后，ZCode 按以下
顺序选择后端：

1. 配置了可用的 DeepSeek API Key：直接调用 DeepSeek Search REST API
   （`POST https://api.deepseek.com/v1/tools/search`），**不发起任何模型请求**。
2. 未配置 DeepSeek Key 且当前 Model 支持 provider-native search：在 tool handler 内部发起一个
   只包含 provider-native `web_search` 的 model request。
3. 两者都不满足：返回稳定的 ConfigurationError。

任一后端返回后，ZCode 把 links/sources 格式化为普通 tool result，回灌给主模型继续生成答案。

主模型请求不得直接暴露 provider-native `web_search`。

## DeepSeek REST 后端（2026-10-20）

### 动机

provider-native 搜索需要额外发起一次模型请求：既消耗 token，也只能在已确认支持服务端搜索的
Anthropic 兼容端点上使用。DeepSeek 的 Search 接口按请求计费（5 元 / 1000 次成功请求，
无结果与失败不计费），零模型 token，且对任意模型可用。

### 可用性判定

可用性**每次调用现算**，不缓存：

```text
ProviderRegistry.getView().providers
  → 找 config.api.baseUrl 的 host === "api.deepseek.com"
     且 access.type === "api-key" 且 access.apiKey 非空
  → 命中即可用；否则不可用
```

- 内置 DeepSeek 模板本身不含 Key，必须由用户配置 overlay 提供。
- 用户中途增删 Key，下一个 tool call 即生效。
- 不新增配置项，也不新增环境变量；「有没有 Key」就是开关。

### 端点与请求

- origin 由 `new URL(baseUrl).origin` 推导：`https://api.deepseek.com/anthropic`
  → `https://api.deepseek.com`。
- `POST {origin}/v1/tools/search`，`Authorization: Bearer <Key>`，
  `Content-Type: application/json`。
- 请求体：`{ query, count: 10 }`。本期不传 `need_content`
  （`summary` 已有 600–800 字，开启正文会显著抬升上下文占用），不传 `ori_question`、
  `localization`。
- 网络请求必须走 `HttpClientPort`，复用代理、`noProxy`、自定义 CA 与 trace header。
- Key 只存在于内存闭包与请求头；日志、事件、错误消息不得包含 Key。

### 参数映射

| public 字段 | DeepSeek 请求 |
| --- | --- |
| `query` | `query`；`allowed_domains` 追加 `site:a OR site:b`，`blocked_domains` 追加 `-site:x` |
| `allowed_domains` | 追加搜索语法 **并且** 对返回结果按 hostname 后置过滤 |
| `blocked_domains` | 追加搜索语法 **并且** 对返回结果按 hostname 后置过滤 |
| `maxUses` | REST 单次请求，本后端忽略；公共 schema 不变 |

`site:` 只是搜索语法建议，服务端不保证过滤，因此后置过滤是契约的一部分。
过滤后结果为空时返回清晰的空结果提示，不作为错误。

### 结果与模型可见内容

- 结构化输出复用 `WebSearchOutput`，字段与 strict schema **不变**：
  `results` 仍只有 `{title, url}`，`sources` 仍为 `{title, url}`。
- DeepSeek 的 `snippet` / `summary` / `date` / `authority` / `site_name` 只进入模型可见文本，
  不写入结构化 output——`executor/validation.ts` 会拒绝 output 中 schema 未声明的字段。
- 模型可见文本形态：

```text
Web search results for query: "<query>"

1. <title> — <date>（authority 3）
   <url>
   <summary>

...

REMINDER: 引用来源时必须使用 markdown 链接。
```

- 结果预算沿用 `WebSearchOutput` 的 `resultBudget`（inline 10 KB / model 20 KB）。
  默认 `count: 10`、每条 summary 600–800 字符时约 6–8 KB，不会突破预算。

### 限流与失败

- 账号级 QPS 为 5（Search 与 Fetch 各自独立）。adapter 内使用进程内令牌桶；
  仓库内没有可复用的令牌桶实现（`WorkflowLimiter` 只做并发，`bash-gh-rate-limit` 是冷却）。
- **429 是正常 HTTP 响应**，不是 `HttpClientPortError`；退避 200 ms 后重试一次，
  仍失败返回 `rate_limited`。
- 402 → `insufficient_balance`，403 → `blocked_by_policy`，404 → `not_found`，
  408/504/5xx → `timeout` / `upstream_error`。
- 失败后**不静默回退** provider-native 路径，避免同一 query 被搜索两次。

### 暴露门

`WebSearch` 对模型可见的条件扩展为：

```text
model.properties.supportsNativeWebSearch === true
  或  DeepSeek 后端当前可用
```

- 无 Model 的调用（注册表枚举）仍返回 true。
- handler 内保留第二道校验：既无后端也无 native 能力时返回原 ConfigurationError。
- 可用性判定必须动态；不得在 runtime 构造时冻结成布尔值，否则用户删除 Key 后
  工具面不会回落。

## 设计目标

1. 主 loop 的 provider-visible tool name 是 `WebSearch`，执行模式是 `client`。
2. `WebSearch` 必须进入 `ToolExecutor`、permission、scheduler、hooks、事件、
   resultBudget、tool result history 和 replay 生命周期。
3. provider-native `web_search` 只允许出现在 `WebSearch` handler 发起的内部
   side request 中，并由 adapter 投影成 provider SDK helper。
4. public input schema 保持核心字段：`query`、`allowed_domains`、
   `blocked_domains`；同时保留当前 Anthropic provider-native `web_search`
   实际消费的 `maxUses` 可选调参字段。`searchContextSize`、`numResults`、
   `safeSearch` 不对主模型可见。
5. 支持 provider-native web search 的 model，或 DeepSeek REST 后端可用时，才向主模型
   暴露 `WebSearch`；两者都不可用时隐藏。运行时无法解析 provider capability 且无
   DeepSeek 后端时同样隐藏。
6. handler 输出必须提取 sources/results/usage，并用普通 tool result 提醒主模型在最终答案中
   使用 markdown links 引用来源。DeepSeek 后端没有 provider usage，`modelUsage` 与
   `webSearchRequests` 缺席。

## Public Tool Contract

主模型看到的 contract：

| 字段 | 值 |
| --- | --- |
| `name` | `WebSearch` |
| `capability` | `web_search` |
| `executionMode` | `client` |
| `providerNative` | 不存在 |
| `readOnly` | `true` |
| `concurrentSafe` | `true` |
| `sideEffectScope` | `network` |
| `needsApproval` | `false` |

public input:

| 字段 | 说明 |
| --- | --- |
| `query` | 要搜索的自然语言 query |
| `allowed_domains` | 可选，只允许这些 domain 的结果 |
| `blocked_domains` | 可选，排除这些 domain 的结果 |
| `maxUses` | 可选，内部 provider-native 搜索次数上限，默认 `8` |

`allowed_domains` 和 `blocked_domains` 不能同时传入。domain 只接受 hostname，不接受
protocol、path 或 wildcard。

## Internal Provider-Native Request

`WebSearch` handler 负责把 public input 转成内部 provider-native args：

| public 字段 | 内部 provider-native args |
| --- | --- |
| `allowed_domains` | `allowedDomains` |
| `blocked_domains` | `blockedDomains` |
| `maxUses` | `maxUses`，未传时默认 `8` |

内部 request 固定：

- system message: `You are an assistant for performing a web search tool use.`
- user message: `Perform a web search for the query: <query>`
- tools: 只包含 `web_search`
- toolChoice: 不设置。BigModel 的 Anthropic 兼容端点会拒绝 named forced
  `web_search` tool choice（1210）；当前依靠单工具请求和 prompt 触发 provider-native 搜索。
- metadata.querySource: `web_search_tool`

## Provider 映射

core 不 import `@ai-sdk/anthropic` 或 `@ai-sdk/openai`。adapter 是唯一把
provider-native contract 转成 SDK provider tool 的地方。

### Anthropic-compatible

内部 `web_search` 使用 `anthropic.tools.webSearch_20260209()`，并由 AI SDK 在内部
请求中生成：

```json
{
  "type": "web_search_20260209",
  "name": "web_search"
}
```

支持条件：

- provider kind 是 `anthropic`。
- resolved baseURL host 是 `bigmodel.cn`、`z.ai`、`deepseek.com` 或其子域。
- 未命中 allowlist 的 Anthropic-compatible provider 不投影 provider-native search。

### OpenAI

当前不投影 `openai.web_search`，即使 baseURL host 命中 WebSearch allowlist 也不暴露
`WebSearch`。WebSearch gate 必须同时满足 `providerKind === "anthropic"` 和 baseURL
host allowlist。

### 其他 Provider

`openai-compatible`、`gateway`、`custom` 当前不投影 WebSearch provider-native tool。
不要把它降级为普通 function tool，也不要恢复旧 BigModel Web Search REST API 或
DuckDuckGo HTML fallback。

## 注册、权限与执行

- `WebSearch` 注册进 `builtInTools`，默认主 agent 和 Explore agent 都可以按各自
  tool pool/allowlist 暴露它。
- `web_search` 仅作为 legacy allowlist alias 映射到 `WebSearch`；不得出现在主请求
  `tools[].name`。
- 可见性 gate 优先在 runtime projection 过滤 `WebSearch`：Model 支持 native，或
  DeepSeek REST 后端当前可用；handler 是第二道防线。
- provider-native capability 仍由 provider kind 和 resolved baseURL 共同决定；只有
  `anthropic` 且 baseURL host 是 `bigmodel.cn`、`z.ai`、`deepseek.com` 或其子域时
  才走 native 路径。
- `WebSearch` 进入本地 `ToolExecutor` 并触发普通 tool lifecycle：
  `ToolCallScheduled`、`ToolCallStarted`、`ToolCallResult`、permission、hook、
  scheduler、resultBudget 和 session history。
- 内部 provider-native request 的 network status 通过 tool context 继续转发为
  `ModelNetworkStatus` 事件；DeepSeek REST 请求同样必须发出网络状态事件，
  `url` 记录真实出网点。
- 权限声明不变：只读、`sideEffectScope: network`、`needsApproval: false`。

## 依赖注入

DeepSeek 后端以窄端口 `WebToolsPort` 注入，与 `HttpClientPort` 同一层：

```text
bootstrap/create-app.ts  ── 构造 ──▶ DeepSeekWebToolsAdapter
  resolveCredential():                  credentials.resolve()
    providerRegistry.getView()            （每次现问，不缓存）
    → host = api.deepseek.com
    → access.apiKey 非空
                    │
                    ▼
      AgentRuntimeDeps.webToolsPort
                    │
      runtime-tools / subagent / workflow child
                    │
      tool/executor → ToolExecutionContext.webToolsPort
                    │
      webSearchHandler / webFetchHandler
```

分层约束：

- adapter 只接收 `{ credentials: { resolve() }, httpClientPort }`，不 import bootstrap，
  也不 import `@zcode/provider` 的具体类型。
- `@zcode/contracts` 只声明端口接口，不依赖 provider 包。
- 子代理、动态工作流 actor、脚本工作流子运行时、project-memory agent 必须继承同一个端口，
  全部位置与既有 `httpClientPort` 相邻。

## 删除与迁移

删除或不恢复：

- 主请求直接追加 provider-native `web_search` contract。
- 旧 BigModel Web Search adapter tool。
- DuckDuckGo HTML fallback。
- `searchContextSize` / `numResults` / `safeSearch` 字段。
- public schema 中的 `allowedDomains`、`blockedDomains` legacy camelCase domain
  字段。

DeepSeek REST 后端不是「恢复旧 BigModel REST API」：旧实现是另一家服务且已被删除；
新后端是可配置的独立端口，只在用户配置了 DeepSeek Key 时启用，未配置时行为与删除前一致。

保留：

- `WEBSEARCH_PROVIDER_NATIVE_SPEC` 作为内部 request adapter 映射依据。
- `packages/adapters/src/model/tool-transform.ts` 中的 provider-native helper 映射。
- `ModelUsage.serverToolUse.webSearchRequests` 汇总 provider usage，并作为 nested usage
  计入主 turn。

## 测试要求

Core：

- public JSON Schema 暴露 `query`、`allowed_domains`、`blocked_domains`、
  `maxUses`，但不暴露 `allowedDomains`、`blockedDomains`、`searchContextSize`、
  `numResults` 或 `safeSearch`。
- `registerBuiltInTools()` 注册 `WebSearch`，不注册 `web_search`。
- 主 runtime 和 Explore child request 的 `tools[]` 包含 `WebSearch`，不包含
  `web_search`。
- `toolAllowlist: ["web_search"]` 能作为兼容 alias 暴露 `WebSearch`。
- handler 发起的内部 request 只包含 provider-native `web_search`，不设置
  `toolChoice`。
- `WebSearch` 作为只读并发安全 tool 进入 permission、scheduler 和 lifecycle event。

DeepSeek 后端（新增）：

- 配置了可用的 DeepSeek Key 时，handler **不发起任何模型请求**
  （断言模型 `generateText` / `streamText` 未被调用）。
- 可用性每次现读：删除 Key 后下一个 tool call 回到 native/隐藏路径。
- `allowed_domains` / `blocked_domains` 既要改写成搜索语法，也要对返回结果后置过滤；
  过滤后为空时返回空结果提示而非错误。
- 结构化 output 不得出现 strict schema 未声明的字段。
- 429 走一次退避重试；仍失败返回 `rate_limited`，且不静默回退 native。
- 请求必须经 `HttpClientPort`，并发出网络状态事件。
- Key 不出现在日志、事件与错误消息中。

Adapters：

- 只有内部 provider-native `web_search` contract 会被映射为
  `anthropic.web_search_20260209`。
- 只有 Anthropic provider kind 且 baseURL host 命中 `bigmodel.cn`、`z.ai`、
  `deepseek.com` allowlist 时投影；官方 OpenAI、MiniMax、任意自定义/网关 provider
  不暴露 WebSearch。
- public client-side `WebSearch` 保持普通 function tool。

Trajectory：

- 主请求 request body 只出现 `WebSearch`。
- 内部 `metadata.querySource === "web_search_tool"` 的 request body 只出现 `web_search`。
- 当前 prompt-trajectory mock proxy 会影响 runtime provider capability 注入；后续若要恢复
  WebSearch trajectory testcase，需要让 harness 显式提供 allowlisted Anthropic baseURL。

回归：

- `CI=true pnpm typecheck`
- `CI=true pnpm lint`
- focused core/adapters vitest
- prompt-trajectory P-12 testcase；WebSearch testcase 需要先补 harness capability baseURL

## 剩余风险

- 当前先不实现 streaming progress；内部 request 使用 `generateText`，只保证
  request shape、tool lifecycle 和 tool result 符合本文契约。
- 不同 provider 对 citations、sources、providerExecuted tool result 的暴露不完全一致；
  handler 需要同时兼容 provider `sources`、typed tool result output 和 source-like
  result payload。
- DeepSeek Search 的账号级 QPS 为 5，并行子代理可能触发 429；当前只有令牌桶 +
  单次退避，未做跨进程串行化。
- `need_content` 未开启；若后续开启，计费不变但单次结果会显著增加上下文占用。
- 搜索词与 `site:` 语法会发送到 `api.deepseek.com`，这是启用该后端后的既有语义。
