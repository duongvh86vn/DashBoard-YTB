import { describe, expect, it } from "vitest";

import { DashboardTrendResponseSchema } from "./dashboard-contracts.js";

describe("dashboard trend contract", () => {
  const response = {
    period: {
      startDate: "2026-07-29",
      endDate: "2026-08-25",
      days: 28,
      timeZone: "Asia/Bangkok",
    },
    totals: { viewDelta: "320157", subscriberDelta: "399", publishedVideos: 8 },
    coverage: {
      totalChannels: 2,
      channelsWithCurrentSnapshot: 2,
      channelsWithBaseline: 2,
      requestedDays: 28,
      completeDays: 21,
      partialDays: 4,
      coveragePercent: 75,
    },
    series: [
      {
        date: "2026-08-25",
        viewDelta: "12000",
        subscriberDelta: "14",
        publishedVideos: 1,
        hasSnapshot: true,
      },
    ],
  };

  it("accepts signed metric strings, exact calendar dates and honest nulls", () => {
    expect(DashboardTrendResponseSchema.parse(response)).toEqual(response);
    expect(
      DashboardTrendResponseSchema.parse({
        ...response,
        totals: { ...response.totals, viewDelta: null, subscriberDelta: null },
        series: [{ ...response.series[0], viewDelta: null, subscriberDelta: null }],
      }),
    ).toBeDefined();
  });

  it("rejects floating point and fabricated display values", () => {
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        totals: { ...response.totals, viewDelta: "12.5K" },
      }),
    ).toThrow();
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        period: { ...response.period, days: 91 },
      }),
    ).toThrow();
  });
});
