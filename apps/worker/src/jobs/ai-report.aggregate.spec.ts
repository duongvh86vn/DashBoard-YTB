import { describe, expect, it, vi } from "vitest";

import { AiReportAggregateBuilder } from "./ai-report.aggregate.js";

const channel = { id: "channel-1", title: "Example" };

function repositories(input: { channels?: unknown[]; stats?: unknown[]; videos?: unknown[] } = {}) {
  return {
    channels: { listEnabled: vi.fn().mockResolvedValue(input.channels ?? [channel]) },
    dailyStats: {
      listByChannelsAndDateRange: vi.fn().mockResolvedValue(input.stats ?? []),
    },
    videos: { listForRanking: vi.fn().mockResolvedValue(input.videos ?? []) },
  };
}

function completeWeeklyStats() {
  return Array.from({ length: 7 }, (_, index) => ({
    channelId: "channel-1",
    date: new Date(`2026-08-${String(19 + index).padStart(2, "0")}T00:00:00.000Z`),
    subscriberCount: 1_000n + BigInt(index),
    videoCount: 20n,
    lifetimeViewCount: 5_000n + BigInt(index * 100),
    subscriberDelta: 1n,
    videoDelta: 0n,
    viewDelta: 100n,
    coverageStatus: "COMPLETE",
  }));
}

function videoWithSnapshots(snapshots: Array<{ id: string; capturedAt: string; views: bigint }>) {
  return {
    id: "video-1",
    youtubeVideoId: "youtube-video-1",
    channelId: "channel-1",
    title: "Observed public title",
    description: null,
    thumbnail: null,
    publishedAt: new Date("2026-08-20T00:00:00.000Z"),
    durationSeconds: 300,
    currentViews: null,
    currentLikes: null,
    currentComments: null,
    vph1h: null,
    vph3h: null,
    vph6h: null,
    breakout24h: null,
    breakout48h: null,
    breakout7d: null,
    monitorTier: "HOT",
    firstSeenAt: new Date("2026-08-20T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-25T22:00:00.000Z"),
    isAvailable: true,
    isPinned: false,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T22:00:00.000Z"),
    channel: { id: "channel-1", title: "Example", thumbnail: null },
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      videoId: "video-1",
      channelId: "channel-1",
      capturedAt: new Date(snapshot.capturedAt),
      snapshotBucket: new Date(snapshot.capturedAt),
      views: snapshot.views,
      likes: null,
      comments: null,
      source: "YTDLP",
      createdAt: new Date(snapshot.capturedAt),
    })),
  };
}

function builder(
  repo: ReturnType<typeof repositories>,
  timeZone = "UTC",
  now = new Date("2026-08-26T00:00:00.000Z"),
) {
  return new AiReportAggregateBuilder({
    unitOfWork: {
      transaction: vi.fn(async (work: (input: typeof repo) => unknown) => work(repo)),
    } as never,
    timeZone,
    now: () => now,
  });
}

