import { describe, expect, it, vi } from "vitest";
import { ChannelConflictError } from "@yt-monitor/db";

import { ChannelApplicationError } from "./channel-application.error.js";
import { ChannelsService } from "./channels.service.js";

const channel = {
  id: "00000000-0000-4000-8000-000000000003",
  youtubeChannelId: "UC1234567890123456789012",
  originalInput: "@example",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Example",
  description: null,
  thumbnail: null,
  subscriberCount: null,
  videoCount: null,
  lifetimeViewCount: null,
  lastUploadAt: null,
  availabilityStatus: "ACTIVE" as const,
  activityStatus: "UNKNOWN" as const,
  lastChannelScanAt: null,
  lastHealthCheckAt: null,
  lastSeenAliveAt: null,
  consecutiveHealthFailures: 0,
  firstUnavailableAt: null,
  isEnabled: true,
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
  updatedAt: new Date("2026-08-22T00:00:00.000Z"),
  archivedAt: null,
};

function service(provider: { resolveChannel: (input: string) => Promise<unknown> }) {
  return new ChannelsService({
    provider: provider as never,
    unitOfWork: {
      transaction: async (work) =>
        work({
          channels: {
            list: async () => ({ items: [channel], total: 1 }),
            findById: async () => channel,
            create: async () => channel,
            archive: async () => channel,
          },
        } as never),
    },
  });
}

function publicIntelligenceService(input: {
  now: string;
  snapshot: unknown;
  stats?: unknown[];
  timeZone?: string;
}) {
  return new ChannelsService({
    provider: { resolveChannel: async () => null } as never,
    timeZone: input.timeZone ?? "UTC",
    now: () => new Date(input.now),
    unitOfWork: {
      transaction: async (work) =>
        work({
          channels: {
            findById: async () => channel,
            latestSnapshot: async () => input.snapshot,
          },
          dailyStats: { listByChannelsAndDateRange: async () => input.stats ?? [] },
          videos: {
            summarizePublicCatalog: async () => ({
              knownPublicVideos: 0,
              durationKnownVideos: 0,
              durationSecondsTotal: 0,
              publishedVideos: 0,
              catalogObservedAt: null,
            }),
          },
        } as never),
    },
  });
}

