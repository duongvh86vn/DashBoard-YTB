import type { ProviderVideo } from "@yt-monitor/shared";

import { YtdlpError } from "./errors.js";
import { normalizeProviderVideo } from "./normalize.js";
import { runProcess } from "./process-runner.js";
import type { YtdlpRunner } from "./resolve-channel.js";

export const LIST_RECENT_VIDEOS_ARGS = [
  "--dump-single-json",
  "--skip-download",
  "--no-warnings",
  "--flat-playlist",
  "--playlist-end",
  "50",
] as const;

export async function listRecentVideosWithYtdlp(
  channelUrl: string,
  channelId: string,
  runner: YtdlpRunner = { run: (args) => runProcess(args) },
): Promise<ProviderVideo[]> {
  let result;
  try {
    result = await runner.run([...LIST_RECENT_VIDEOS_ARGS, channelUrl]);
  } catch (error) {
    if (error instanceof YtdlpError) throw error;
    throw new YtdlpError("YTDLP_FAILED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new YtdlpError("YTDLP_INVALID_JSON");
  }
  const entries =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : [];
  return entries.flatMap((entry) => {
    const normalized = normalizeProviderVideo(entry, channelId);
    return normalized ? [normalized] : [];
  });
}
