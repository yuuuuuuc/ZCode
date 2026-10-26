import { describe, expect, it, vi } from "vitest";
import { createMarketingTouchService } from "#src/marketing-touch/marketingTouchService.js";

function fixture() {
  const request = vi.fn();
  const onSnapshot = vi.fn();
  const getToken = vi.fn(async () => "first-token");
  const getDeviceMid = vi.fn(() => "550e8400-e29b-41d4-a716-446655440000");
  const service = createMarketingTouchService({
    apiClient: { request },
    getToken,
    getDeviceMid,
    baseUrl: "https://api.example.com",
    appVersion: "3.11.2",
    onSnapshot,
  });
  return { service, request, onSnapshot, getToken, getDeviceMid };
}

describe("MarketingTouchService", () => {
  it("returns an empty delivery and does not call the official marketing endpoints", async () => {
    const f = fixture();
    const snapshot = await f.service.query({ locale: "en-US" });

    await f.service.report({
      locale: "en-US",
      scope: snapshot.scope,
      campaignId: "193001",
      actionType: "confirm",
    });

    expect(snapshot.deliveries).toEqual([]);
    expect(snapshot.rejectedCount).toBe(0);
    expect(snapshot.language).toBe("en-US");
    expect(snapshot.scope).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(f.onSnapshot).toHaveBeenCalledWith({
      serverTime: snapshot.serverTime,
      language: "en-US",
      deliveries: [],
      rejectedCount: 0,
    });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.getToken).not.toHaveBeenCalled();
    expect(f.getDeviceMid).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain("first-token");
  });

  it("keeps anonymous and account switches local", async () => {
    const f = fixture();
    const first = await f.service.query({ locale: "zh-CN" });
    const second = await f.service.query({ locale: "en-US" });

    await f.service.report({
      locale: "zh-CN",
      scope: first.scope,
      campaignId: "193001",
      actionType: "cancel",
    });

    expect(first.deliveries).toEqual([]);
    expect(second.deliveries).toEqual([]);
    expect(first.scope).not.toBe(second.scope);
    expect(f.request).not.toHaveBeenCalled();
  });
});
