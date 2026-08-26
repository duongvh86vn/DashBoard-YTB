import { describe, expect, it } from "vitest";

import type { AnonymousBrowserContextFactory } from "./browser-context.js";
import {
  collectPublicChannelCurrentStats,
  parsePublicChannelAboutHtml,
  parsePublicChannelAboutText,
} from "./current-stats.js";

const channel = {
  id: "channel-id",
  youtubeChannelId: "UC1234567890123456789012",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Stored title",
};

function page(input: {
  text: string | string[];
  finalUrl?: string;
  status?: number;
  title?: string;
}): AnonymousBrowserContextFactory {
  let reads = 0;
  return async () => ({
    newPage: async () => ({
      goto: async () => ({ status: () => input.status ?? 200 }),
      title: async () => input.title ?? "Example channel - YouTube",
      url: () => input.finalUrl ?? `${channel.canonicalUrl}/about`,
      locator: () => ({
        innerText: async () =>
          Array.isArray(input.text)
            ? (input.text[Math.min(reads++, input.text.length - 1)] ?? "")
            : input.text,
      }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
}

describe("collectPublicChannelCurrentStats", () => {
  it("isolates the trailing More info block from preceding video view noise", () => {
    expect(
      parsePublicChannelAboutText(
        "Featured video\n95M views\nMore info\n46.1M subscribers\n1,567 videos\n1,265,009,076 views",
      ),
    ).toEqual({
      subscriberCount: 46_100_000n,
      videoCount: 1567n,
      lifetimeViewCount: 1_265_009_076n,
    });
    expect(parsePublicChannelAboutText("46.1M subscribers\n1,567 videos\n95M views")).toEqual({
      subscriberCount: 46_100_000n,
      videoCount: 1567n,
      lifetimeViewCount: null,
    });
  });

  it("isolates exact counters from the public about model instead of nearby video views", () => {
    const html = `
      {"rendererTypes":["aboutChannelViewModel","videoRenderer"]},
      {"viewCountText":"999 video views"},
      "aboutChannelViewModel":{
        "subscriberCountText":"1.25K subscribers",
        "viewCountText":"1,234,567 views",
        "channelId":"UC1234567890123456789012",
        "videoCountText":"87 videos"
      },"shareChannel":{}
    `;
    expect(parsePublicChannelAboutHtml(html, channel.youtubeChannelId)).toEqual({
      subscriberCount: 1250n,
      videoCount: 87n,
      lifetimeViewCount: 1_234_567n,
    });
    expect(parsePublicChannelAboutHtml(html, "UCabcdefghijklmnopqrstuv")).toBeNull();
  });

  it("returns public channel metrics with per-field provenance", async () => {
    const result = await collectPublicChannelCurrentStats(channel, {
      contextFactory: page({
        text: [
          "",
          "Video card\n800 views\nMore info\n1.25K subscribers\n87 videos\n1,234,567 views",
        ],
      }),
      now: () => new Date("2026-08-25T01:02:03.000Z"),
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({
      subscriberCount: 1250n,
      videoCount: 87n,
      lifetimeViewCount: 1_234_567n,
      lastUploadAt: null,
      title: "Example channel",
      handle: "@example",
      source: "YOUTUBE_PUBLIC_PAGE",
      sourceDetails: {
        subscriberCount: {
          source: "YOUTUBE_PUBLIC_ABOUT_RENDER",
          capturedAt: "2026-08-25T01:02:03.000Z",
          metricClass: "PUBLIC_CURRENT",
          precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
          scope: "PUBLIC_ONLY",
        },
        videoCount: {
          source: "YOUTUBE_PUBLIC_ABOUT_RENDER",
          capturedAt: "2026-08-25T01:02:03.000Z",
          metricClass: "PUBLIC_CURRENT",
          precision: "ROUNDED_PUBLIC_DISPLAY",
          scope: "PUBLIC_ONLY",
        },
        lifetimeViewCount: {
          source: "YOUTUBE_PUBLIC_ABOUT_RENDER",
          capturedAt: "2026-08-25T01:02:03.000Z",
          metricClass: "PUBLIC_CURRENT",
          precision: "ROUNDED_PUBLIC_DISPLAY",
          scope: "PUBLIC_ONLY",
        },
      },
    });
  });

  it("returns null for a blocked page or a page with no reliable public metric", async () => {
    await expect(
      collectPublicChannelCurrentStats(channel, {
        contextFactory: page({ text: "Verify you are human", status: 429 }),
        renderWaitMs: 0,
      }),
    ).resolves.toBeNull();
    await expect(
      collectPublicChannelCurrentStats(channel, {
        contextFactory: page({ text: "Example channel" }),
        renderWaitMs: 0,
      }),
    ).resolves.toBeNull();
  });

  it("rejects metrics rendered for a different canonical channel", async () => {
    await expect(
      collectPublicChannelCurrentStats(channel, {
        contextFactory: page({
          text: "10 subscribers\n2 videos\n50 views",
          finalUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/about",
        }),
        renderWaitMs: 0,
      }),
    ).resolves.toBeNull();
  });
});
