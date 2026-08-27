import { describe, expect, it } from "vitest";

import {
  ChannelInputError,
  normalizeChannelInput,
  normalizeProviderVideo,
  normalizeResolvedChannel,
  readNullableCount,
} from "./normalize.js";

describe("normalizeChannelInput", () => {
  it.each([
    ["UC1234567890123456789012", "channel-id", "UC1234567890123456789012"],
    [" @example_handle ", "handle", "@example_handle"],
    ["https://youtube.com/@example_handle/", "handle", "@example_handle"],
    ["https://www.youtube.com/channel/UC1234567890123456789012?view_as=subscriber", "invalid", ""],
  ])("normalizes %s", (input, kind, value) => {
    if (kind === "invalid") {
      expect(() => normalizeChannelInput(input)).toThrow(ChannelInputError);
      return;
    }
    const result = normalizeChannelInput(input);
    expect(result.kind).toBe(kind);
    expect(result.kind === "channel-id" ? result.channelId : result.handle).toBe(value);
  });

  it.each([
    "https://example.com/@handle",
    "https://www.youtube.com/user/name",
    "youtube.com/@handle",
    "@ab",
    "UCshort",
  ])("rejects unsupported input %s", (input) => {
    expect(() => normalizeChannelInput(input)).toThrow(ChannelInputError);
  });
});

describe("yt-dlp normalization", () => {
  it("requires a canonical channel id before creating a resolved channel", () => {
    expect(
      normalizeResolvedChannel({ channel_id: "UC1234567890123456789012", uploader: "@handle" }),
    ).toMatchObject({
      youtubeChannelId: "UC1234567890123456789012",
      canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
    });
    expect(normalizeResolvedChannel({ uploader: "@handle" })).toBeNull();
  });

  it("keeps nullable counters and normalizes upload metadata", () => {
    expect(readNullableCount("123456789012345678")).toBe(123456789012345678n);
    expect(readNullableCount("not-a-count")).toBeNull();
    expect(
      normalizeProviderVideo(
        { id: "video-1", title: "Title", upload_date: "20260822", duration: 42 },
        "UC1234567890123456789012",
      ),
    ).toMatchObject({
      videoId: "video-1",
      channelId: "UC1234567890123456789012",
      durationSeconds: 42,
    });
  });

  it("keeps a non-integral duration missing instead of passing an invalid Prisma Int", () => {
    expect(
      normalizeProviderVideo(
        {
          id: "video-1",
          channel_id: "UC1234567890123456789012",
          duration: 42.5,
        },
        "UC1234567890123456789012",
      ),
    ).toMatchObject({ durationSeconds: null });
  });
});
