// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@zcode/services";
import type { SessionDebugSnapshot } from "@zcode/shared";
import { DeveloperToolsPane } from "../src/DeveloperToolsPane.js";
import { ServiceProvider } from "../src/hooks/useServices.js";
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";

afterEach(cleanup);

const baseSnapshot: SessionDebugSnapshot = {
  sessionId: "session-1",
  rounds: [],
  networkEntries: [],
  cache: { hitRateRequestCount: 1, totalInputTokens: 100, totalCacheReadTokens: 80, hitRate: 0.8 },
};

function renderPane(snapshot: SessionDebugSnapshot) {
  const services = {
    zcodeAgentService: { readSessionDebug: vi.fn().mockResolvedValue(snapshot) },
  } as unknown as IServiceAccessor;
  return render(
    <ServiceProvider services={services}>
      <ZCodeIntlProvider initialLocale="zh-CN">
        <DeveloperToolsPane workspacePath="/work" taskId="session-1" />
      </ZCodeIntlProvider>
    </ServiceProvider>,
  );
}

describe("DeveloperToolsPane output speed diagnostics", () => {
  it("shows measurable / unavailable counts and the readable last reason", async () => {
    renderPane({
      ...baseSnapshot,
      outputSpeed: {
        measurableCount: 12,
        unavailableCounts: { reader_backpressure: 2, unaligned_reasoning: 1 },
        lastUnavailableReason: "reader_backpressure",
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("developer-tools-output-speed").textContent).toBe(
        "可测 12 · 不可测 3",
      ),
    );
    expect(screen.getByText("读取背压")).toBeTruthy();
  });

  it("hides the rows when the agent does not report diagnostics", async () => {
    renderPane(baseSnapshot);
    await waitFor(() => expect(screen.getByText("80%")).toBeTruthy());
    expect(screen.queryByTestId("developer-tools-output-speed")).toBeNull();
    expect(screen.queryByText("输出速度样本")).toBeNull();
  });
});
