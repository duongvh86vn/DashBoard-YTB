import { describe, expect, it, vi } from "vitest";

import type { ChannelRecord } from "@yt-monitor/db";

import { VideoDiscoveryJob } from "./discovery.js";

const channel = {
  id: "channel-1",
  youtubeChannelId: "UC1234567890123456789012",
} as ChannelRecord;

describe("VideoDiscoveryJob", () => {
  it("uses RSS first, merges yt-dlp metadata and deduplicates by video id", async () => {
    const upsert = vi.fn(async () => undefined);
    const job = new VideoDiscoveryJob({
      repository: { upsertDiscovered: upsert },
      rssDiscover: async () => ({
        items: [
          {
            videoId: "video-1",
            channelId: channel.youtubeChannelId,
            title: "RSS title",
            publishedAt: new Date("2026-08-22T00:00:00.000Z"),
            url: "https://youtube.com/watch?v=video-1",
          },
        ],
      }),
      ytdlpList: async () => [
        {
          videoId: "video-1",
          channelId: channel.youtubeChannelId,
          title: "yt-dlp title",
          description: "description",
          thumbnail: "https://i.ytimg.com/vi/video-1/hqdefault.jpg",
          publishedAt: new Date("2026-08-22T00:00:00.000Z"),
          durationSeconds: 120,
          availability: null,
          liveStatus: null,
        },
      ],
      now: () => new Date("2026-08-22T01:00:00.000Z"),
    });

    await expect(job.run(channel)).resolves.toMatchObject({
      discovered: 1,
      rssCount: 1,
      ytdlpCount: 1,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        youtubeVideoId: "video-1",
        title: "yt-dlp title",
        durationSeconds: 120,
      }),
      new Date("2026-08-22T01:00:00.000Z"),
    );
  });

  it("keeps a RSS discovery result when yt-dlp is temporarily unavailable", async () => {
    const upsert = vi.fn(async () => undefined);
    const job = new VideoDiscoveryJob({
      repository: { upsertDiscovered: upsert },
      rssDiscover: async () => ({
        items: [
          {
            videoId: "video-2",
            channelId: channel.youtubeChannelId,
            title: "Recent",
            publishedAt: new Date("2026-08-22T00:00:00.000Z"),
            url: "https://youtube.com/watch?v=video-2",
          },
        ],
      }),
      ytdlpList: async () => {
        throw new Error("temporary extractor error");
      },
    });

    await expect(job.run(channel)).resolves.toMatchObject({ discovered: 1, rssFailed: false });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
