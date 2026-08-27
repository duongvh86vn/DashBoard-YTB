import { describe, expect, it, vi } from "vitest";

import { YtdlpError } from "./errors.js";
import {
  FULL_CATALOG_ARGS,
  FULL_CATALOG_MAX_OUTPUT_BYTES,
  FULL_CATALOG_TIMEOUT_MS,
  listFullCatalogWithYtdlp,
  parseFullCatalogJson,
  youtubeUploadsPlaylistUrl,
} from "./full-catalog.js";
import { assertMetadataOnlyArgs } from "./process-runner.js";
import type { YtdlpRunner } from "./resolve-channel.js";

const CHANNEL_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";

describe("full yt-dlp catalog", () => {
  it("derives the single uploads playlist that spans videos, Shorts, and live uploads", () => {
    expect(youtubeUploadsPlaylistUrl(CHANNEL_ID)).toBe(
      "https://www.youtube.com/playlist?list=UUaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(() => youtubeUploadsPlaylistUrl("not-a-channel-id")).toThrowError(
      expect.objectContaining({ code: "YTDLP_FAILED" }),
    );
  });

  it("uses bounded metadata-only arguments without truncating the playlist", async () => {
    const run = vi.fn<YtdlpRunner["run"]>(async () => ({
      stdout: JSON.stringify({ entries: [] }),
      stderr: "",
      exitCode: 0,
    }));
    const uploadsUrl = youtubeUploadsPlaylistUrl(CHANNEL_ID);

    await listFullCatalogWithYtdlp(uploadsUrl, CHANNEL_ID, { run } satisfies YtdlpRunner);

    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toEqual([...FULL_CATALOG_ARGS, uploadsUrl]);
    expect(args.join(" ")).not.toContain("/videos");
    expect(args).not.toContain("--playlist-end");
    expect(() => assertMetadataOnlyArgs(args)).not.toThrow();
    expect(FULL_CATALOG_TIMEOUT_MS).toBe(300_000);
    expect(FULL_CATALOG_MAX_OUTPUT_BYTES).toBe(32 * 1024 * 1024);
  });

  it("normalizes metadata and nullable counters from flat-playlist entries", () => {
    const result = parseFullCatalogJson(
      JSON.stringify({
        entries: [
          {
            id: "video-b",
            channel_id: CHANNEL_ID,
            title: "  Video B  ",
            url: "https://www.youtube.com/watch?v=video-b&utm_source=test",
            timestamp: 1_700_000_000,
            duration: 42,
            view_count: "1234",
            like_count: 50,
            comment_count: null,
          },
          {
            id: "video-a",
            channel_id: CHANNEL_ID,
            title: "Video A",
            view_count: null,
            like_count: "7",
            comment_count: "3",
          },
        ],
      }),
      CHANNEL_ID,
    );

    expect(result).toEqual({
      videos: [
        expect.objectContaining({
          videoId: "video-a",
          channelId: CHANNEL_ID,
          title: "Video A",
          viewCount: null,
          likeCount: 7n,
          commentCount: 3n,
        }),
        expect.objectContaining({
          videoId: "video-b",
          channelId: CHANNEL_ID,
          title: "Video B",
          durationSeconds: 42,
          viewCount: 1234n,
          likeCount: 50n,
          commentCount: null,
        }),
      ],
      sourceEntryCount: 2,
      skippedEntryCount: 0,
      missingViewCount: 1,
    });
  });

  it("tracks malformed and cross-channel entries instead of claiming completeness", () => {
    const result = parseFullCatalogJson(
      JSON.stringify({
        entries: [
          null,
          { title: "missing id" },
          {
            id: "foreign-video",
            channel_id: "UCbbbbbbbbbbbbbbbbbbbbbb",
            view_count: 10,
          },
          { id: "kept-video", channel_id: CHANNEL_ID, view_count: 0 },
        ],
      }),
      CHANNEL_ID,
    );

    expect(result.videos.map((video) => video.videoId)).toEqual(["kept-video"]);
    expect(result.sourceEntryCount).toBe(4);
    expect(result.skippedEntryCount).toBe(3);
    expect(result.missingViewCount).toBe(0);
  });

  it("marks a truncated catalog partial when yt-dlp declares more playlist entries", () => {
    const result = parseFullCatalogJson(
      JSON.stringify({
        playlist_count: 2,
        entries: [{ id: "kept-video", channel_id: CHANNEL_ID, view_count: 10 }],
      }),
      CHANNEL_ID,
    );

    expect(result).toMatchObject({
      sourceEntryCount: 2,
      skippedEntryCount: 1,
      missingViewCount: 0,
    });
    expect(result.videos).toHaveLength(1);
  });

  it("rejects malformed catalog envelopes", () => {
    expect(() => parseFullCatalogJson("not-json", CHANNEL_ID)).toThrowError(YtdlpError);
    expect(() => parseFullCatalogJson(JSON.stringify({}), CHANNEL_ID)).toThrowError(
      expect.objectContaining({ code: "YTDLP_INVALID_JSON" }),
    );
  });

  it("normalizes unexpected runner failures", async () => {
    const runner: YtdlpRunner = {
      run: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    };

    await expect(
      listFullCatalogWithYtdlp("https://youtube.example/channel", CHANNEL_ID, runner),
    ).rejects.toMatchObject({ code: "YTDLP_FAILED" });
  });
});
