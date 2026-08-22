import { describe, expect, it } from "vitest";

import { parseYoutubeRss } from "./parse-feed.js";
import { RssParseError } from "./types.js";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <yt:channelId>UC1234567890123456789012</yt:channelId>
  <entry>
    <id>yt:video:video-1</id>
    <yt:videoId>video-1</yt:videoId>
    <yt:channelId>UC1234567890123456789012</yt:channelId>
    <title> First &amp; second </title>
    <published>2026-08-22T01:02:03+00:00</published>
    <link rel="alternate" href="https://www.youtube.com/watch?v=video-1" />
  </entry>
  <entry>
    <yt:videoId>video-1</yt:videoId>
    <title>Duplicate</title>
    <published>2026-08-22T01:02:03Z</published>
  </entry>
</feed>`;

describe("parseYoutubeRss", () => {
  it("parses Atom namespaced entries and deduplicates video ids", () => {
    const result = parseYoutubeRss(FIXTURE);
    expect(result.channelId).toBe("UC1234567890123456789012");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      videoId: "video-1",
      channelId: "UC1234567890123456789012",
      title: "First & second",
    });
  });

  it("rejects malformed or non-canonical feeds instead of guessing", () => {
    expect(() => parseYoutubeRss("<feed><entry></feed>")).toThrow(RssParseError);
    expect(() => parseYoutubeRss("<feed><title>no channel</title></feed>")).toThrow(RssParseError);
  });
});
