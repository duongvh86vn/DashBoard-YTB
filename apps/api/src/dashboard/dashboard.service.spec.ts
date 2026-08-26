import { describe, expect, it, vi } from "vitest";

import { DashboardService } from "./dashboard.service.js";

const channelId = "00000000-0000-4000-8000-000000000101";
const adminSubject = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN" as const,
};
const viewerSubject = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "VIEWER" as const,
};

function channel(
  overrides: Partial<{
    id: string;
    subscriberCount: bigint | null;
    lifetimeViewCount: bigint | null;
    lastChannelScanAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? channelId,
    youtubeChannelId: "UC1234567890123456789012",
    originalInput: "@example",
    canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
    handle: "@example",
    title: "Example",
    description: null,
    thumbnail: null,
    subscriberCount: overrides.subscriberCount === undefined ? 14n : overrides.subscriberCount,
    videoCount: 5n,
    lifetimeViewCount:
      overrides.lifetimeViewCount === undefined ? 1_040n : overrides.lifetimeViewCount,
    lastUploadAt: new Date("2026-08-25T01:00:00.000Z"),
    availabilityStatus: "ACTIVE" as const,
    activityStatus: "ACTIVE_RECENT" as const,
    lastChannelScanAt:
      overrides.lastChannelScanAt === undefined
        ? new Date("2026-08-25T01:00:00.000Z")
        : overrides.lastChannelScanAt,
    lastHealthCheckAt: null,
    lastSeenAliveAt: new Date("2026-08-25T01:00:00.000Z"),
    consecutiveHealthFailures: 0,
    firstUnavailableAt: null,
    isEnabled: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T01:00:00.000Z"),
    archivedAt: null,
  };
}

function stat(
  date: string,
  values: {
    channelId?: string;
    subscriberCount: bigint | null;
    lifetimeViewCount: bigint | null;
    subscriberDelta: bigint | null;
    viewDelta: bigint | null;
  },
) {
  return {
    id: `stat-${date}-${values.channelId ?? channelId}`,
    channelId: values.channelId ?? channelId,
    date: new Date(`${date}T00:00:00.000Z`),
    subscriberCount: values.subscriberCount,
    videoCount: 5n,
    lifetimeViewCount: values.lifetimeViewCount,
    subscriberDelta: values.subscriberDelta,
    videoDelta: 0n,
    viewDelta: values.viewDelta,
    coverageStatus: "COMPLETE" as const,
    sourceSummary: {},
    createdAt: new Date(`${date}T00:00:00.000Z`),
    updatedAt: new Date(`${date}T00:00:00.000Z`),
  };
}

function service(input: {
  channels: ReturnType<typeof channel>[];
  stats: ReturnType<typeof stat>[];
  videos?: Array<{ channelId: string; publishedAt: Date | null }>;
  visibleChannelIds?: string[] | null;
  selectedChannelIds?: string[] | null;
}) {
  const listByChannelsAndDateRange = vi.fn(async (channelIds: string[]) =>
    input.stats.filter((item) => channelIds.includes(item.channelId)),
  );
  const listPublishedBetween = vi.fn(async (_start: Date, _end: Date, channelIds: string[]) =>
    (input.videos ?? []).filter((item) => channelIds.includes(item.channelId)),
  );
  const resolveSelectedChannelIds = vi.fn(async (_subject, selection) => {
    if ("selectedChannelIds" in input) return input.selectedChannelIds ?? null;
    const visible = input.visibleChannelIds ?? null;
    if (selection.channelId === undefined) return visible;
    if (visible !== null && !visible.includes(selection.channelId)) {
      throw new Error("not visible");
    }
    return [selection.channelId];
  });
  return {
    listByChannelsAndDateRange,
    listPublishedBetween,
    resolveSelectedChannelIds,
    value: new DashboardService({
      access: {
        resolveVisibleChannelIds: async () => input.visibleChannelIds ?? null,
        resolveSelectedChannelIds,
      },
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-25T08:00:00.000Z"),
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: {
              listEnabled: async (channelIds?: string[]) =>
                channelIds === undefined
                  ? input.channels
                  : input.channels.filter((item) => channelIds.includes(item.id)),
            },
            dailyStats: { listByChannelsAndDateRange },
            videos: { listPublishedBetween },
          } as never),
      },
    }),
  };
}

