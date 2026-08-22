import { describe, expect, it } from "vitest";

import { calculateCoverage } from "./coverage.js";

describe("coverage", () => {
  it("reports complete, partial and missing requested days", () => {
    expect(
      calculateCoverage({ requestedDays: 7, statuses: ["COMPLETE", "COMPLETE", "PARTIAL"] }),
    ).toEqual({ requestedDays: 7, completeDays: 2, partialDays: 5, coveragePercent: 28.57 });
  });

  it("does not divide by zero", () => {
    expect(calculateCoverage({ requestedDays: 0, statuses: [] })).toEqual({
      requestedDays: 0,
      completeDays: 0,
      partialDays: 0,
      coveragePercent: 0,
    });
  });
});
