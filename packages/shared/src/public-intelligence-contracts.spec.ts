import { describe, expect, it } from "vitest";

import { PublicIntelligenceResponseSchema } from "./public-intelligence-contracts.js";

const metric = {
  value: "144693948",
  status: "READY",
  metricClass: "PUBLIC_CURRENT",
  precision: "EXACT_AS_PUBLISHED",
  unit: "COUNT",
  reason: null,
  provenance: {
    source: "YOUTUBE_PUBLIC_PAGE",
    capturedAt: "2026-08-25T01:02:03.000Z",
    baselineDate: null,
    method: "public-current",
    methodVersion: "v1",
  },
} as const;

describe("public intelligence contract", () => {
  it("preserves signed corrections, nullable values and metric quality metadata", () => {
    const response = {
      channelId: "00000000-0000-4000-8000-000000000003",
      asOf: "2026-08-25T01:02:03.000Z",
      period: {
        startDate: "2026-07-27",
        endDate: "2026-08-25",
        days: 30,
        timeZone: "Asia/Bangkok",
      },
      metrics: {
        lifetimeViews: metric,
        subscribers: {
          ...metric,
          value: "406000",
          precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
        },
        publicVideos: { ...metric, value: "183" },
        viewsGained: {
          ...metric,
          value: "4151847",
          metricClass: "LOCAL_SNAPSHOT_DERIVED",
          precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
        },
        subscribersGained: {
          ...metric,
          value: "9000",
          metricClass: "LOCAL_SNAPSHOT_DERIVED",
          precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
        },
        publicInventoryDelta: {
          ...metric,
          value: "-4",
          metricClass: "LOCAL_SNAPSHOT_DERIVED",
          precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
        },
        publishedVideos: {
          ...metric,
          value: "12",
          metricClass: "DETERMINISTIC_PUBLIC_METADATA",
          precision: "SAMPLE_BASED",
        },
        averageVideoDurationSeconds: {
          ...metric,
          value: null,
          status: "UNAVAILABLE",
          metricClass: "DETERMINISTIC_PUBLIC_METADATA",
          precision: "SAMPLE_BASED",
          unit: "SECONDS",
          reason: "MISSING_DURATION_METADATA",
        },
        uploadFrequencyPerWeek: {
          ...metric,
          value: "2.8",
          metricClass: "DETERMINISTIC_PUBLIC_METADATA",
          precision: "SAMPLE_BASED",
          unit: "UPLOADS_PER_WEEK",
        },
      },
      coverage: {
        requestedDays: 30,
        completeDays: 24,
        partialDays: 2,
        coveragePercent: 80,
        hasCurrentSnapshot: true,
        hasBaseline: true,
        reportedPublicVideos: "183",
        knownPublicVideos: 50,
        durationKnownVideos: 48,
      },
      warnings: ["SUBSCRIBER_COUNTS_ARE_ROUNDED", "INCOMPLETE_VIDEO_CATALOG"],
    };

    expect(PublicIntelligenceResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects formatted display numbers that cannot be used deterministically", () => {
    expect(() =>
      PublicIntelligenceResponseSchema.parse({
        channelId: "00000000-0000-4000-8000-000000000003",
        asOf: null,
        period: { startDate: "2026-08-25", endDate: "2026-08-25", days: 1, timeZone: "UTC" },
        metrics: Object.fromEntries(
          [
            "lifetimeViews",
            "subscribers",
            "publicVideos",
            "viewsGained",
            "subscribersGained",
            "publicInventoryDelta",
            "publishedVideos",
            "averageVideoDurationSeconds",
            "uploadFrequencyPerWeek",
          ].map((key) => [key, { ...metric, value: key === "lifetimeViews" ? "4.1M" : null }]),
        ),
        coverage: {
          requestedDays: 1,
          completeDays: 0,
          partialDays: 0,
          coveragePercent: 0,
          hasCurrentSnapshot: false,
          hasBaseline: false,
          reportedPublicVideos: null,
          knownPublicVideos: 0,
          durationKnownVideos: 0,
        },
        warnings: [],
      }),
    ).toThrow();
  });
});
