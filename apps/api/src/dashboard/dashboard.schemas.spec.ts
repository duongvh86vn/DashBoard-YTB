import { describe, expect, it } from "vitest";

import { parseDashboardTrendsQuery } from "./dashboard.schemas.js";

describe("dashboard trend query", () => {
  it("defaults to 28 days and accepts a bounded explicit period", () => {
    expect(parseDashboardTrendsQuery({})).toEqual({ days: 28 });
    expect(parseDashboardTrendsQuery({ days: "7" })).toEqual({ days: 7 });
    expect(parseDashboardTrendsQuery({ days: "90" })).toEqual({ days: 90 });
  });

  it("rejects unsafe, zero, oversized and extra values", () => {
    expect(() => parseDashboardTrendsQuery({ days: "0" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ days: "91" })).toThrow();
    expect(() => parseDashboardTrendsQuery({ days: "28", revenue: "true" })).toThrow();
  });
});
