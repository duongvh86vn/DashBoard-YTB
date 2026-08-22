import { describe, expect, it } from "vitest";

import type { VideoRankingRecord } from "@yt-monitor/db";

import { VideoRankingsService } from "./rankings.service.js";

const now = new Date("2026-08-22T12:00:00.000Z");
const channelId = "00000000-0000-4000-8000-000000000010";

function video(id: string, points: Array<[string, bigint | null]>): VideoRankingRecord {
  return {
    id,
    youtubeVideoId: `youtube-${id}`,
    channelId,
    title: id,
    description: null,
    thumbnail: null,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    durationSeconds: null,
    currentViews: points.at(-1)?.[1] ?? null,
    currentLikes: null,
    currentComments: null,
    vph1h: null,
    vph3h: null,
    vph6h: null,
    breakout24h: null,
    breakout48h: null,
    breakout7d: null,
    monitorTier: "HOT",
    firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSeenAt: now,
    isAvailable: true,
    isPinned: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: now,
    snapshots: points.map(([capturedAt, views], index) => ({
      id: `${id}-snapshot-${index}`,
      videoId: id,
      channelId,
      capturedAt: new Date(capturedAt),
      snapshotBucket: new Date(capturedAt),
      views,
      likes: null,
      comments: null,
      source: "YTDLP" as const,
      createdAt: new Date(capturedAt),
    })),
    channel: { id: channelId, title: "Example", thumbnail: null },
  };
}

function service(videos: VideoRankingRecord[]) {
  return new VideoRankingsService({
    now: () => now,
    unitOfWork: {
      transaction: async (work) =>
        work({
          videos: {
            listForRanking: async () => videos,
            findById: async (id: string) => videos.find((item) => item.id === id) ?? null,
          },
          videoSnapshots: {
            list: async () => [],
            count: async () => 0,
          },
        } as never),
    },
  });
}

describe("VideoRankingsService", () => {
  it("uses rolling seven-day gain and paginates on the server", async () => {
    const result = await service([
      video("a", [
        ["2026-08-15T12:00:00.000Z", 10_000n],
        ["2026-08-22T12:00:00.000Z", 60_000n],
      ]),
      video("b", [
        ["2026-08-15T12:00:00.000Z", 50_000n],
        ["2026-08-22T12:00:00.000Z", 55_000n],
      ]),
      video("warming", [["2026-08-22T12:00:00.000Z", 99_000n]]),
    ]).weekly({ page: 1, pageSize: 1 });

    expect(result).toMatchObject({ page: 1, pageSize: 1, total: 2, warmingUpCount: 1 });
    expect(result.items[0]).toMatchObject({ id: "a", rank: 1, weeklyGain: "50000" });

    const secondPage = await service([
      video("a", [
        ["2026-08-15T12:00:00.000Z", 10_000n],
        ["2026-08-22T12:00:00.000Z", 60_000n],
      ]),
      video("b", [
        ["2026-08-15T12:00:00.000Z", 50_000n],
        ["2026-08-22T12:00:00.000Z", 55_000n],
      ]),
    ]).weekly({ page: 2, pageSize: 1 });
    expect(secondPage.items[0]).toMatchObject({ id: "b", rank: 2, weeklyGain: "5000" });
  });

  it("returns a not-found error for an unknown snapshot video", async () => {
    await expect(
      service([]).snapshots({ videoId: "missing", page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_FOUND",
      status: 404,
    });
  });
});