describe("ChannelsService", () => {
  it("does not create when no provider returns a canonical channel", async () => {
    await expect(
      service({ resolveChannel: async () => null }).create({ originalInput: "@missing" }),
    ).rejects.toMatchObject({
      code: "CHANNEL_RESOLVE_FAILED",
      status: 422,
    });
  });

  it("returns stringified bigint-safe public fields", async () => {
    const result = await service({
      resolveChannel: async () => ({
        youtubeChannelId: "UC1234567890123456789012",
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
        handle: "@example",
        title: "Example",
        description: null,
        thumbnail: null,
      }),
    }).get(channel.id);
    expect(result).toMatchObject({ id: channel.id, youtubeChannelId: channel.youtubeChannelId });
  });

  it("maps canonical duplicate failures to the narrow API error", async () => {
    const duplicate = new ChannelConflictError();
    const value = new ChannelsService({
      provider: {
        resolveChannel: async () => ({
          youtubeChannelId: "UC1234567890123456789012",
          canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
          handle: "@example",
          title: "Example",
          description: null,
          thumbnail: null,
        }),
        getChannelCurrentStats: async () => null,
        listRecentVideos: async () => [],
        getVideoStats: async () => [],
      },
      unitOfWork: {
        transaction: async () => {
          throw duplicate;
        },
      },
    });
    await expect(value.create({ originalInput: "@example" })).rejects.toBeInstanceOf(
      ChannelApplicationError,
    );
  });

  it("queues an admin health check and exposes safe history", async () => {
    const serviceUnderTest = new ChannelsService({
      provider: { resolveChannel: async () => null } as never,
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: { findById: async () => channel },
            syncRuns: {
              create: async () => ({ id: "00000000-0000-4000-8000-000000000004" }),
            },
            healthChecks: {
              list: async () => ({
                total: 1,
                items: [
                  {
                    id: "00000000-0000-4000-8000-000000000005",
                    channelId: channel.id,
                    checkedAt: new Date("2026-08-22T00:00:00.000Z"),
                    publicPageStatus: "PUBLIC_PAGE_BLOCKED",
                    ytdlpStatus: "YTDLP_ERROR",
                    rssStatus: "NETWORK_ERROR",
                    normalizedAvailability: "UNKNOWN",
                    evidenceCode: "BLOCKED_PUBLIC_PAGE",
                    evidenceTextSafe: "blocked",
                    httpStatus: 429,
                    durationMs: 100,
                    createdAt: new Date("2026-08-22T00:00:00.000Z"),
                  },
                ],
              }),
            },
          } as never),
      },
    });
    await expect(serviceUnderTest.requestHealthCheck({ id: channel.id })).resolves.toEqual({
      syncRunId: "00000000-0000-4000-8000-000000000004",
      status: "QUEUED",
    });
    await expect(
      serviceUnderTest.healthHistory({ id: channel.id, page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ total: 1, items: [{ evidenceCode: "BLOCKED_PUBLIC_PAGE" }] });
  });

  it("separates signed public inventory correction from observed uploads", async () => {
    const summarizePublicCatalog = vi.fn(async () => ({
      knownPublicVideos: 4,
      durationKnownVideos: 4,
      durationSecondsTotal: 7_200,
      publishedVideos: 3,
      catalogObservedAt: new Date("2026-08-25T02:00:00.000Z"),
    }));
    const baseline = {
      channelId: channel.id,
      date: new Date("2026-08-18T00:00:00.000Z"),
      subscriberCount: 105n,
      videoCount: 10n,
      lifetimeViewCount: 100n,
      coverageStatus: "COMPLETE" as const,
    };
    const completeWindow = Array.from({ length: 6 }, (_, index) => ({
      ...baseline,
      date: new Date(`2026-08-${String(19 + index).padStart(2, "0")}T00:00:00.000Z`),
    }));
    const serviceUnderTest = new ChannelsService({
      provider: { resolveChannel: async () => null } as never,
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-25T03:00:00.000Z"),
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: {
              findById: async () => channel,
              latestSnapshot: async () => ({
                id: "snapshot-id",
                channelId: channel.id,
                capturedAt: new Date("2026-08-25T01:00:00.000Z"),
                subscriberCount: 100n,
                videoCount: 8n,
                lifetimeViewCount: 90n,
                lastUploadAt: null,
                source: "YOUTUBE_PUBLIC_PAGE",
                sourceDetails: {
                  lifetimeViewCount: {
                    source: "YOUTUBE_PUBLIC_ABOUT_HTML",
                    precision: "EXACT_AS_PUBLISHED",
                  },
                  videoCount: {
                    source: "YOUTUBE_PUBLIC_ABOUT_HTML",
                    precision: "EXACT_AS_PUBLISHED",
                  },
                },
                createdAt: new Date("2026-08-25T01:00:00.000Z"),
              }),
            },
            dailyStats: {
              listByChannelsAndDateRange: async () => [baseline, ...completeWindow],
            },
            videos: { summarizePublicCatalog },
          } as never),
      },
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 7 });

    expect(result.metrics.viewsGained).toMatchObject({
      value: "-10",
      status: "READY",
      precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
    });
    expect(result.metrics.subscribersGained).toMatchObject({
      value: "-5",
      precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
    });
    expect(result.metrics.publicInventoryDelta).toMatchObject({
      value: "-2",
      status: "READY",
      precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
    });
    expect(result.metrics.publishedVideos).toMatchObject({
      value: "3",
      status: "PARTIAL",
      reason: "INCOMPLETE_CATALOG",
    });
    expect(result.metrics.averageVideoDurationSeconds).toMatchObject({ value: "1800" });
    expect(result.metrics.uploadFrequencyPerWeek).toMatchObject({ value: "3" });
    expect(result.coverage).toMatchObject({
      completeDays: 7,
      partialDays: 0,
      coveragePercent: 100,
      hasBaseline: true,
    });
    expect(summarizePublicCatalog).toHaveBeenCalledWith(
      channel.id,
      new Date("2026-08-18T17:00:00.000Z"),
      new Date("2026-08-25T03:00:00.001Z"),
    );
  });

  it("labels a counter delta exact only when current and baseline both prove exact precision", async () => {
    const baseline = {
      channelId: channel.id,
      date: new Date("2026-08-18T00:00:00.000Z"),
      subscriberCount: 900n,
      videoCount: 9n,
      lifetimeViewCount: 4_000n,
      coverageStatus: "COMPLETE",
      sourceSummary: {
        lifetimeViewCount: { precision: "EXACT_AS_PUBLISHED" },
        videoCount: { precision: "EXACT_AS_PUBLISHED" },
      },
    };
    const serviceUnderTest = publicIntelligenceService({
      now: "2026-08-25T03:00:00.000Z",
      snapshot: {
        id: "exact-snapshot",
        channelId: channel.id,
        capturedAt: new Date("2026-08-25T01:00:00.000Z"),
        subscriberCount: 1_000n,
        videoCount: 10n,
        lifetimeViewCount: 5_000n,
        lastUploadAt: null,
        source: "YOUTUBE_PUBLIC_PAGE",
        sourceDetails: {
          lifetimeViewCount: { precision: "EXACT_AS_PUBLISHED" },
          videoCount: { precision: "EXACT_AS_PUBLISHED" },
        },
        createdAt: new Date("2026-08-25T01:00:00.000Z"),
      },
      stats: [baseline],
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 7 });

    expect(result.metrics.viewsGained.precision).toBe("DERIVED_FROM_EXACT_PUBLIC_COUNTERS");
    expect(result.metrics.publicInventoryDelta.precision).toBe(
      "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
    );
    expect(result.metrics.subscribersGained.precision).toBe("DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS");
  });

  it("marks a same-local-day snapshot partial after two missed six-hour collection windows", async () => {
    const serviceUnderTest = publicIntelligenceService({
      now: "2026-08-25T23:30:00.000Z",
      snapshot: {
        id: "same-day-stale-snapshot",
        channelId: channel.id,
        capturedAt: new Date("2026-08-25T10:00:00.000Z"),
        subscriberCount: 1_000n,
        videoCount: 10n,
        lifetimeViewCount: 5_000n,
        lastUploadAt: null,
        source: "YOUTUBE_PUBLIC_PAGE",
        sourceDetails: null,
        createdAt: new Date("2026-08-25T10:00:00.000Z"),
      },
      stats: [
        {
          channelId: channel.id,
          date: new Date("2026-08-18T00:00:00.000Z"),
          subscriberCount: 900n,
          videoCount: 9n,
          lifetimeViewCount: 4_000n,
          coverageStatus: "COMPLETE",
          sourceSummary: {},
        },
      ],
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 7 });

    expect(result.metrics.lifetimeViews).toMatchObject({
      status: "PARTIAL",
      reason: "STALE_CURRENT_SNAPSHOT",
    });
    expect(result.metrics.viewsGained).toMatchObject({
      status: "PARTIAL",
      reason: "STALE_CURRENT_SNAPSHOT",
    });
    expect(result.coverage).toMatchObject({ completeDays: 0, partialDays: 1 });
    expect(result.warnings).toContain("STALE_CURRENT_SNAPSHOT");
  });

  it("keeps a previous-local-day snapshot current while it remains inside the 12-hour window", async () => {
    const serviceUnderTest = publicIntelligenceService({
      now: "2026-08-25T01:00:00.000Z",
      snapshot: {
        id: "cross-day-fresh-snapshot",
        channelId: channel.id,
        capturedAt: new Date("2026-08-24T23:30:00.000Z"),
        subscriberCount: 1_000n,
        videoCount: 10n,
        lifetimeViewCount: 5_000n,
        lastUploadAt: null,
        source: "YOUTUBE_PUBLIC_PAGE",
        sourceDetails: null,
        createdAt: new Date("2026-08-24T23:30:00.000Z"),
      },
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 7 });

    expect(result.metrics.lifetimeViews).toMatchObject({ status: "READY", reason: null });
    expect(result.warnings).not.toContain("STALE_CURRENT_SNAPSHOT");
  });

  it("returns honest warming and null values before the first snapshot or catalog pass", async () => {
    const serviceUnderTest = new ChannelsService({
      provider: { resolveChannel: async () => null } as never,
      timeZone: "UTC",
      now: () => new Date("2026-08-25T03:00:00.000Z"),
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: { findById: async () => channel, latestSnapshot: async () => null },
            dailyStats: { listByChannelsAndDateRange: async () => [] },
            videos: {
              summarizePublicCatalog: async () => ({
                knownPublicVideos: 0,
                durationKnownVideos: 0,
                durationSecondsTotal: 0,
                publishedVideos: 0,
                catalogObservedAt: null,
              }),
            },
          } as never),
      },
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 30 });

    expect(result.metrics.lifetimeViews).toMatchObject({
      value: null,
      status: "UNAVAILABLE",
      reason: "NO_CURRENT_SNAPSHOT",
    });
    expect(result.metrics.viewsGained).toMatchObject({
      value: null,
      status: "WARMING_UP",
      reason: "NO_CURRENT_SNAPSHOT",
    });
    expect(result.metrics.publishedVideos).toMatchObject({
      value: null,
      status: "WARMING_UP",
    });
    expect(result.coverage).toMatchObject({
      completeDays: 0,
      partialDays: 0,
      coveragePercent: 0,
      hasCurrentSnapshot: false,
      hasBaseline: false,
    });
  });

  it("treats legacy snapshots without field precision as rounded public display data", async () => {
    const serviceUnderTest = new ChannelsService({
      provider: { resolveChannel: async () => null } as never,
      timeZone: "UTC",
      now: () => new Date("2026-08-25T03:00:00.000Z"),
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: {
              findById: async () => channel,
              latestSnapshot: async () => ({
                id: "legacy-snapshot",
                channelId: channel.id,
                capturedAt: new Date("2026-08-25T01:00:00.000Z"),
                subscriberCount: 1_000n,
                videoCount: 10n,
                lifetimeViewCount: 5_000n,
                lastUploadAt: null,
                source: "YOUTUBE_PUBLIC_PAGE",
                sourceDetails: null,
                createdAt: new Date("2026-08-25T01:00:00.000Z"),
              }),
            },
            dailyStats: {
              listByChannelsAndDateRange: async () => [
                {
                  channelId: channel.id,
                  date: new Date("2026-08-18T00:00:00.000Z"),
                  subscriberCount: 900n,
                  videoCount: 9n,
                  lifetimeViewCount: 4_000n,
                  coverageStatus: "COMPLETE",
                },
              ],
            },
            videos: {
              summarizePublicCatalog: async () => ({
                knownPublicVideos: 0,
                durationKnownVideos: 0,
                durationSecondsTotal: 0,
                publishedVideos: 0,
                catalogObservedAt: null,
              }),
            },
          } as never),
      },
    });

    const result = await serviceUnderTest.publicIntelligence({ id: channel.id, days: 7 });

    expect(result.metrics.lifetimeViews.precision).toBe("ROUNDED_PUBLIC_DISPLAY");
    expect(result.metrics.publicVideos.precision).toBe("ROUNDED_PUBLIC_DISPLAY");
    expect(result.metrics.viewsGained.precision).toBe("DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS");
    expect(result.metrics.publicInventoryDelta.precision).toBe(
      "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
    );
  });
});
