import { describe, expect, it } from "vitest";

import { RssDiscoveryJob } from "./rss-discovery.job.js";

describe("RssDiscoveryJob", () => {
  it("enforces channel identity and deduplicates by video id", async () => {
    const job = new RssDiscoveryJob({
      fetchFeed: async () => "xml",
      parseFeed: () => ({
        channelId: "UC1234567890123456789012",
        items: [
          {
            videoId: "v1",
            channelId: "UC1234567890123456789012",
            title: "one",
            publishedAt: new Date(0),
            url: "u1",
          },
          {
            videoId: "v1",
            channelId: "UC1234567890123456789012",
            title: "duplicate",
            publishedAt: new Date(0),
            url: "u1",
          },
        ],
      }),
    });
    await expect(
      job.run({ youtubeChannelId: "UC1234567890123456789012" } as never),
    ).resolves.toMatchObject({
      deduplicatedCount: 1,
      items: [{ videoId: "v1", title: "one" }],
    });
  });

  it("rejects a feed for a different channel", async () => {
    const job = new RssDiscoveryJob({
      fetchFeed: async () => "xml",
      parseFeed: () => ({ channelId: "UC9999999999999999999999", items: [] }),
    });
    await expect(
      job.run({ youtubeChannelId: "UC1234567890123456789012" } as never),
    ).rejects.toThrow("did not match");
  });
});
