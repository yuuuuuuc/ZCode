# Context Cache Hit Rate

ZCode context usage now carries provider cache hit information on the same path as the input toolbar context meter.

The toolbar cache hit rate is a main-session aggregate, not the last provider request.

## Data Flow

- Agent model usage is the source of truth. Only main-session requests are counted. A request is eligible when `querySource === "main_turn"`; sidecar requests such as compact, title generation, prompt enhancement, goal verification, subagent, and workflow child requests are excluded.
- Main-turn provider usage exposes total input `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, per-request `latestHitRate`, and aggregate `hitRate`.
- Aggregate `hitRate` is token-weighted:

```text
sum(cacheReadTokens) / sum(inputTokens)
```

`inputTokens` already includes cache read/write tokens in the AI SDK v6
Anthropic path, so the denominator must not add cache fields again.

- `hitRateRequestCount`, `totalInputTokens`, `totalCacheReadTokens`, and `totalCacheWriteTokens` describe the aggregate window used to compute `hitRate`.
- ZCode Protocol snapshot returns the value at `runtime.contextUsage.cache`.
- Task stream emits the same value on `usage_update.cache`, so desktop `continuous` and mobile `/remote` `replayable` clients consume one shared payload.
- UI displays `cache.hitRate` in the chat input context panel when the field is present. Production builds keep the aggregate `0.78` (78%) threshold so lower rates do not distract from context capacity; development builds always display every valid rate to make provider cache diagnostics observable. It does not invent a fallback when the provider omits cache usage, and it does not infer cache hit rate from task cumulative token usage.

## Average Output Speed

The same aggregate also carries `outputTokensPerSecond`, rendered one row below the average
cache hit rate in the context panel. The value and its unit come from one i18n message
(`chat.contextUsage.outputSpeedValue`, `<value> tok/s`, at most one fractional digit) so the
unit localizes with the rest of the panel. It is token-and-time weighted across main-turn
requests:

```text
sum(outputTokens of measurable requests) / (sum(generationDurationMs) / 1000)
```

- A bounded model stream reader owns request-local timing. Generation duration runs from the first
  non-empty `text_delta`, `reasoning_delta`, or `tool_input_delta` to receipt of the provider's
  `finish` event, using the monotonic `performance.now()` clock. The first-output instant is when
  that output reaches the adapter. If the adapter holds a retry-safe prelude — currently a
  non-empty `tool_input_delta` — `finish.deferredOutputLeadMs` carries the hold duration and the
  reader moves the start earlier by the same amount. The reader remains the only timing owner;
  the adapter does not compute speed or measurability. Sub-millisecond holds are scheduling
  noise and are omitted. The release instant and finish are captured before buffering or
  enqueueing/persisting the corresponding events. A private, optional
  `RuntimeModelTextResult.outputGenerationDurationMs` carries the duration to the main-turn
  accumulator; it is not added to the wire protocol or persisted history. Neither event-store
  timestamps nor the return time after queue draining/part persistence define this interval.
- The reader continues sampling while the business consumer drains tool/event writes. Normal
  tool commits and write-queue backpressure do not themselves invalidate timing. Read-ahead is
  bounded to 128 events / 512 Ki UTF-16 delta characters (one oversized provider event
  is not split). If that buffer actually stops reads before finish, timing is unavailable:
  generation can overlap the wait, so neither subtracting it nor counting it is valid. Event
  ordering, tool callbacks, write draining and persistence remain unchanged. Errors follow all
  previously read events; cancellation closes/aborts the reader rather than leaving a background
  model request running. Natural EOF does not close the completed iterator a second time;
  cleanup failures must not replace an already propagating stream failure.
- A request is **measurable only when both** an observable first token and a reported
  positive `outputTokens` are present, with a finite, positive, uninterrupted duration and a
  matching token scope; otherwise it contributes to **neither** numerator nor denominator.
  Each direction of asymmetry skews the number on its own: tokens without time inflate the
  average, time without tokens deflate it. Non-streaming and error-fallback requests fail the
  first condition, requests whose provider omits usage fail the second.
- AI SDK `outputTokens` includes reasoning tokens; they are retained, not added twice or
  subtracted. The adapter supplies optional request-local reasoning provenance at finish:
  `complete`, `summary`, `hidden`, or `unknown`. This is an internal Model port fact, not a new
  session/UI field. OpenAI-compatible raw `choices[0].delta.reasoning_content` is the full
  reasoning field; every non-empty normalized reasoning delta must match those raw characters
  for `complete` provenance. The generic `reasoning` fallback, absent raw evidence, and mixed
  streams are `unknown`. Raw reasoning that never reaches the normalized output stream is also
  unavailable, even if reasoning usage is omitted or zero. OpenAI Responses reasoning is a
  summary, not a full stream. Anthropic
  Claude 3.7 native thinking is full reasoning, matched by the single allowlist constant
  `FULL_NATIVE_THINKING_MODEL` (dated id and `-latest` alias both covered); other Anthropic
  thinking (which may be summarized) is `unknown`, and `redacted_thinking` is `hidden`.
  Beyond that documented Claude 3.7 API
  contract, no provider/model-name heuristic upgrades unknown streams to complete. Raw bodies
  are never sent to the runtime/UI by this feature.
  As with provider token usage, this relies on the upstream honoring its field contract; a
  non-conforming proxy that labels a summary as full `reasoning_content` cannot be detected
  from this stream alone. The generic `reasoning` field is deliberately not treated as proof.
- Complete reasoning participates from the first reasoning delta, with all output tokens.
  Positive reasoning usage without observed reasoning, summary/hidden/unknown reasoning, or
  invalid reasoning metadata makes the request explicitly unavailable in the private timing
  result. Even omitted/zero reasoning usage does not make an observed summary/redaction safe.
  Existing usage and cache-hit accumulation are unchanged. Unavailable samples contribute to
  neither speed counter and preserve any existing average; with no measurable sample the
  aggregate field is `null` (the existing UI hides the row, not a fabricated zero).
- The row is deliberately **not** gated by a production threshold, unlike the neighbouring
  cache hit rate (hidden below 0.78 in production so a low rate does not distract from context
  capacity). Output speed has no good/bad threshold to compare against, so it shows whenever a
  measurable sample exists and hides only when the field is `null`.
- The value is a **cumulative average, not a sliding window**: it accumulates from process start
  (or the last resume) and becomes progressively insensitive to any single request. Resume/rewind
  recovery rebuilds the aggregate from persisted assistant messages, which carry token counts but
  no generation timing. The speed counters restart at zero, so the row hides (field `null`) until
  the next measurable request completes, while `hitRate` keeps its full-history window. The
  displayed speed therefore reflects the current runtime process, not the whole session history.
- The Developer Tools per-request TPS column stays independent: it shows one request at a time
  from the debug observation, while this panel row is the shared aggregate.

```text
provider adapter (reasoning provenance, deferred output lead) -> bounded reader (monotonic timing)
                                         |                         |
                                         v                         v
                                ordered business consumer -> main-turn aggregate
                                + event writes/tools         -> ModelComplete.cacheHit
                                (not a timing source)           | desktop continuous
                                                               + mobile replayable
