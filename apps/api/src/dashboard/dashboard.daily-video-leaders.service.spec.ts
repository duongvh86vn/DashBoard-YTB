import { describe, expect, it } from "vitest";

import { DashboardService } from "./dashboard.service.js";

const channelId = "00000000-0000-4000-8000-000000000101";
const videoId = "00000000-0000-4000-8000-000000000301";
const newVideoId = "00000000-0000-4000-8000-000000000302";
const subject = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN" as const,
};
const previousBucket = new Date("2026-08-24T00:20:00.000Z");
const currentBucket = new Date("2026-08-25T00:20:00.000Z");

function channel(
  overrides: { lifetimeViewCount?: bigint | null; lastChannelScanAt?: Date | null } = {},
) {
  return {
    id: channelId,
    youtubeChannelId: "UC1234567890123456789012",
    originalInput: "@example",
    canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
    handle: "@example",
    title: "Example Channel",
    description: null,
    thumbnail: null,
    subscriberCount: 100n,
    videoCount: 2n,
    lifetimeViewCount:
      overrides.lifetimeViewCount === undefined ? 11_000n : overrides.lifetimeViewCount,
    lastUploadAt: new Date("2026-08-25T01:00:00.000Z"),
    availabilityStatus: "ACTIVE" as const,
    activityStatus: "ACTIVE_RECENT" as const,
    lastChannelScanAt:
      overrides.lastChannelScanAt === undefined
        ? new Date("2026-08-25T08:00:00.000Z")
        : overrides.lastChannelScanAt,
    lastHealthCheckAt: null,
    lastSeenAliveAt: null,
    consecutiveHealthFailures: 0,
    firstUnavailableAt: null,
    isEnabled: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T08:00:00.000Z"),
    archivedAt: null,
  };
}

function dailyStat(
  date: "2026-08-24" | "2026-08-25",
  input: { lifetimeViewCount?: bigint | null; viewDelta?: bigint | null } = {},
) {
  return {
    id: `daily-${date}`,
    channelId,
    date: new Date(`${date}T00:00:00.000Z`),
    subscriberCount: 100n,
    videoCount: 2n,
    lifetimeViewCount:
      input.lifetimeViewCount === undefined
        ? date === "2026-08-24"
          ? 10_000n
          : 11_000n
        : input.lifetimeViewCount,
    subscriberDelta: 0n,
    videoDelta: 0n,
    viewDelta:
      input.viewDelta === undefined ? (date === "2026-08-24" ? 0n : 1_000n) : input.viewDelta,
    coverageStatus: "COMPLETE" as const,
    sourceSummary: {},
    createdAt: new Date(`${date}T00:00:00.000Z`),
    updatedAt: new Date(`${date}T00:00:00.000Z`),
  };
}

function scan(
  date: "2026-08-24" | "2026-08-25",
  coverageStatus: "COMPLETE" | "PARTIAL" = "COMPLETE",
  counts: { totalVideos: number; videosWithViews: number } = {
    totalVideos: 2,
    videosWithViews: coverageStatus === "COMPLETE" ? 2 : 1,
  },
) {
  const bucket = date === "2026-08-24" ? previousBucket : currentBucket;
  return {
    id: `scan-${date}`,
    channelId,
    date: new Date(`${date}T00:00:00.000Z`),
    capturedAt: new Date(bucket.getTime() + 30_000),
    snapshotBucket: bucket,
    totalVideos: counts.totalVideos,
    videosWithViews: counts.videosWithViews,
    coverageStatus,
    createdAt: bucket,
    updatedAt: bucket,
  };
}

function snapshot(id: string, videoId: string, bucket: Date, views: bigint | null) {
  return {
    id,
    videoId,
    channelId,
    capturedAt: new Date(bucket.getTime() + 30_000),
    snapshotBucket: bucket,
    views,
    likes: null,
    comments: null,
    source: "YTDLP_CATALOG" as const,
    createdAt: bucket,
  };
}

function video(input: {
  id: string;
  youtubeVideoId: string;
  title: string;
  snapshots: ReturnType<typeof snapshot>[];
}) {
  return {
    id: input.id,
    youtubeVideoId: input.youtubeVideoId,
    channelId,
    title: input.title,
    description: null,
    thumbnail: `https://i.ytimg.com/vi/${input.youtubeVideoId}/hqdefault.jpg`,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    durationSeconds: 120,
    firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-25T00:20:00.000Z"),
    isAvailable: true,
    monitorTier: "RECENT" as const,
    currentViews: null,
    currentLikes: null,
    currentComments: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:20:00.000Z"),
    snapshots: input.snapshots,
    channel: { id: channelId, title: "Example Channel", thumbnail: null },
  };
}

