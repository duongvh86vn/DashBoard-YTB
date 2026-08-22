import { describe, expect, it, vi } from "vitest";

import { fetchYoutubeRss, youtubeRssUrl } from "./fetch-feed.js";
import { RssFetchError } from "./types.js";

describe("fetchYoutubeRss", () => {
  it("builds the public feed URL and accepts XML responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<feed />", {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      }),
    );
    await expect(fetchYoutubeRss("UC1234567890123456789012", { fetchImpl })).resolves.toBe(
      "<feed />",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      youtubeRssUrl("UC1234567890123456789012"),
      expect.objectContaining({ headers: expect.any(Object), signal: expect.any(AbortSignal) }),
    );
  });

  it("normalizes HTTP failures without returning upstream response text", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private error", { status: 429 }));
    await expect(fetchYoutubeRss("UC1234567890123456789012", { fetchImpl })).rejects.toBeInstanceOf(
      RssFetchError,
    );
  });
});