```

Regression acceptance:

- Delaying event writes, normal tool commits, the terminal drain, or reasoning/text part
  persistence does not change the measured speed while read-ahead remains uninterrupted.
- Empty deltas/preludes do not start timing; a missing finish, zero/invalid duration, non-streaming
  response, actual pre-finish reader backpressure, or missing output usage does not create a sample.
- Complete reasoning with 3000 reasoning tokens plus 100 text tokens over 31 seconds contributes
  all 3100 output tokens at 100 tok/s. Pure streaming tool calls also contribute. A pure tool
  step whose input deltas were held for retry safety counts that hold via
  `deferredOutputLeadMs`; text or complete reasoning that arrives first does not attach the field.
- A response with 3000 reported reasoning tokens and 100 text tokens does not report 3100 tok/s
  over its one-second visible-text tail, with or without visible reasoning summary chunks.
- Skipped requests leave both speed counters unchanged, while cache-hit/token behavior remains
  unchanged. Successful main-turn results still deliver the same aggregate to both desktop and
  mobile; sidecar requests do not contribute, and resume/rewind still restart the speed window.

## Context Source Breakdown

Main-session `model_complete` payloads may also carry `contextUsageBreakdown`, which estimates context source proportions by character count. The input toolbar uses that breakdown only for the context popover display; the progress meter's total `used` / `size` still comes from the token usage fields.

Runtime snapshots can arrive while a follow-up turn is already running. During that window the snapshot may have fresher token/cache usage but no new source breakdown yet, because the next `model_complete` has not happened. The renderer keeps the last known breakdown for the same context window instead of clearing the popover, then replaces it when a newer `usage_update.breakdown` arrives.

## Recovery

Runtime snapshots restore aggregate cache hit information from persisted non-summary assistant messages. This keeps visible main-session history recoverable without mixing in title generation or other sidecar requests that do not create normal assistant messages.

Active-branch selection determines which persisted assistant requests belong to the recovered
aggregate, while the original persisted token metadata supplies their input and cache usage.
Provider/context projections may invalidate Compact-preserved assistant usage to prevent a stale
context anchor, but that projection-only invalidation must not erase the same request from the
recovered cache aggregate.

## Developer Tools Panel

When localStorage contains `zcode:developer-tools:enabled` or the legacy alias
`zcode:token-debug:enabled`, the right-side panel add menu shows a Developer Tools
entry. Values `0`, `false`, `off`, and `no` disable the entry; any other stored value enables it.

The Developer Tools panel is scoped to the active task and includes the token debug view for
main-session model requests with:

- `inputTokens`
- `outputTokens`
- `totalTokens`
- `reasoningTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- per-request `hitRate`

