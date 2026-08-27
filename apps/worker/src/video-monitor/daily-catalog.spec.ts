import { describe, expect, it, vi } from "vitest";

import { DAILY_CATALOG_BUCKET_OFFSET_MS, DailyVideoCatalogJob } from "./daily-catalog.js";
import { snapshotBucket as hourlySnapshotBucket } from "./snapshot-bucket.js";

const channel = {
  id: "10000000-0000-4000-8000-000000000001",
  youtubeChannelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  canonicalUrl: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
  title: "Example",
};

describe("DailyVideoCatalogJob", () => {
  it("stores one complete daily bucket from an uncapped catalog atomically", async () => {
    const snapshots: unknown[] = [];
    const scans: unknown[] = [];
    const completions: unknown[] = [];
    const job = new DailyVideoCatalogJob({
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-27T02:30:00.000Z"),
      collect: vi.fn(async () => ({
        sourceEntryCount: 2,
        skippedEntryCount: 0,
        missingViewCount: 0,
        videos: [
          {
            videoId: "video-a",
            channelId: channel.youtubeChannelId,
            title: "A",
            description: null,
            thumbnail: null,
            publishedAt: null,
            durationSeconds: null,
            availability: null,
            liveStatus: null,
            viewCount: 4_000n,
            likeCount: 10n,
            commentCount: 2n,
          },
          {
            videoId: "video-b",
            channelId: channel.youtubeChannelId,
            title: "B",
            description: null,
            thumbnail: null,
            publishedAt: null,
            durationSeconds: null,
            availability: null,
            liveStatus: null,
            viewCount: 6_000n,
            likeCount: null,
            commentCount: null,
          },
        ],
      })),
      unitOfWork: {
        transaction: async (work) =>
          work({
            syncRuns: {
              create: async () => ({ id: "sync-run-1" }),
              complete: async (_id: string, input: unknown) => void completions.push(input),
            },
            videos: {
              upsertDiscovered: async (input: { youtubeVideoId: string }) => ({
                id: `db-${input.youtubeVideoId}`,
                channelId: channel.id,
              }),
            },
            videoSnapshots: { upsert: async (input: unknown) => void snapshots.push(input) },
            videoCatalogScans: {
              createIfAbsent: async (input: unknown) => {
                scans.push(input);
                return { created: true, record: input };
              },
            },
          } as never),
      },
    });

    await expect(job.run(channel as never)).resolves.toEqual({
      status: "COMPLETE",
      totalVideos: 2,
      videosWithViews: 2,
      snapshotBucket: new Date("2026-08-26T17:20:00.000Z"),
    });
    expect(snapshots).toEqual([
      expect.objectContaining({
        videoId: "db-video-a",
        views: 4_000n,
        source: "YTDLP_CATALOG",
        snapshotBucket: new Date("2026-08-26T17:20:00.000Z"),
      }),
      expect.objectContaining({
        videoId: "db-video-b",
        views: 6_000n,
        source: "YTDLP_CATALOG",
        snapshotBucket: new Date("2026-08-26T17:20:00.000Z"),
      }),
    ]);
    expect(scans).toEqual([
      expect.objectContaining({
        channelId: channel.id,
        date: new Date("2026-08-27T00:00:00.000Z"),
        totalVideos: 2,
        videosWithViews: 2,
        coverageStatus: "COMPLETE",
      }),
    ]);
    expect(completions).toEqual([
      expect.objectContaining({ status: "SUCCESS", recordsProcessed: 2 }),
    ]);
    expect(DAILY_CATALOG_BUCKET_OFFSET_MS).toBe(20 * 60 * 1_000);
    expect(hourlySnapshotBucket(new Date("2026-08-26T17:20:00.000Z"))).not.toEqual(
      new Date("2026-08-26T17:20:00.000Z"),
    );
  });

  it("keeps missing counters null and marks the catalog partial", async () => {
    const snapshots: Array<{ views: bigint | null }> = [];
    const scans: Array<{ coverageStatus: string }> = [];
    const job = new DailyVideoCatalogJob({
      timeZone: "UTC",
      now: () => new Date("2026-08-27T01:00:00.000Z"),
      collect: async () => ({
        sourceEntryCount: 1,
        skippedEntryCount: 0,
        missingViewCount: 1,
        videos: [
          {
            videoId: "video-a",
            channelId: channel.youtubeChannelId,
            title: "A",
            description: null,
            thumbnail: null,
            publishedAt: null,
            durationSeconds: null,
            availability: null,
            liveStatus: null,
            viewCount: null,
            likeCount: null,
            commentCount: null,
          },
        ],
      }),
      unitOfWork: {
        transaction: async (work) =>
          work({
            syncRuns: { create: async () => ({ id: "run" }), complete: async () => undefined },
            videos: {
              upsertDiscovered: async () => ({ id: "db-video", channelId: channel.id }),
            },
            videoSnapshots: {
              upsert: async (input: { views: bigint | null }) => void snapshots.push(input),
            },
            videoCatalogScans: {
              createIfAbsent: async (input: { coverageStatus: string }) => {
                scans.push(input);
                return { created: true, record: input };
              },
            },
          } as never),
      },
    });

    await expect(job.run(channel as never)).resolves.toMatchObject({ status: "PARTIAL" });
    expect(snapshots).toEqual([expect.objectContaining({ views: null })]);
    expect(scans).toEqual([expect.objectContaining({ coverageStatus: "PARTIAL" })]);
  });

  it("keeps the first committed daily scan immutable when another worker loses the claim", async () => {
    const upsertVideo = vi.fn();
    const upsertSnapshot = vi.fn();
    const completions: unknown[] = [];
    const canonicalBucket = new Date("2026-08-26T17:20:00.000Z");
    const job = new DailyVideoCatalogJob({
      timeZone: "UTC",
      now: () => new Date("2026-08-27T01:00:00.000Z"),
      collect: async () => ({
        sourceEntryCount: 1,
        skippedEntryCount: 0,
        missingViewCount: 0,
        videos: [
          {
            videoId: "video-loser",
            channelId: channel.youtubeChannelId,
            title: "Must not overwrite",
            description: null,
            thumbnail: null,
            publishedAt: null,
            durationSeconds: null,
            availability: null,
            liveStatus: null,
            viewCount: 99_999n,
            likeCount: null,
            commentCount: null,
          },
        ],
      }),
      unitOfWork: {
        transaction: async (work) =>
          work({
            syncRuns: {
              create: async () => ({ id: "run-loser" }),
              complete: async (_id: string, input: unknown) => void completions.push(input),
            },
            videos: { upsertDiscovered: upsertVideo },
            videoSnapshots: { upsert: upsertSnapshot },
            videoCatalogScans: {
              createIfAbsent: async () => ({
                created: false,
                record: {
                  coverageStatus: "COMPLETE",
                  totalVideos: 12,
                  videosWithViews: 12,
                  snapshotBucket: canonicalBucket,
                },
              }),
            },
          } as never),
      },
    });

    await expect(job.run(channel as never)).resolves.toEqual({
      status: "COMPLETE",
      totalVideos: 12,
      videosWithViews: 12,
      snapshotBucket: canonicalBucket,
    });
    expect(upsertVideo).not.toHaveBeenCalled();
    expect(upsertSnapshot).not.toHaveBeenCalled();
    expect(completions).toEqual([
      expect.objectContaining({ status: "SUCCESS", recordsProcessed: 0 }),
    ]);
  });

  it("records a safe failed sync run when collection fails", async () => {
    const completions: unknown[] = [];
    const job = new DailyVideoCatalogJob({
      timeZone: "UTC",
      collect: async () => {
        throw new Error("secret provider details");
      },
      unitOfWork: {
        transaction: async (work) =>
          work({
            syncRuns: {
              create: async () => ({ id: "run" }),
              complete: async (_id: string, input: unknown) => void completions.push(input),
            },
          } as never),
      },
    });

    await expect(job.run(channel as never)).rejects.toThrow("Daily catalog collection failed");
    expect(completions).toEqual([
      {
        status: "FAILED",
        completedAt: expect.any(Date),
        recordsProcessed: 0,
        errorCode: "VIDEO_CATALOG_COLLECTION_FAILED",
        errorMessageSafe: "Daily public video catalog collection failed",
      },
    ]);
  });

  it("refuses to persist a catalog whose collection crosses local midnight", async () => {
    const times = [new Date("2026-08-27T16:59:30.000Z"), new Date("2026-08-27T17:00:30.000Z")];
    const persistCatalog = vi.fn();
    const completions: unknown[] = [];
    const job = new DailyVideoCatalogJob({
      timeZone: "Asia/Bangkok",
      now: () => times.shift() ?? new Date("2026-08-27T17:00:30.000Z"),
      collect: async () => ({
        sourceEntryCount: 0,
        skippedEntryCount: 0,
        missingViewCount: 0,
        videos: [],
      }),
      unitOfWork: {
        transaction: async (work) =>
          work({
            syncRuns: {
              create: async () => ({ id: "run-midnight" }),
              complete: async (_id: string, input: unknown) => void completions.push(input),
            },
            videoCatalogScans: { createIfAbsent: persistCatalog },
          } as never),
      },
    });

    await expect(job.run(channel as never)).rejects.toThrow(
      "Daily catalog collection crossed the local date boundary",
    );
    expect(persistCatalog).not.toHaveBeenCalled();
    expect(completions).toEqual([
      {
        status: "FAILED",
        completedAt: new Date("2026-08-27T17:00:30.000Z"),
        recordsProcessed: 0,
        errorCode: "VIDEO_CATALOG_LOCAL_DATE_CROSSED",
        errorMessageSafe: "Daily public video catalog collection crossed the local date boundary",
      },
    ]);
  });
});
