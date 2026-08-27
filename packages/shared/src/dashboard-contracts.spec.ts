import { describe, expect, it } from "vitest";

import * as DashboardContracts from "./dashboard-contracts.js";
import { DashboardTrendResponseSchema } from "./dashboard-contracts.js";

interface RuntimeSchema {
  parse(value: unknown): unknown;
}

function runtimeSchema(name: string): RuntimeSchema | undefined {
  return (DashboardContracts as Record<string, unknown>)[name] as RuntimeSchema | undefined;
}

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

describe("dashboard estimated-revenue contract", () => {
  const response = {
    period: {
      startDate: "2026-08-24",
      endDate: "2026-08-25",
      days: 2,
      timeZone: "Asia/Bangkok",
    },
    currency: "USD",
    method: "PUBLIC_VIEW_DELTA_X_MANUAL_RPM",
    metric: {
      totalEstimatedRevenueUsd: "15.00",
      observedEstimatedRevenueUsd: "15.00",
      status: "COMPLETE",
      coveredChannelDays: 4,
      totalChannelDays: 4,
    },
    configuredChannels: 2,
    monetizedChannels: 1,
    totalChannels: 2,
    series: [
      {
        date: "2026-08-24",
        totalEstimatedRevenueUsd: "6.00",
        observedEstimatedRevenueUsd: "6.00",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
      {
        date: "2026-08-25",
        totalEstimatedRevenueUsd: "9.00",
        observedEstimatedRevenueUsd: "9.00",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
    ],
    channels: [
      {
        channelId: "10000000-0000-4000-8000-000000000001",
        channelTitle: "Monetized channel",
        monetizationStatus: "ENABLED",
        effectiveDate: "2026-08-01",
        rpmUsd: "1.5",
        lastReviewedAt: "2026-08-25T01:02:03.000Z",
        totalEstimatedRevenueUsd: "15.00",
        observedEstimatedRevenueUsd: "15.00",
        status: "COMPLETE",
        coveredDays: 2,
        totalDays: 2,
      },
      {
        channelId: "10000000-0000-4000-8000-000000000002",
        channelTitle: "Explicitly disabled channel",
        monetizationStatus: "DISABLED",
        effectiveDate: "2026-08-01",
        rpmUsd: null,
        lastReviewedAt: "2026-08-25T01:02:03.000Z",
        totalEstimatedRevenueUsd: "0.00",
        observedEstimatedRevenueUsd: "0.00",
        status: "COMPLETE",
        coveredDays: 2,
        totalDays: 2,
      },
    ],
  };

  it("accepts exact USD strings and complete channel-day coverage", () => {
    const schema = runtimeSchema("DashboardRevenueResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.parse(response)).toEqual(response);
  });

  it("rejects a strict revenue total when only an observed subset is covered", () => {
    const schema = runtimeSchema("DashboardRevenueResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(() =>
      schema.parse({
        ...response,
        metric: {
          ...response.metric,
          totalEstimatedRevenueUsd: "12.00",
          observedEstimatedRevenueUsd: "12.00",
          status: "PARTIAL",
          coveredChannelDays: 3,
        },
      }),
    ).toThrow();
  });

  it("rejects floating display abbreviations and inconsistent cohort counts", () => {
    const schema = runtimeSchema("DashboardRevenueResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(() =>
      schema.parse({
        ...response,
        metric: { ...response.metric, totalEstimatedRevenueUsd: "$15K" },
      }),
    ).toThrow();
    expect(() => schema.parse({ ...response, monetizedChannels: 3 })).toThrow();
    expect(() =>
      schema.parse({
        ...response,
        metric: { ...response.metric, totalChannelDays: 3 },
      }),
    ).toThrow();
  });
});

describe("daily video leader contract", () => {
  const response = {
    date: "2026-08-25",
    previousDate: "2026-08-24",
    timeZone: "Asia/Bangkok",
    source: "YTDLP_CATALOG_SNAPSHOTS",
    coverageStatus: "COMPLETE",
    totalChannels: 1,
    channelsWithDailyGain: 1,
    channelsWithComparableCatalog: 1,
    warnings: [],
    items: [
      {
        rank: 1,
        channelId: "10000000-0000-4000-8000-000000000001",
        channelTitle: "Miu Miu mê truyện",
        videoId: "20000000-0000-4000-8000-000000000001",
        youtubeVideoId: "video-1",
        title: "Tập mới",
        thumbnail: null,
        channelViewDelta: "10000",
        videoViewDelta: "6000",
        contributionPercent: 60,
        baselineAt: "2026-08-24T17:10:00.000Z",
        capturedAt: "2026-08-25T17:10:00.000Z",
        status: "COMPLETE",
      },
    ],
  };

  it("accepts one evidence-backed daily winner with two real timestamps", () => {
    const schema = runtimeSchema("DailyVideoLeadersResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.parse(response)).toEqual(response);
  });

  it("accepts a signed or missing canonical channel delta for a proven video leader", () => {
    const schema = runtimeSchema("DailyVideoLeadersResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;

    const corrected = {
      ...response,
      channelsWithDailyGain: 0,
      items: [
        {
          ...response.items[0],
          channelViewDelta: "-250",
          contributionPercent: null,
        },
      ],
    };
    expect(schema.parse(corrected)).toEqual(corrected);

    const missing = {
      ...corrected,
      items: [{ ...corrected.items[0], channelViewDelta: null }],
    };
    expect(schema.parse(missing)).toEqual(missing);
  });

  it("rejects fabricated negative gains and impossible coverage counts", () => {
    const schema = runtimeSchema("DailyVideoLeadersResponseSchema");
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(() =>
      schema.parse({
        ...response,
        items: [{ ...response.items[0], videoViewDelta: "-1" }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...response,
        items: [{ ...response.items[0], status: "PARTIAL" }],
      }),
    ).toThrow();
    expect(() => schema.parse({ ...response, channelsWithComparableCatalog: 2 })).toThrow();
  });
});