describe("AiReportAggregateBuilder", () => {
  it("builds deterministic evidence only from canonical daily rows", async () => {
    const repo = repositories({
      stats: [
        {
          channelId: "channel-1",
          date: new Date("2026-08-25T00:00:00.000Z"),
          subscriberCount: 1000n,
          videoCount: 20n,
          lifetimeViewCount: 5000n,
          subscriberDelta: 10n,
          videoDelta: 1n,
          viewDelta: 250n,
          coverageStatus: "COMPLETE",
          sourceSummary: {
            subscriberCount: { precision: "ROUNDED_3_SIGNIFICANT_DIGITS" },
            videoCount: { precision: "EXACT_AS_PUBLISHED" },
            lifetimeViewCount: { precision: "EXACT_AS_PUBLISHED" },
          },
        },
      ],
    });
    const result = await builder(repo).build("DAILY", new Date("2026-08-25T00:00:00Z"));
    expect(result.metricSummary.coverage).toEqual({
      status: "COMPLETE",
      expectedChannelDays: 1,
      observedChannelDays: 1,
      completeChannelDays: 1,
      reason: null,
    });
    expect(result.metricSummary.channels[0]).toMatchObject({
      periodSubscriberDelta: "10",
      periodVideoDelta: "1",
      periodViewDelta: "250",
    });
    expect(result.metricSummary.evidence.map((item) => item.id)).toEqual(
      [...result.metricSummary.evidence.map((item) => item.id)].sort(),
    );
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        id: "channel:channel-1:2026-08-25:view_delta",
        value: "250",
        source: "CHANNEL_DAILY_STAT",
        precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
        status: "READY",
        reason: null,
      }),
    );
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        id: "channel:channel-1:2026-08-25:subscriber_count",
        precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
      }),
    );
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        id: "channel:channel-1:2026-08-25:video_count",
        precision: "EXACT_AS_PUBLISHED",
      }),
    );
  });

  it("does not manufacture a weekly delta from an incomplete period", async () => {
    const repo = repositories({
      stats: [
        {
          channelId: "channel-1",
          date: new Date("2026-08-25T00:00:00.000Z"),
          subscriberCount: 1000n,
          videoCount: 20n,
          lifetimeViewCount: 5000n,
          subscriberDelta: 10n,
          videoDelta: 1n,
          viewDelta: 250n,
          coverageStatus: "COMPLETE",
        },
      ],
    });
    const result = await builder(repo).build("WEEKLY", new Date("2026-08-25T00:00:00Z"));
    expect(result.metricSummary.coverage).toMatchObject({
      status: "INSUFFICIENT",
      reason: "INSUFFICIENT_HISTORY",
    });
    expect(result.metricSummary.channels[0]?.periodViewDelta).toBeNull();
  });

  it("marks an empty portfolio insufficient without fabricating rows", async () => {
    const repo = repositories({ channels: [], stats: [] });
    const result = await builder(repo).build("DAILY", new Date("2026-08-25T00:00:00Z"));
    expect(result.channelIds).toEqual([]);
    expect(result.metricSummary.coverage).toMatchObject({
      status: "INSUFFICIENT",
      reason: "NO_ENABLED_CHANNELS",
    });
  });

  it("does not send an all-null PARTIAL boundary to AI", async () => {
    const repo = repositories({
      stats: [
        {
          channelId: "channel-1",
          date: new Date("2026-08-25T00:00:00.000Z"),
          subscriberCount: null,
          videoCount: null,
          lifetimeViewCount: null,
          subscriberDelta: null,
          videoDelta: null,
          viewDelta: null,
          coverageStatus: "PARTIAL",
        },
      ],
    });
    const result = await builder(repo).build("DAILY", new Date("2026-08-25T00:00:00Z"));
    expect(result.metricSummary.coverage).toMatchObject({
      status: "INSUFFICIENT",
      reason: "NO_CANONICAL_METRICS",
    });
  });

  it("uses distinct observations within six hours of both weekly boundaries", async () => {
    const repo = repositories({
      stats: completeWeeklyStats(),
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-18T20:00:00.000Z", views: 100n },
          { id: "latest", capturedAt: "2026-08-25T22:00:00.000Z", views: 180n },
        ]),
      ],
    });

    const result = await builder(repo).build("WEEKLY", new Date("2026-08-25T00:00:00Z"));

    expect(result.metricSummary.videos[0]).toMatchObject({
      latestViews: "180",
      periodViewDelta: "80",
      baselineAt: "2026-08-18T20:00:00.000Z",
      capturedAt: "2026-08-25T22:00:00.000Z",
    });
    expect(result.metricSummary.coverage).toMatchObject({ status: "COMPLETE", reason: null });
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        entityId: "video-1",
        metric: "views",
        precision: "EXACT_AS_PUBLISHED",
        status: "READY",
        reason: null,
      }),
    );
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        entityId: "video-1",
        metric: "viewDelta",
        precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
        status: "READY",
        reason: null,
      }),
    );
  });

  it("rejects a stale period-end observation instead of calculating a misleading delta", async () => {
    const repo = repositories({
      stats: completeWeeklyStats(),
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-18T20:00:00.000Z", views: 100n },
          { id: "stale-latest", capturedAt: "2026-08-24T00:00:00.000Z", views: 170n },
        ]),
      ],
    });

    const result = await builder(repo).build("WEEKLY", new Date("2026-08-25T00:00:00Z"));

    expect(result.metricSummary.videos[0]).toMatchObject({
      latestViews: null,
      periodViewDelta: null,
      capturedAt: null,
    });
    expect(result.metricSummary.coverage).toMatchObject({
      status: "PARTIAL",
      reason: "INSUFFICIENT_HISTORY",
    });
    expect(result.metricSummary.evidence).not.toContainEqual(
      expect.objectContaining({ entityId: "video-1", metric: "viewDelta" }),
    );
  });

  it("never reuses the baseline snapshot as the period-end observation", async () => {
    const repo = repositories({
      stats: completeWeeklyStats(),
      videos: [
        videoWithSnapshots([
          { id: "only-snapshot", capturedAt: "2026-08-19T00:00:00.000Z", views: 100n },
        ]),
      ],
    });

    const result = await builder(repo).build("WEEKLY", new Date("2026-08-25T00:00:00Z"));

    expect(result.metricSummary.videos[0]).toMatchObject({
      latestViews: null,
      periodViewDelta: null,
      baselineAt: "2026-08-19T00:00:00.000Z",
      capturedAt: null,
    });
    expect(result.metricSummary.coverage).toMatchObject({
      status: "PARTIAL",
      reason: "INSUFFICIENT_HISTORY",
    });
  });

  it("anchors video boundaries to the configured local calendar instead of UTC", async () => {
    const repo = repositories({
      stats: completeWeeklyStats(),
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-18T16:00:00.000Z", views: 100n },
          { id: "latest", capturedAt: "2026-08-25T16:00:00.000Z", views: 180n },
        ]),
      ],
    });

    const result = await builder(repo, "Asia/Bangkok").build(
      "WEEKLY",
      new Date("2026-08-25T00:00:00Z"),
    );

    expect(result.metricSummary.videos[0]).toMatchObject({
      periodViewDelta: "80",
      baselineAt: "2026-08-18T16:00:00.000Z",
      capturedAt: "2026-08-25T16:00:00.000Z",
    });
    expect(result.metricSummary.evidence).toContainEqual(
      expect.objectContaining({
        id: "video:video-1:2026-08-19:2026-08-25:view_delta",
        value: "80",
      }),
    );
  });

  it("uses the actual 08:00 Asia/Bangkok generation boundary for a daily video window", async () => {
    const repo = repositories({
      stats: [
        {
          channelId: "channel-1",
          date: new Date("2026-08-25T00:00:00.000Z"),
          subscriberCount: 1_000n,
          videoCount: 20n,
          lifetimeViewCount: 5_000n,
          subscriberDelta: 1n,
          videoDelta: 0n,
          viewDelta: 100n,
          coverageStatus: "COMPLETE",
        },
      ],
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-24T00:45:00.000Z", views: 100n },
          { id: "latest", capturedAt: "2026-08-25T00:45:00.000Z", views: 150n },
          { id: "future", capturedAt: "2026-08-25T16:00:00.000Z", views: 999n },
        ]),
      ],
    });

    const result = await builder(repo, "Asia/Bangkok", new Date("2026-08-25T01:00:00.000Z")).build(
      "DAILY",
      new Date("2026-08-25T00:00:00.000Z"),
    );

    expect(result.metricSummary.videos[0]).toMatchObject({
      latestViews: "150",
      periodViewDelta: "50",
      baselineAt: "2026-08-24T00:45:00.000Z",
      capturedAt: "2026-08-25T00:45:00.000Z",
    });
    expect(result.metricSummary.coverage).toMatchObject({ status: "COMPLETE", reason: null });
  });

  it("uses the actual 08:00 Asia/Bangkok generation boundary for a weekly video window", async () => {
    const repo = repositories({
      stats: completeWeeklyStats(),
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-18T00:45:00.000Z", views: 100n },
          { id: "latest", capturedAt: "2026-08-25T00:45:00.000Z", views: 180n },
          { id: "future", capturedAt: "2026-08-25T16:00:00.000Z", views: 999n },
        ]),
      ],
    });

    const result = await builder(repo, "Asia/Bangkok", new Date("2026-08-25T01:00:00.000Z")).build(
      "WEEKLY",
      new Date("2026-08-25T00:00:00.000Z"),
    );

    expect(result.metricSummary.videos[0]).toMatchObject({
      latestViews: "180",
      periodViewDelta: "80",
      baselineAt: "2026-08-18T00:45:00.000Z",
      capturedAt: "2026-08-25T00:45:00.000Z",
    });
    expect(result.metricSummary.coverage).toMatchObject({ status: "COMPLETE", reason: null });
  });

  it("excludes post-cutoff snapshots and keeps retry aggregate inputs stable", async () => {
    const repo = repositories({
      stats: [
        {
          channelId: "channel-1",
          date: new Date("2026-08-25T00:00:00.000Z"),
          subscriberCount: 1_000n,
          videoCount: 20n,
          lifetimeViewCount: 5_000n,
          subscriberDelta: 1n,
          videoDelta: 0n,
          viewDelta: 100n,
          coverageStatus: "COMPLETE",
        },
      ],
      videos: [
        videoWithSnapshots([
          { id: "baseline", capturedAt: "2026-08-24T00:45:00.000Z", views: 100n },
          { id: "at-cutoff", capturedAt: "2026-08-25T00:45:00.000Z", views: 150n },
          { id: "after-cutoff", capturedAt: "2026-08-25T01:30:00.000Z", views: 999n },
          { id: "after-first-retry", capturedAt: "2026-08-25T03:30:00.000Z", views: 1_500n },
        ]),
      ],
    });
    const reportDate = new Date("2026-08-25T00:00:00.000Z");
    const scheduledCutoffAt = new Date("2026-08-25T01:00:00.000Z");

    const first = await builder(repo, "Asia/Bangkok", new Date("2026-08-25T02:00:00.000Z")).build(
      "DAILY",
      reportDate,
      scheduledCutoffAt,
    );
    const retry = await builder(repo, "Asia/Bangkok", new Date("2026-08-25T04:00:00.000Z")).build(
      "DAILY",
      reportDate,
      scheduledCutoffAt,
    );

    expect(first.metricSummary.videos[0]).toMatchObject({
      latestViews: "150",
      periodViewDelta: "50",
      capturedAt: "2026-08-25T00:45:00.000Z",
    });
    expect(retry.metricSummary).toEqual(first.metricSummary);
  });
});