describe("DashboardService trends", () => {
  it("keeps ADMIN dashboard aggregation unrestricted when the resolver returns null", async () => {
    const secondId = "00000000-0000-4000-8000-000000000102";
    const result = await service({
      channels: [channel(), channel({ id: secondId })],
      stats: [],
      visibleChannelIds: null,
    }).value.trends({ days: 2, subject: adminSubject });

    expect(result.coverage.totalChannels).toBe(2);
  });

  it("aggregates a VIEWER dashboard only across the resolver's membership union", async () => {
    const secondId = "00000000-0000-4000-8000-000000000102";
    const hiddenId = "00000000-0000-4000-8000-000000000103";
    const result = await service({
      channels: [channel(), channel({ id: secondId }), channel({ id: hiddenId })],
      stats: [
        stat("2026-08-24", {
          subscriberCount: 13n,
          lifetimeViewCount: 1_025n,
          subscriberDelta: 2n,
          viewDelta: 15n,
        }),
        stat("2026-08-24", {
          channelId: secondId,
          subscriberCount: 20n,
          lifetimeViewCount: 2_000n,
          subscriberDelta: 3n,
          viewDelta: 30n,
        }),
        stat("2026-08-24", {
          channelId: hiddenId,
          subscriberCount: 30n,
          lifetimeViewCount: 3_000n,
          subscriberDelta: 100n,
          viewDelta: 1_000n,
        }),
      ],
      videos: [
        { channelId, publishedAt: new Date("2026-08-24T02:00:00.000Z") },
        { channelId: secondId, publishedAt: new Date("2026-08-24T03:00:00.000Z") },
        { channelId: hiddenId, publishedAt: new Date("2026-08-24T04:00:00.000Z") },
      ],
      visibleChannelIds: [channelId, secondId],
    }).value.trends({ days: 2, subject: viewerSubject });

    expect(result.coverage.totalChannels).toBe(2);
    expect(result.series[0]).toMatchObject({
      date: "2026-08-24",
      viewDelta: "45",
      subscriberDelta: "5",
      publishedVideos: 2,
    });
  });

  it("returns null dashboard metrics for a VIEWER with no assigned channels", async () => {
    const result = await service({
      channels: [channel()],
      stats: [],
      visibleChannelIds: [],
    }).value.trends({ days: 2, subject: viewerSubject });

    expect(result.totals).toEqual({
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 0,
    });
    expect(result.coverage.totalChannels).toBe(0);
  });

  it("aggregates every dashboard metric only across the resolved group and channel selection", async () => {
    const selectedId = "00000000-0000-4000-8000-000000000102";
    const groupId = "00000000-0000-4000-8000-000000000201";
    const fixture = service({
      channels: [channel(), channel({ id: selectedId })],
      stats: [
        stat("2026-08-24", {
          subscriberCount: 13n,
          lifetimeViewCount: 1_025n,
          subscriberDelta: 2n,
          viewDelta: 15n,
        }),
        stat("2026-08-24", {
          channelId: selectedId,
          subscriberCount: 20n,
          lifetimeViewCount: 2_000n,
          subscriberDelta: 3n,
          viewDelta: 30n,
        }),
      ],
      videos: [
        { channelId, publishedAt: new Date("2026-08-24T02:00:00.000Z") },
        { channelId: selectedId, publishedAt: new Date("2026-08-24T03:00:00.000Z") },
      ],
      selectedChannelIds: [selectedId],
    });

    const result = await fixture.value.trends({
      days: 2,
      groupId,
      channelId: selectedId,
      subject: viewerSubject,
    });

    expect(fixture.resolveSelectedChannelIds).toHaveBeenCalledWith(viewerSubject, {
      groupId,
      channelId: selectedId,
    });
    expect(result.coverage.totalChannels).toBe(1);
    expect(result.series[0]).toMatchObject({
      viewDelta: "30",
      subscriberDelta: "3",
      publishedVideos: 1,
    });
  });

  it("returns real cumulative 28-day totals and real daily deltas without revenue", async () => {
    const fixture = service({
      channels: [channel()],
      stats: [
        stat("2026-08-22", {
          subscriberCount: 10n,
          lifetimeViewCount: 1_000n,
          subscriberDelta: 1n,
          viewDelta: 8n,
        }),
        stat("2026-08-23", {
          subscriberCount: 11n,
          lifetimeViewCount: 1_010n,
          subscriberDelta: 1n,
          viewDelta: 10n,
        }),
        stat("2026-08-24", {
          subscriberCount: 13n,
          lifetimeViewCount: 1_025n,
          subscriberDelta: 2n,
          viewDelta: 15n,
        }),
      ],
      videos: [
        { channelId, publishedAt: new Date("2026-08-22T18:00:00.000Z") },
        { channelId, publishedAt: new Date("2026-08-25T02:00:00.000Z") },
      ],
    });

    const result = await fixture.value.trends({ days: 3, subject: adminSubject });

    expect(result.period).toEqual({
      startDate: "2026-08-23",
      endDate: "2026-08-25",
      days: 3,
      timeZone: "Asia/Bangkok",
    });
    expect(result.totals).toEqual({
      viewDelta: "40",
      subscriberDelta: "4",
      publishedVideos: 2,
    });
    expect(result.observedTotals).toEqual({
      viewDelta: { value: "40", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
      subscriberDelta: { value: "4", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
    });
    expect(result.coverage).toEqual({
      totalChannels: 1,
      channelsWithCurrentSnapshot: 1,
      channelsScanned: 1,
      channelsWithCompleteCurrentSnapshot: 1,
      channelsWithCurrentSubscribers: 1,
      channelsWithCurrentLifetimeViews: 1,
      channelsWithCurrentPublicVideos: 1,
      channelsWithBaseline: 1,
      requestedDays: 3,
      completeDays: 3,
      partialDays: 0,
      coveragePercent: 100,
    });
    expect(result.series).toEqual([
      {
        date: "2026-08-23",
        viewDelta: "10",
        subscriberDelta: "1",
        observed: {
          viewDelta: { value: "10", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
          subscriberDelta: {
            value: "1",
            coveredChannels: 1,
            totalChannels: 1,
            status: "COMPLETE",
          },
        },
        publishedVideos: 1,
        hasSnapshot: true,
      },
      {
        date: "2026-08-24",
        viewDelta: "15",
        subscriberDelta: "2",
        observed: {
          viewDelta: { value: "15", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
          subscriberDelta: {
            value: "2",
            coveredChannels: 1,
            totalChannels: 1,
            status: "COMPLETE",
          },
        },
        publishedVideos: 0,
        hasSnapshot: true,
      },
      {
        date: "2026-08-25",
        viewDelta: "15",
        subscriberDelta: "1",
        observed: {
          viewDelta: { value: "15", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
          subscriberDelta: {
            value: "1",
            coveredChannels: 1,
            totalChannels: 1,
            status: "COMPLETE",
          },
        },
        publishedVideos: 1,
        hasSnapshot: true,
      },
    ]);
  });

  it("keeps aggregate and daily metrics null when any enabled channel lacks coverage", async () => {
    const secondId = "00000000-0000-4000-8000-000000000102";
    const fixture = service({
      channels: [channel(), channel({ id: secondId, subscriberCount: null })],
      stats: [
        stat("2026-08-22", {
          subscriberCount: 10n,
          lifetimeViewCount: 1_000n,
          subscriberDelta: 1n,
          viewDelta: 8n,
        }),
        stat("2026-08-23", {
          subscriberCount: 11n,
          lifetimeViewCount: 1_010n,
          subscriberDelta: 1n,
          viewDelta: 10n,
        }),
      ],
      videos: [{ channelId: secondId, publishedAt: new Date("2026-08-23T02:00:00.000Z") }],
    });

    const result = await fixture.value.trends({ days: 3, subject: adminSubject });

    expect(result.totals).toEqual({
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 1,
    });
    expect(result.observedTotals).toEqual({
      viewDelta: { value: "40", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
      subscriberDelta: { value: "4", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
    });
    expect(result.coverage).toEqual({
      totalChannels: 2,
      channelsWithCurrentSnapshot: 2,
      channelsScanned: 2,
      channelsWithCompleteCurrentSnapshot: 1,
      channelsWithCurrentSubscribers: 1,
      channelsWithCurrentLifetimeViews: 2,
      channelsWithCurrentPublicVideos: 2,
      channelsWithBaseline: 1,
      requestedDays: 3,
      completeDays: 0,
      partialDays: 2,
      coveragePercent: 0,
    });
    expect(result.series[0]).toMatchObject({
      date: "2026-08-23",
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 1,
      hasSnapshot: true,
      observed: {
        viewDelta: { value: "10", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
        subscriberDelta: {
          value: "1",
          coveredChannels: 1,
          totalChannels: 2,
          status: "PARTIAL",
        },
      },
    });
  });

  it("preserves exact zero and negative corrections for complete daily and total metrics", async () => {
    const result = await service({
      channels: [channel({ subscriberCount: 10n, lifetimeViewCount: 990n })],
      stats: [
        stat("2026-08-22", {
          subscriberCount: 10n,
          lifetimeViewCount: 1_000n,
          subscriberDelta: 1n,
          viewDelta: 8n,
        }),
        stat("2026-08-23", {
          subscriberCount: 10n,
          lifetimeViewCount: 995n,
          subscriberDelta: 0n,
          viewDelta: -5n,
        }),
        stat("2026-08-24", {
          subscriberCount: 10n,
          lifetimeViewCount: 995n,
          subscriberDelta: 0n,
          viewDelta: 0n,
        }),
      ],
    }).value.trends({ days: 3, subject: adminSubject });

    expect(result.totals).toMatchObject({ viewDelta: "-10", subscriberDelta: "0" });
    expect(result.observedTotals).toEqual({
      viewDelta: { value: "-10", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
      subscriberDelta: { value: "0", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
    });
    expect(result.series[0]).toMatchObject({
      viewDelta: "-5",
      subscriberDelta: "0",
      observed: {
        viewDelta: { value: "-5", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
        subscriberDelta: { value: "0", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
      },
    });
    expect(result.series[2]).toMatchObject({
      viewDelta: "-5",
      subscriberDelta: "0",
      observed: {
        viewDelta: { value: "-5", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
        subscriberDelta: { value: "0", coveredChannels: 1, totalChannels: 1, status: "COMPLETE" },
      },
    });
  });

  it("preserves exact zero and negative corrections as partial observations without weakening strict totals", async () => {
    const secondId = "00000000-0000-4000-8000-000000000102";
    const result = await service({
      channels: [
        channel({ subscriberCount: 10n, lifetimeViewCount: 990n }),
        channel({ id: secondId, subscriberCount: null, lifetimeViewCount: null }),
      ],
      stats: [
        stat("2026-08-22", {
          subscriberCount: 10n,
          lifetimeViewCount: 1_000n,
          subscriberDelta: 1n,
          viewDelta: 8n,
        }),
        stat("2026-08-23", {
          subscriberCount: 10n,
          lifetimeViewCount: 995n,
          subscriberDelta: 0n,
          viewDelta: -5n,
        }),
        stat("2026-08-24", {
          subscriberCount: 10n,
          lifetimeViewCount: 995n,
          subscriberDelta: 0n,
          viewDelta: 0n,
        }),
      ],
    }).value.trends({ days: 3, subject: adminSubject });

    expect(result.totals).toMatchObject({ viewDelta: null, subscriberDelta: null });
    expect(result.observedTotals).toEqual({
      viewDelta: { value: "-10", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
      subscriberDelta: { value: "0", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
    });
    expect(result.series[0]).toMatchObject({
      viewDelta: null,
      subscriberDelta: null,
      observed: {
        viewDelta: { value: "-5", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
        subscriberDelta: { value: "0", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
      },
    });
  });

  it("returns a dated empty series rather than fabricated zeros for unavailable metrics", async () => {
    const result = await service({ channels: [], stats: [] }).value.trends({
      days: 2,
      subject: adminSubject,
    });

    expect(result.totals).toEqual({
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 0,
    });
    expect(result.coverage).toEqual({
      totalChannels: 0,
      channelsWithCurrentSnapshot: 0,
      channelsScanned: 0,
      channelsWithCompleteCurrentSnapshot: 0,
      channelsWithCurrentSubscribers: 0,
      channelsWithCurrentLifetimeViews: 0,
      channelsWithCurrentPublicVideos: 0,
      channelsWithBaseline: 0,
      requestedDays: 2,
      completeDays: 0,
      partialDays: 0,
      coveragePercent: 0,
    });
    expect(result.series).toEqual([
      {
        date: "2026-08-24",
        viewDelta: null,
        subscriberDelta: null,
        observed: {
          viewDelta: { value: null, coveredChannels: 0, totalChannels: 0, status: "UNAVAILABLE" },
          subscriberDelta: {
            value: null,
            coveredChannels: 0,
            totalChannels: 0,
            status: "UNAVAILABLE",
          },
        },
        publishedVideos: 0,
        hasSnapshot: false,
      },
      {
        date: "2026-08-25",
        viewDelta: null,
        subscriberDelta: null,
        observed: {
          viewDelta: { value: null, coveredChannels: 0, totalChannels: 0, status: "UNAVAILABLE" },
          subscriberDelta: {
            value: null,
            coveredChannels: 0,
            totalChannels: 0,
            status: "UNAVAILABLE",
          },
        },
        publishedVideos: 0,
        hasSnapshot: false,
      },
    ]);
  });

  it("does not report aggregate deltas from stale current channel values", async () => {
    const fixture = service({
      channels: [channel({ lastChannelScanAt: new Date("2026-08-24T10:00:00.000Z") })],
      stats: [
        stat("2026-08-22", {
          subscriberCount: 10n,
          lifetimeViewCount: 1_000n,
          subscriberDelta: 1n,
          viewDelta: 8n,
        }),
        stat("2026-08-23", {
          subscriberCount: 11n,
          lifetimeViewCount: 1_010n,
          subscriberDelta: 1n,
          viewDelta: 10n,
        }),
        stat("2026-08-24", {
          subscriberCount: 13n,
          lifetimeViewCount: 1_025n,
          subscriberDelta: 2n,
          viewDelta: 15n,
        }),
      ],
    });

    const result = await fixture.value.trends({ days: 3, subject: adminSubject });

    expect(result.totals).toMatchObject({ viewDelta: null, subscriberDelta: null });
    expect(result.coverage).toMatchObject({
      channelsScanned: 0,
      channelsWithCompleteCurrentSnapshot: 0,
      channelsWithCurrentSubscribers: 0,
      channelsWithCurrentLifetimeViews: 0,
      channelsWithCurrentPublicVideos: 0,
      requestedDays: 3,
      completeDays: 2,
      partialDays: 0,
      coveragePercent: 66.7,
    });
    expect(result.series[2]).toMatchObject({
      date: "2026-08-25",
      viewDelta: null,
      subscriberDelta: null,
      hasSnapshot: false,
    });
  });
});
