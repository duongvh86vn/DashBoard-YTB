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
    totals: { viewDelta: "320157", subscriberDelta: null, publishedVideos: 8 },
    observedTotals: {
      viewDelta: {
        value: "320157",
        coveredChannels: 2,
        totalChannels: 2,
        status: "COMPLETE",
      },
      subscriberDelta: {
        value: "399",
        coveredChannels: 1,
        totalChannels: 2,
        status: "PARTIAL",
      },
    },
    coverage: {
      totalChannels: 2,
      channelsWithCurrentSnapshot: 2,
      channelsScanned: 2,
      channelsWithCompleteCurrentSnapshot: 1,
      channelsWithCurrentSubscribers: 1,
      channelsWithCurrentLifetimeViews: 2,
      channelsWithCurrentPublicVideos: 2,
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
        subscriberDelta: null,
        observed: {
          viewDelta: {
            value: "12000",
            coveredChannels: 2,
            totalChannels: 2,
            status: "COMPLETE",
          },
          subscriberDelta: {
            value: "14",
            coveredChannels: 1,
            totalChannels: 2,
            status: "PARTIAL",
          },
        },
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
        observedTotals: undefined,
        totals: { ...response.totals, viewDelta: null, subscriberDelta: null },
        series: [
          {
            ...response.series[0],
            viewDelta: null,
            subscriberDelta: null,
            observed: undefined,
          },
        ],
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
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        observedTotals: {
          ...response.observedTotals,
          viewDelta: {
            value: "0",
            coveredChannels: 0,
            totalChannels: 2,
            status: "UNAVAILABLE",
          },
        },
      }),
    ).toThrow();
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        observedTotals: {
          ...response.observedTotals,
          subscriberDelta: {
            value: null,
            coveredChannels: 1,
            totalChannels: 2,
            status: "PARTIAL",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects observed channel totals that disagree with response coverage", () => {
    const seriesPoint = response.series[0];
    if (!seriesPoint?.observed) throw new Error("test fixture requires observed day metrics");

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        observedTotals: {
          ...response.observedTotals,
          subscriberDelta: {
            ...response.observedTotals.subscriberDelta,
            totalChannels: 3,
          },
        },
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        series: [
          {
            ...seriesPoint,
            observed: {
              ...seriesPoint.observed,
              subscriberDelta: {
                ...seriesPoint.observed.subscriberDelta,
                totalChannels: 3,
              },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects strict aggregate values that contradict observed metric status or value", () => {
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        totals: { ...response.totals, subscriberDelta: "399" },
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        totals: { ...response.totals, viewDelta: "999" },
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        totals: { ...response.totals, subscriberDelta: "0" },
        observedTotals: {
          ...response.observedTotals,
          subscriberDelta: {
            value: null,
            coveredChannels: 0,
            totalChannels: 2,
            status: "UNAVAILABLE",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects strict point values that contradict observed metric status or value", () => {
    const seriesPoint = response.series[0];
    if (!seriesPoint?.observed) throw new Error("test fixture requires observed day metrics");

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        series: [{ ...seriesPoint, subscriberDelta: "14" }],
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        series: [{ ...seriesPoint, viewDelta: "999" }],
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        series: [
          {
            ...seriesPoint,
            subscriberDelta: "0",
            observed: {
              ...seriesPoint.observed,
              subscriberDelta: {
                value: null,
                coveredChannels: 0,
                totalChannels: 2,
                status: "UNAVAILABLE",
              },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("keeps legacy clients compatible when observed metrics are omitted", () => {
    expect(
      DashboardTrendResponseSchema.parse({
        ...response,
        observedTotals: undefined,
        totals: { ...response.totals, subscriberDelta: "399" },
        series: [
          {
            ...response.series[0],
            observed: undefined,
            subscriberDelta: "14",
          },
        ],
      }),
    ).toBeDefined();
  });

  it("rejects channel coverage counts that exceed the response total", () => {
    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        coverage: {
          ...response.coverage,
          channelsWithCurrentSubscribers: 3,
        },
      }),
    ).toThrow();

    expect(() =>
      DashboardTrendResponseSchema.parse({
        ...response,
        coverage: {
          ...response.coverage,
          channelsWithBaseline: 3,
        },
      }),
    ).toThrow();
  });
});
