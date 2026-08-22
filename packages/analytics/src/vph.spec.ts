import { describe, expect, it } from "vitest";

import { calculateSmoothedVph, calculateVph } from "./vph.js";

describe("local VPH", () => {
  it("calculates the exact one-hour velocity from the §98 fixture", () => {
    expect(
      calculateVph(
        [
          { capturedAt: new Date("2026-08-22T18:00:00.000Z"), views: 10_000n },
          { capturedAt: new Date("2026-08-22T19:00:00.000Z"), views: 12_500n },
        ],
        1,
      ),
    ).toBe(2_500);
  });

  it("keeps negative corrections signed and nullable gaps unknown", () => {
    expect(
      calculateVph(
        [
          { capturedAt: new Date("2026-08-22T18:00:00.000Z"), views: 12_500n },
          { capturedAt: new Date("2026-08-22T19:00:00.000Z"), views: 10_000n },
        ],
        1,
      ),
    ).toBe(-2_500);
    expect(
      calculateVph(
        [
          { capturedAt: new Date("2026-08-22T18:00:00.000Z"), views: null },
          { capturedAt: new Date("2026-08-22T19:00:00.000Z"), views: 10_000n },
        ],
        1,
      ),
    ).toBeNull();
  });

  it("uses the suggested 70/30 smoothed score only when both windows exist", () => {
    expect(calculateSmoothedVph({ vph1h: 2_500, vph3h: 1_500 })).toBe(2_200);
    expect(calculateSmoothedVph({ vph1h: 2_500, vph3h: null })).toBe(2_500);
    expect(calculateSmoothedVph({ vph1h: null, vph3h: null })).toBeNull();
  });
});
