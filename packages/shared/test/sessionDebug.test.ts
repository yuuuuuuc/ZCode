import { describe, expect, it } from "vitest";
import { sessionDebugSnapshotSchema } from "../src/session-debug.js";

const base = { sessionId: "session-1", rounds: [], networkEntries: [], cache: null };

describe("sessionDebugSnapshotSchema outputSpeed", () => {
  it("accepts snapshots with and without output speed diagnostics", () => {
    expect(sessionDebugSnapshotSchema.parse(base)).toEqual(base);
    const withSpeed = {
      ...base,
      outputSpeed: {
        measurableCount: 2,
        unavailableCounts: { reader_backpressure: 1, invalid_usage: 1 },
        lastUnavailableReason: "invalid_usage",
      },
    };
    expect(sessionDebugSnapshotSchema.parse(withSpeed)).toEqual(withSpeed);
  });

  it.each([
    ["unknown reason key", { unavailableCounts: { slow_disk: 1 }, lastUnavailableReason: null }],
    ["unknown last reason", { unavailableCounts: {}, lastUnavailableReason: "slow_disk" }],
    [
      "extra key",
      { unavailableCounts: {}, lastUnavailableReason: null, averageTokensPerSecond: 40 },
    ],
  ])("rejects %s", (_name, outputSpeed) => {
    expect(
      sessionDebugSnapshotSchema.safeParse({
        ...base,
        outputSpeed: { measurableCount: 0, ...outputSpeed },
      }).success,
    ).toBe(false);
  });
});
