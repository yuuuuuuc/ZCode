// ============================================================
// WebSearch 的 REST 后端（DeepSeek Search）契约测试
// ============================================================
// 关心的是「有后端时完全不发模型请求」这件事，以及 domain 过滤与 output 的 strict 形状。

import {
  SessionEventType,
  WebSearchOutputSchema,
  WebToolsPortError,
  createSessionId,
  type WebSearchOutput,
  type WebToolsPort,
  type WebToolsBackendStatus,
} from "@zcode/contracts";
import { describe, expect, it, vi } from "vitest";
import { webSearchToolEntry } from "../src/tool/handlers/websearch.js";
import {
  applyDomainConstraintsToQuery,
  filterResultsByDomain,
  toWebSearchResultItems,
} from "../src/tool/handlers/websearch-backend.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelSelection } from "./test-model-selection.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";

const modelSelection = createTestModelSelection({
  providerId: "deepseek" as never,
  modelId: "deepseek-chat" as never,
});

function createBackend(
  results: Awaited<ReturnType<WebToolsPort["search"]>>,
  status: WebToolsBackendStatus = { available: true, origin: "https://api.deepseek.com" },
): WebToolsPort & { search: ReturnType<typeof vi.fn> } {
  return {
    status: () => status,
    search: vi.fn(async () => results),
  } as unknown as WebToolsPort & { search: ReturnType<typeof vi.fn> };
}

function runHandler(
  input: Parameters<NonNullable<typeof webSearchToolEntry.handler>>[0],
  context: Record<string, unknown>,
): Promise<WebSearchOutput> {
  return webSearchToolEntry.handler(input, {
    abortSignal: new AbortController().signal,
    sessionId: createSessionId("websearch-deepseek"),
    traceId: "trace_websearch_deepseek" as never,
    toolCallId: "call_websearch_deepseek",
    workingDirectory: ".",
    workspaceRoot: ".",
    ...context,
  } as never) as Promise<WebSearchOutput>;
}

describe("WebSearch DeepSeek backend", () => {
  it("never issues a model request when the backend is available", async () => {
    const generateText = vi.fn();
    const streamText = vi.fn();
    const port = createBackend([
      {
        url: "https://example.com/a",
        title: "Example",
        summary: "A summary",
        date: "2026-10-01",
        authority: 3,
      },
    ]);

    const output = await runHandler(
      { query: "zod v4" },
      {
        model: {
          generateText,
          optionSpecs: { maxOutputTokens: { max: 4096 } },
          properties: { supportsNativeWebSearch: true },
          streamText,
        },
        webToolsPort: port,
      },
    );

    expect(generateText).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
    expect(port.search).toHaveBeenCalledTimes(1);
    expect(output.results).toEqual([{ title: "Example", url: "https://example.com/a" }]);
    expect(output.webSearchRequests).toBeUndefined();
    expect(output.modelUsage).toBeUndefined();
    // summary 承载 snippet/date/authority：它们是这次搜索的主要价值，但只能进模型可见文本。
    expect(output.summary).toContain("https://example.com/a");
    expect(output.summary).toContain("2026-10-01");
    expect(output.summary).toContain("authority 3");
  });

  it("keeps the structured output inside the strict schema", async () => {
    const port = createBackend([
      { url: "https://example.com/a", title: "Example", summary: "s", authority: 5 },
    ]);
    const output = await runHandler({ query: "zod v4" }, { webToolsPort: port });

    // executor/validation.ts 会拒绝 schema 未声明的字段；这里提前锁住。
    expect(WebSearchOutputSchema.safeParse(output).success).toBe(true);
    expect(Object.keys(output).sort()).toEqual(
      ["durationMs", "query", "results", "sources", "summary"].sort(),
    );
  });

  it("rewrites domain filters into the query and post-filters the results", async () => {
    const port = createBackend([
      { url: "https://docs.example.com/a", title: "Allowed subdomain" },
      { url: "https://other.com/b", title: "Leaked by server" },
    ]);

    const output = await runHandler(
      { allowed_domains: ["example.com"], query: "zod v4" },
      { webToolsPort: port },
    );

    const [request] = port.search.mock.calls[0] as [{ query: string }];
    expect(request.query).toContain("site:example.com");
    // `site:` 只是建议，服务端仍可能返回别的域；契约靠后置过滤生效。
    expect(output.results).toEqual([
      { title: "Allowed subdomain", url: "https://docs.example.com/a" },
    ]);
  });

  it("returns an actionable notice when filters remove every result", async () => {
    const port = createBackend([{ url: "https://other.com/b", title: "Filtered out" }]);
    const output = await runHandler(
      { allowed_domains: ["example.com"], query: "zod v4" },
      { webToolsPort: port },
    );

    expect(output.results).toEqual([]);
    expect(output.summary).toContain("No results were found");
    expect(output.summary).toContain("domain filters");
  });

  it("emits network status events pointing at the backend origin", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const port = createBackend([{ url: "https://example.com/a", title: "Example" }]);

    await runHandler(
      { query: "zod v4" },
      {
        emitEvent: async (event: { type: string; payload: unknown }) => {
          events.push(event);
        },
        webToolsPort: port,
      },
    );

    const network = events.filter((event) => event.type === SessionEventType.NetworkRequestStatus);
    expect(network.map((event) => (event.payload as { status: string }).status)).toEqual([
      "pending",
      "complete",
    ]);
    expect((network[0]?.payload as { url: string }).url).toBe(
      "https://api.deepseek.com/v1/tools/search",
    );
  });

  it("does not fall back to provider-native when the backend fails", async () => {
    const streamText = vi.fn();
    const port: WebToolsPort = {
      status: () => ({ available: true }),
      search: async () => {
        // 必须是真实的端口错误类型：handler 按 code 映射提示，不按文本判断。
        throw new WebToolsPortError({ code: "rate_limited", message: "slow down" });
      },
    };

    await expect(
      runHandler(
        { query: "zod v4" },
        {
          model: {
            generateText: vi.fn(),
            optionSpecs: { maxOutputTokens: { max: 4096 } },
            properties: { supportsNativeWebSearch: true },
            streamText,
          },
          webToolsPort: port,
        },
      ),
    ).rejects.toMatchObject({
      context: { webSearchCode: "rate_limited" },
      message: expect.stringContaining("rate limited"),
    });
    // 同一个 query 搜两次只会双倍计费，所以失败即失败。
    expect(streamText).not.toHaveBeenCalled();
  });
});

describe("websearch backend pure helpers", () => {
  it("combines allowed and blocked domains into search syntax", () => {
    expect(
      applyDomainConstraintsToQuery({
        allowed_domains: ["a.com", "b.com"],
        blocked_domains: ["c.com"],
        query: "zod",
      } as never),
    ).toBe("zod site:a.com OR site:b.com -site:c.com");
  });

  it("matches exact hosts and subdomains but not lookalikes", () => {
    const filtered = filterResultsByDomain(
      [
        { url: "https://example.com/a" },
        { url: "https://docs.example.com/b" },
        { url: "https://notexample.com/c" },
      ],
      { allowed_domains: ["example.com"], query: "q" } as never,
    );
    expect(filtered.map((result) => result.url)).toEqual([
      "https://example.com/a",
      "https://docs.example.com/b",
    ]);
  });

  it("drops undeclared fields and deduplicates urls", () => {
    expect(
      toWebSearchResultItems([
        { url: "https://example.com/a", title: "A", summary: "s", authority: 4 },
        { url: "https://EXAMPLE.com/a", title: "dupe" },
      ]),
    ).toEqual([{ title: "A", url: "https://example.com/a" }]);
  });
});
