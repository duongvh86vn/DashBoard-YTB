import { describe, expect, it } from "vitest";

import { calculateWeeklyGain } from "./weekly-gain.js";

const now = new Date("2026-08-22T12:00:00.000Z");

describe("weekly gain", () => {
  it("uses the latest snapshot minus the latest baseline at or before seven days", () => {
    const result = calculateWeeklyGain({
      now,
      snapshots: [
        { capturedAt: new Date("2026-08-15T11:00:00.000Z"), views: 10_000n },
        { capturedAt: new Date("2026-08-15T12:00:00.000Z"), views: 10_000n },
        { capturedAt: new Date("2026-08-22T12:00:00.000Z"), views: 60_000n },
      ],
    });
    expect(result).toEqual({
      status: "READY",
      gain: 50_000n,
      baselineAt: new Date("2026-08-15T12:00:00.000Z"),
    });
  });

  it("preserves a negative correction instead of clamping it", () => {
    expect(
      calculateWeeklyGain({
        now,
        snapshots: [
          { capturedAt: new Date("2026-08-15T12:00:00.000Z"), views: 50_000n },
          { capturedAt: now, views: 40_000n },
        ],
      }),
    ).toMatchObject({ status: "READY", gain: -10_000n });
  });

  it("returns WARMING_UP without a valid baseline or nullable views", () => {
    expect(
      calculateWeeklyGain({
        now,
        snapshots: [{ capturedAt: now, views: 1n }],
      }),
    ).toEqual({ status: "WARMING_UP" });
    expect(
      calculateWeeklyGain({
        now,
        snapshots: [
          { capturedAt: new Date("2026-08-15T12:00:00.000Z"), views: null },
          { capturedAt: now, views: 1n },
        ],
      }),
    ).toEqual({ status: "WARMING_UP" });
  });
});
