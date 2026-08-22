import { describe, expect, it } from "vitest";

import { calculateBreakoutMultiple, calculateBenchmark } from "./breakout.js";

describe("local breakout", () => {
  it("matches the §99 48-hour fixture", () => {
    expect(calculateBreakoutMultiple(25_000n, [5_000n])).toBe(5);
  });

  it("uses a same-channel median and does not invent a result for zero/NULL data", () => {
    expect(calculateBenchmark([1_000n, 5_000n, 9_000n])).toMatchObject({ median: 5_000 });
    expect(calculateBreakoutMultiple(null, [5_000n])).toBeNull();
    expect(calculateBreakoutMultiple(25_000n, [0n])).toBeNull();
  });
});