function fixture(input: {
  channels?: ReturnType<typeof channel>[];
  stats?: ReturnType<typeof dailyStat>[];
  scans?: ReturnType<typeof scan>[];
  videos?: ReturnType<typeof video>[];
}) {
  return new DashboardService({
    access: {
      resolveVisibleChannelIds: async () => null,
      resolveSelectedChannelIds: async () => null,
    },
    timeZone: "Asia/Bangkok",
    now: () => new Date("2026-08-25T08:00:00.000Z"),
    unitOfWork: {
      transaction: async (work) =>
        work({
          channels: { listEnabled: async () => input.channels ?? [channel()] },
          dailyStats: {
            listByChannelsAndDateRange: async () =>
              input.stats ?? [dailyStat("2026-08-24"), dailyStat("2026-08-25")],
          },
          videoCatalogScans: {
            listByChannelsAndDateRange: async () =>
              input.scans ?? [scan("2026-08-24"), scan("2026-08-25")],
          },
          videos: { listForCatalogComparison: async () => input.videos ?? [] },
        } as never),
    },
  });
}

describe("DashboardService daily video leaders", () => {
  it("selects the largest comparable daily video gain and excludes a new video without baseline", async () => {
    const comparable = video({
      id: videoId,
      youtubeVideoId: "video-main",
      title: "Top daily gain",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, 100n),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });
    const newlySeen = video({
      id: newVideoId,
      youtubeVideoId: "video-new",
      title: "No baseline",
      snapshots: [snapshot("snapshot-3", newVideoId, currentBucket, 900n)],
    });

    const result = await fixture({
      scans: [
        scan("2026-08-24", "COMPLETE", { totalVideos: 1, videosWithViews: 1 }),
        scan("2026-08-25", "COMPLETE", { totalVideos: 2, videosWithViews: 2 }),
      ],
      videos: [newlySeen, comparable],
    }).dailyVideoLeaders({ subject });

    expect(result).toMatchObject({
      date: "2026-08-25",
      previousDate: "2026-08-24",
      source: "YTDLP_CATALOG_SNAPSHOTS",
      coverageStatus: "COMPLETE",
      totalChannels: 1,
      channelsWithDailyGain: 1,
      channelsWithComparableCatalog: 1,
      warnings: [],
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        rank: 1,
        channelId,
        videoId,
        youtubeVideoId: "video-main",
        channelViewDelta: "1000",
        videoViewDelta: "600",
        contributionPercent: 60,
        status: "COMPLETE",
      }),
    ]);
  });

  it("uses the finalized canonical daily gain even when the live channel row has drifted", async () => {
    const comparable = video({
      id: videoId,
      youtubeVideoId: "video-main",
      title: "Top daily gain",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, 100n),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });

    const result = await fixture({
      channels: [channel({ lifetimeViewCount: 99_000n })],
      stats: [
        dailyStat("2026-08-24"),
        dailyStat("2026-08-25", { lifetimeViewCount: 11_000n, viewDelta: 1_000n }),
      ],
      scans: [
        scan("2026-08-24", "COMPLETE", { totalVideos: 1, videosWithViews: 1 }),
        scan("2026-08-25", "COMPLETE", { totalVideos: 1, videosWithViews: 1 }),
      ],
      videos: [comparable],
    }).dailyVideoLeaders({ subject });

    expect(result.items[0]).toMatchObject({
      channelViewDelta: "1000",
      videoViewDelta: "600",
      contributionPercent: 60,
    });
  });

  it("does not coerce missing video views to zero and marks incomplete attribution partial", async () => {
    const incomplete = video({
      id: videoId,
      youtubeVideoId: "video-main",
      title: "Unknown baseline",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, null),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });

    const result = await fixture({
      scans: [scan("2026-08-24", "PARTIAL"), scan("2026-08-25", "PARTIAL")],
      videos: [incomplete],
    }).dailyVideoLeaders({ subject });

    expect(result.coverageStatus).toBe("PARTIAL");
    expect(result.channelsWithComparableCatalog).toBe(0);
    expect(result.warnings).toContain("CATALOG_COVERAGE_PARTIAL");
    expect(result.items).toEqual([]);
  });

  it("does not publish a leader item from a partial catalog pair", async () => {
    const comparable = video({
      id: videoId,
      youtubeVideoId: "video-main",
      title: "Unproven partial winner",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, 100n),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });

    const result = await fixture({
      scans: [scan("2026-08-24", "PARTIAL"), scan("2026-08-25", "PARTIAL")],
      videos: [comparable],
    }).dailyVideoLeaders({ subject });

    expect(result.coverageStatus).toBe("PARTIAL");
    expect(result.channelsWithComparableCatalog).toBe(0);
    expect(result.warnings).toContain("CATALOG_COVERAGE_PARTIAL");
    expect(result.items).toEqual([]);
  });

  it("reports warming-up when a canonical prior catalog scan does not exist", async () => {
    const result = await fixture({ scans: [scan("2026-08-25")] }).dailyVideoLeaders({ subject });

    expect(result).toMatchObject({
      coverageStatus: "WARMING_UP",
      channelsWithComparableCatalog: 0,
      items: [],
    });
    expect(result.warnings).toContain("CATALOG_BASELINE_REQUIRED");
    expect(result.warnings).not.toContain("CATALOG_COVERAGE_PARTIAL");
  });

  it("keeps unavailable channel daily views out of the feed instead of treating them as zero", async () => {
    const result = await fixture({
      stats: [dailyStat("2026-08-24"), dailyStat("2026-08-25", { viewDelta: null })],
    }).dailyVideoLeaders({ subject });

    expect(result.channelsWithDailyGain).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("CHANNEL_DAILY_VIEWS_UNAVAILABLE");
    expect(result.warnings).not.toContain("NO_POSITIVE_DAILY_GAIN");
  });

  it("ranks a proven catalog leader independently while preserving missing and signed channel deltas", async () => {
    const comparable = video({
      id: videoId,
      youtubeVideoId: "video-main",
      title: "Catalog-proven leader",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, 100n),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });
    const scans = [
      scan("2026-08-24", "COMPLETE", { totalVideos: 1, videosWithViews: 1 }),
      scan("2026-08-25", "COMPLETE", { totalVideos: 1, videosWithViews: 1 }),
    ];

    const missing = await fixture({
      stats: [dailyStat("2026-08-24"), dailyStat("2026-08-25", { viewDelta: null })],
      scans,
      videos: [comparable],
    }).dailyVideoLeaders({ subject });
    expect(missing.items).toEqual([
      expect.objectContaining({
        videoId,
        videoViewDelta: "600",
        channelViewDelta: null,
        contributionPercent: null,
        status: "COMPLETE",
      }),
    ]);

    const corrected = await fixture({
      stats: [dailyStat("2026-08-24"), dailyStat("2026-08-25", { viewDelta: -250n })],
      scans,
      videos: [comparable],
    }).dailyVideoLeaders({ subject });
    expect(corrected.coverageStatus).toBe("COMPLETE");
    expect(corrected.items[0]).toMatchObject({
      channelViewDelta: "-250",
      videoViewDelta: "600",
      contributionPercent: null,
      status: "COMPLETE",
    });
  });

  it("breaks equal video gains deterministically by YouTube video id", async () => {
    const laterId = video({
      id: videoId,
      youtubeVideoId: "zzz-video",
      title: "Later",
      snapshots: [
        snapshot("snapshot-1", videoId, previousBucket, 100n),
        snapshot("snapshot-2", videoId, currentBucket, 700n),
      ],
    });
    const earlierId = video({
      id: newVideoId,
      youtubeVideoId: "aaa-video",
      title: "Earlier",
      snapshots: [
        snapshot("snapshot-3", newVideoId, previousBucket, 200n),
        snapshot("snapshot-4", newVideoId, currentBucket, 800n),
      ],
    });

    const result = await fixture({ videos: [laterId, earlierId] }).dailyVideoLeaders({ subject });

    expect(result.coverageStatus).toBe("COMPLETE");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ youtubeVideoId: "aaa-video", status: "COMPLETE" });
  });

  it("returns a strict unavailable response for an empty selected cohort", async () => {
    const result = await fixture({
      channels: [],
      stats: [],
      scans: [],
      videos: [],
    }).dailyVideoLeaders({ subject });

    expect(result).toEqual({
      date: "2026-08-25",
      previousDate: "2026-08-24",
      timeZone: "Asia/Bangkok",
      source: "YTDLP_CATALOG_SNAPSHOTS",
      coverageStatus: "UNAVAILABLE",
      totalChannels: 0,
      channelsWithDailyGain: 0,
      channelsWithComparableCatalog: 0,
      warnings: [],
      items: [],
    });
  });
});
