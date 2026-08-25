import { describe, expect, it, vi } from "vitest";

import { ChannelStatsJob } from "./channel-stats.job.js";

const channel = {
  id: "channel-id",
  youtubeChannelId: "UC1234567890123456789012",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Example",
};

describe("ChannelStatsJob", () => {
  it("does not create a snapshot when no public metric is available", async () => {
    const transaction = vi.fn();
    const job = new ChannelStatsJob({
      unitOfWork: { transaction },
      provider: { getChannelCurrentStats: async () => null },
    });

    await expect(job.run(channel as never)).resolves.toBe("PARTIAL");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("persists nullable public fields and provenance without deriving missing metrics", async () => {
    const createSnapshot = vi.fn();
    const updateCurrentStats = vi.fn();
    const capturedAt = new Date("2026-08-25T01:02:03.000Z");
    const sourceDetails = {
      subscriberCount: {
        source: "YOUTUBE_PUBLIC_ABOUT_HTML",
        capturedAt: capturedAt.toISOString(),
      },
    };
    const job = new ChannelStatsJob({
      unitOfWork: {
        transaction: async (work) =>
          work({ channels: { createSnapshot, updateCurrentStats } } as never),
      },
      provider: {
        getChannelCurrentStats: async () => ({
          subscriberCount: 123n,
          videoCount: null,
          lifetimeViewCount: null,
          lastUploadAt: null,
          title: "Example",
          handle: "@example",
          thumbnail: null,
          source: "YOUTUBE_PUBLIC_PAGE",
          sourceDetails,
        }),
      },
      now: () => capturedAt,
    });

    await expect(job.run(channel as never)).resolves.toBe("SUCCESS");
    expect(createSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriberCount: 123n,
        videoCount: null,
        lifetimeViewCount: null,
        sourceDetails,
      }),
    );
    expect(updateCurrentStats).toHaveBeenCalledWith(
      "channel-id",
      expect.objectContaining({
        capturedAt,
        subscriberCount: 123n,
        videoCount: null,
        lifetimeViewCount: null,
      }),
    );
  });
});