It also records recent model network status events that help troubleshoot transport failures:

- request lifecycle status such as started, completed, failed, retry scheduled, and stream stalled
- request id, provider, model, base URL, transport, attempt, retryability, duration, delay, status code, and reason/message
- trace/session/request attribution when available
- sanitized request headers and response headers

The panel never displays response body/data. Header values that can carry credentials or cookies are
redacted before they reach the renderer. Each request/response keeps at most 32 headers, with each
name/value limited to 512 characters; error messages are limited to 2048 characters.

The panel reads `session/debug`, a read-only, session-scoped observation query. The CLI session
record owns a bounded in-memory observation of live `model_network_status` events, independent
of chat subscriptions and telemetry reporting. It retains the latest 200 completed main-turn
requests and 100 network events; aggregate counters cover all observed main-turn completions.
Closing the panel does not stop collection. Closing/reclaiming the CLI session or restarting its
process clears these diagnostics; persisted history does not invent missing network timing.

```text
model request status -> CLI session debug observation -> session/debug -> UI hook -> panel
desktop continuous / mobile replayable: unchanged; both read the same observation query
```

Only completed requests with `querySource === "main_turn"` enter the token table and summary.
Retries have distinct physical request IDs; duplicate events/completions must not double count.
Title, compact, subagent and other sidecar requests remain visible in network diagnostics but
do not enter main-turn token statistics. The query never starts/resumes a task or changes its
activity timestamp. It returns metadata and sanitized headers, never prompt or response bodies.
The visible panel refreshes once per second after the previous read settles; hidden panels stop
querying. Task/workspace switches discard stale responses and clear the previous task's view.
Query failures are shown explicitly instead of being rendered as successful empty results.

### Output TPS

Each completed main-turn request shows `TPS (tokens/s)`:

```text
outputTokens / ((durationMs - timeToFirstContentMs) / 1000)
```

Both durations come from the same provider request clock. First content is the first non-empty
text, reasoning or tool-argument output observed by the adapter. The end is that model request's
completion, not the end of the user turn or tool execution. The numerator is the provider's
`outputTokens`, without adding reasoning tokens again. Missing output/timing, non-finite values
or a non-positive generation duration display `—`; an observed zero output with valid timing
displays zero. The column tooltip explains the denominator.

Acceptance: live requests populate a panel opened before or after completion; 120 output tokens,
5 seconds total and 2 seconds to first content yield 40 TPS; duplicates, failed retries and
sidecars cannot inflate the summary; missing timing never uses request duration as a fallback;
workspace/task switching, desktop/mobile widths and light/dark themes preserve isolation and
readability. Read-only protocol tests and browser integration evidence remain separate from
formal desktop E2E admission.
