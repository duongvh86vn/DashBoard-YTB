import { describe, expect, it } from "vitest";

import { median, percentile } from "./percentiles.js";

describe("deterministic percentiles", () => {
  it("sorts without mutating input and interpolates p75/p90", () => {
    const values = [10, 1, 5, 20];
    expect(median(values)).toBe(7.5);
    expect(percentile(values, 0.75)).toBe(12.5);
    expect(percentile(values, 0.9)).toBe(17);
    expect(values).toEqual([10, 1, 5, 20]);
  });

  it("returns NULL for an empty benchmark", () => {
    expect(median([])).toBeNull();
    expect(percentile([], 0.5)).toBeNull();
  });
});
