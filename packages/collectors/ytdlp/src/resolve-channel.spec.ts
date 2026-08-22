import { describe, expect, it } from "vitest";

import { RESOLVE_CHANNEL_ARGS, resolveChannelWithYtdlp } from "./resolve-channel.js";

describe("resolveChannelWithYtdlp", () => {
  it("uses a metadata-only command and persists only canonical resolution", async () => {
    let observedArgs: readonly string[] = [];
    const result = await resolveChannelWithYtdlp("@example_handle", {
      run: async (args) => {
        observedArgs = args;
        return {
          stdout: JSON.stringify({
            channel_id: "UC1234567890123456789012",
            channel: "Example",
            uploader: "@example_handle",
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });
    expect(observedArgs).toEqual([
      ...RESOLVE_CHANNEL_ARGS,
      "https://www.youtube.com/@example_handle",
    ]);
    expect(result).toMatchObject({
      youtubeChannelId: "UC1234567890123456789012",
      title: "Example",
    });
  });

  it("returns null when yt-dlp cannot find a canonical id", async () => {
    await expect(
      resolveChannelWithYtdlp("@example_handle", {
        run: async () => ({
          stdout: JSON.stringify({ uploader: "Example" }),
          stderr: "",
          exitCode: 0,
        }),
      }),
    ).resolves.toBeNull();
  });
});
