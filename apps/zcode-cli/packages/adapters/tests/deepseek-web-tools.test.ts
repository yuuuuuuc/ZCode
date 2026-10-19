// ============================================================
// DeepSeek Web Tools Adapter Tests
// ============================================================

import {
  WebToolsPortError,
  type HttpClientPort,
  type HttpClientRequest,
  type HttpClientResponse,
} from "@zcode/contracts";
import { describe, expect, it, vi } from "vitest";
import { createDeepSeekWebToolsAdapter } from "../src/web-tools/deepseek-web-tools.js";

const CREDENTIAL = { apiKey: "sk-test-key", baseUrl: "https://api.deepseek.com/anthropic" };

function createHttpClient(
  handler: (request: HttpClientRequest) => HttpClientResponse | Promise<HttpClientResponse>,
): HttpClientPort & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(async (request: HttpClientRequest) => handler(request)),
  } as unknown as HttpClientPort & { request: ReturnType<typeof vi.fn> };
}

function jsonResponse(payload: unknown, status = 200): HttpClientResponse {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return {
    body,
    bytes: body.byteLength,
    durationMs: 1,
    headers: { "content-type": "application/json" },
    status,
    statusText: String(status),
    url: "https://api.deepseek.com/v1/tools/search",
  };
}

function createAdapter(httpClientPort: HttpClientPort, credential = CREDENTIAL) {
  return createDeepSeekWebToolsAdapter({
    credentials: { resolve: () => credential },
    httpClientPort,
  });
}

describe("DeepSeekWebToolsAdapter", () => {
  it("reports unavailable when no DeepSeek credential is configured", () => {
    const adapter = createDeepSeekWebToolsAdapter({
      credentials: { resolve: () => undefined },
      httpClientPort: createHttpClient(() => jsonResponse({ results: [] })),
    });
    expect(adapter.status()).toEqual({ available: false });
  });

  it("derives the API origin from the provider baseUrl", () => {
    const adapter = createAdapter(createHttpClient(() => jsonResponse({ results: [] })));
    expect(adapter.status()).toEqual({
      available: true,
      origin: "https://api.deepseek.com",
    });
  });

  it("re-reads the credential source on every call", () => {
    let credential: typeof CREDENTIAL | undefined = CREDENTIAL;
    const adapter = createDeepSeekWebToolsAdapter({
      credentials: { resolve: () => credential },
      httpClientPort: createHttpClient(() => jsonResponse({ results: [] })),
    });

    expect(adapter.status().available).toBe(true);
    credential = undefined;
    // 用户中途删掉 Key 之后必须立刻回落，而不是等进程重启。
    expect(adapter.status().available).toBe(false);
  });

  it("posts the documented request shape", async () => {
    const httpClient = createHttpClient(() => jsonResponse({ results: [] }));
    const adapter = createAdapter(httpClient);

    await adapter.search({ query: "zod v4" });

    const [request] = httpClient.request.mock.calls[0] as [HttpClientRequest];
    expect(request.url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer sk-test-key",
      "Content-Type": "application/json",
    });
    // count 默认 10：10 条 summary 约 6–8 KB，落在 WebSearch 的 20 KB 模型预算内。
    expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({
      count: 10,
      query: "zod v4",
    });
  });

  it("maps results and drops entries without a url", async () => {
    const adapter = createAdapter(
      createHttpClient(() =>
        jsonResponse({
          results: [
            {
              authority: 3,
              date: null,
              rerank_score: 2.4,
              site_name: "Zod",
              summary: "s",
              title: "Release notes",
              url: "https://zod.dev/v4",
            },
            { title: "no url" },
          ],
        }),
      ),
    );

    expect(await adapter.search({ query: "zod" })).toEqual([
      {
        authority: 3,
        date: undefined,
        siteName: "Zod",
        summary: "s",
        title: "Release notes",
        url: "https://zod.dev/v4",
      },
    ]);
  });

  it("treats a missing results array as an empty result set", async () => {
    const adapter = createAdapter(createHttpClient(() => jsonResponse({})));
    expect(await adapter.search({ query: "zod" })).toEqual([]);
  });

  it("maps HTTP status codes to stable error codes", async () => {
    const cases: Array<[number, string]> = [
      [400, "invalid_request"],
      [401, "unauthorized"],
      [402, "insufficient_balance"],
      [403, "blocked_by_policy"],
      [404, "not_found"],
      [408, "timeout"],
      [500, "upstream_error"],
      [504, "timeout"],
    ];

    for (const [status, code] of cases) {
      const adapter = createAdapter(createHttpClient(() => jsonResponse({}, status)));
      await expect(adapter.search({ query: "zod" })).rejects.toMatchObject({ code, status });
    }
  });

  it("retries a 429 once and surfaces rate_limited when it persists", async () => {
    const httpClient = createHttpClient(() => jsonResponse({}, 429));
    const adapter = createAdapter(httpClient);

    await expect(adapter.search({ query: "zod" })).rejects.toMatchObject({ code: "rate_limited" });
    expect(httpClient.request).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the retry after a single 429", async () => {
    let calls = 0;
    const adapter = createAdapter(
      createHttpClient(() => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, 429)
          : jsonResponse({ results: [{ title: "ok", url: "https://example.com" }] });
      }),
    );

    expect(await adapter.search({ query: "zod" })).toHaveLength(1);
  });

  it("maps transport failures without leaking the api key", async () => {
    const adapter = createAdapter(
      createHttpClient(() => {
        throw Object.assign(new Error("socket hang up"), { code: "network_error" });
      }),
    );

    const error = await adapter.search({ query: "zod" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebToolsPortError);
    expect((error as WebToolsPortError).code).toBe("network_error");
    expect(String((error as Error).message)).not.toContain("sk-test-key");
  });

  it("propagates timeout failures as timeout", async () => {
    const adapter = createAdapter(
      createHttpClient(() => {
        throw Object.assign(new Error("timed out"), { code: "timeout" });
      }),
    );
    await expect(adapter.search({ query: "zod" })).rejects.toMatchObject({ code: "timeout" });
  });

  it("propagates cancellation instead of reporting a backend failure", async () => {
    const abortError = Object.assign(new Error("aborted"), { code: "cancelled" });
    const adapter = createAdapter(
      createHttpClient(() => {
        throw abortError;
      }),
    );
    await expect(adapter.search({ query: "zod" })).rejects.toBe(abortError);
  });
});
