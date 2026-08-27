import { describe, expect, it } from "vitest";

import {
  calculateEstimatedRevenueMicros,
  formatRpmMicros,
  formatUsdMicros,
  parseRpmMicros,
} from "./index.js";

describe("deterministic RPM revenue", () => {
  it("parses non-negative RPM decimal text into exact micro-USD", () => {
    expect(parseRpmMicros("0")).toBe(0n);
    expect(parseRpmMicros("1.5")).toBe(1_500_000n);
    expect(parseRpmMicros("12.345678")).toBe(12_345_678n);
    expect(parseRpmMicros("0.000001")).toBe(1n);
  });

  it.each(["", " 1.5", "1.5 ", "+1", "-1", "01", "1.", ".5", "1.0000001", "1e3", "1,5"])(
    "rejects invalid RPM text %j",
    (value) => {
      expect(() => parseRpmMicros(value)).toThrow(RangeError);
    },
  );

  it("rejects RPM values that cannot be stored in PostgreSQL BIGINT micro-USD", () => {
    expect(parseRpmMicros("9223372036854.775807")).toBe(9_223_372_036_854_775_807n);
    expect(() => parseRpmMicros("9223372036854.775808")).toThrow(RangeError);
  });

  it("formats RPM micro-USD without losing precision", () => {
    expect(formatRpmMicros(0n)).toBe("0");
    expect(formatRpmMicros(1_500_000n)).toBe("1.5");
    expect(formatRpmMicros(12_345_678n)).toBe("12.345678");
    expect(formatRpmMicros(1n)).toBe("0.000001");
    expect(() => formatRpmMicros(-1n)).toThrow(RangeError);
  });

  it("calculates exact revenue micro-USD from views and RPM", () => {
    expect(calculateEstimatedRevenueMicros(10_000n, 1_500_000n)).toBe(15_000_000n);
    expect(calculateEstimatedRevenueMicros(1n, 1_000n)).toBe(1n);
    expect(calculateEstimatedRevenueMicros(0n, 1_500_000n)).toBe(0n);
    expect(() => calculateEstimatedRevenueMicros(1n, -1n)).toThrow(RangeError);
  });

  it("rounds half away from zero and preserves negative corrections", () => {
    expect(calculateEstimatedRevenueMicros(1n, 499n)).toBe(0n);
    expect(calculateEstimatedRevenueMicros(1n, 500n)).toBe(1n);
    expect(calculateEstimatedRevenueMicros(-1n, 499n)).toBe(0n);
    expect(calculateEstimatedRevenueMicros(-1n, 500n)).toBe(-1n);
    expect(calculateEstimatedRevenueMicros(-10_000n, 1_500_000n)).toBe(-15_000_000n);
  });

  it("formats micro-USD without losing signed sub-cent precision", () => {
    expect(formatUsdMicros(1_500n)).toBe("0.0015");
    expect(formatUsdMicros(-1_500n)).toBe("-0.0015");
    expect(formatUsdMicros(0n)).toBe("0");
    expect(formatUsdMicros(1_234_567n)).toBe("1.234567");
  });

  it("round-trips RPM values beyond the safe integer range", () => {
    const rpm = "9007199254.740993";
    expect(formatRpmMicros(parseRpmMicros(rpm))).toBe(rpm);
  });
});
