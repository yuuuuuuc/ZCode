# Provider runtime headers 的 api-key 时代行为

## 背景

上游通过「每轮模型请求前刷新 provider runtime headers」为账号型供应商（Start Plan /
Coding Plan）注入请求期凭据：CLI 端口在每个物理 attempt 前调用 Host 的
`interaction/requestProviderRuntimeHeaders`，Host 解析账号凭据后回传 `requestAuth`，
adapter 用它重建本次请求的鉴权。

Ycode 裁掉了官方账号体系（`packages/shared/src/ycode-features.ts`
`officialAccountCredentials: false`）：Host 不再有凭据解析服务，
`respondProviderRuntimeHeaders` 与 UI 监听器均为 no-op。但 CLI 端口的
`shouldRefreshBeforeModelRequest` 仍无条件返回 true，导致每次模型请求都会发起
RPC、拿到 Host 的固定失败应答，所有供应商（包括 api-key 型）在请求发出前就被
`Provider request auth is unavailable` 阻断（2026-10-10 修复，3.15.4）。

## 产品规则

1. Ycode 的模型接入方式是 **Settings → API Key**，静态 Key 由 Host 保存并在会话
   建立时随 provider 配置注入 CLI provider Registry；不存在请求期动态凭据。
2. runtime headers 刷新链是否启用，由 `YCODE_VENDOR_SERVICES.officialAccountCredentials`
   单一开关决定。当前为 false：CLI 端口 `shouldRefreshBeforeModelRequest` 返回
   false，所有模型请求（turn / 标题 / compact / 子 agent / websearch 等）都不再
   挂载 `refreshRuntimeHeadersBeforeAttempt`，直接用 Registry 静态配置发请求。
3. Host 对 `interaction/requestProviderRuntimeHeaders` 的兜底应答从
   `headersApplied: false`（fail-closed）改为 `headersApplied: true, requestAuth: {}`：
   误调用方（旧版本 CLI、旁路端口）不再被阻断；adapter 侧空 `requestAuth` 不会
   覆盖静态 apiKey（`applyModelRequestAuth` 仅在 `requestAuth.apiKey` 非空时覆盖，
   ycode 版 `withoutRequestVerificationHeaders` 为透传），缺 Key 时由上游返回
   真实的 401 / `model_request_auth_missing` 错误。

## 状态所有者与事件顺序

```text
api-key 时代（officialAccountCredentials === false）：
Host Settings（静态 Key 唯一写入路径）
  → 会话建立：provider 配置（含 apiKey）注入 CLI Registry
  → 模型请求：adapter bindModel 冻结快照 → 静态鉴权直发上游
  （runtime headers RPC 不发生；Host 若被误调，成功空应用即回）

账号体系若重新启用（officialAccountCredentials === true）：
CLI 端口 shouldRefresh → true → 每 attempt RPC → Host 凭据权威应答
  → requestAuth 覆盖本次请求鉴权（上游既有语义恢复）
```

## 验收场景

- Settings 保存过 API Key 的供应商（builtin DeepSeek / 自定义 OpenAI-compatible）
  发消息，不出现 `Provider request auth is unavailable`；请求携带静态 Key 直达上游。
- 未填 Key 的供应商得到真实上游错误（401 或 `model_request_auth_missing`），
  而非固定失败文案。
- Host 单测：`interaction/requestProviderRuntimeHeaders` 应答为
  `{ headersApplied: true, requestAuth: {} }` 且通过协议 schema 校验。
- CLI 单测：真实端口 `shouldRefreshBeforeModelRequest` 对任意 provider 返回 false。

## 关联文档

- `docs/agent-subagent-provider-runtime-headers-routing.md`：子 agent 会话路由语义
  （账号时代设计；api-key 时代刷新链关闭后该路由不再被触发，子 agent 端口派生
  逻辑保留以备账号体系恢复）。
