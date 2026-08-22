import { describe, expect, it } from "vitest";

import { parsePublicChannelHtml, YoutubePublicPageProvider } from "./resolve-channel.js";

describe("public channel fallback", () => {
  it("extracts only visible public identity markers", () => {
    expect(
      parsePublicChannelHtml(
        '<html><head><meta property="og:title" content="Example Channel"><link href="/channel/UC1234567890123456789012"></head></html>',
        "https://www.youtube.com/@example",
        "@example",
      ),
    ).toEqual({
      youtubeChannelId: "UC1234567890123456789012",
      canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
      handle: "@example",
      title: "Example Channel",
      description: null,
      thumbnail: null,
    });
    expect(
      parsePublicChannelHtml(
        "<html>no channel</html>",
        "https://www.youtube.com/@example",
        "@example",
      ),
    ).toBeNull();
  });

  it("uses an anonymous fetch fallback without requiring OAuth", async () => {
    const provider = new YoutubePublicPageProvider({
      fetchImpl: async () =>
        new Response('<link href="/channel/UC1234567890123456789012">', { status: 200 }),
    });
    await expect(provider.resolveChannel("@example")).resolves.toMatchObject({
      youtubeChannelId: "UC1234567890123456789012",
    });
  });
});
