import type { ProviderVideoStats } from "@yt-monitor/shared";

import { readNullableCount } from "./normalize.js";
import { runProcess } from "./process-runner.js";
import type { YtdlpRunner } from "./resolve-channel.js";
import { YtdlpError } from "./errors.js";

export const VIDEO_STATS_ARGS = [
  "--dump-single-json",
  "--skip-download",
  "--no-warnings",
  "--no-playlist",
] as const;

export async function getVideoStatsWithYtdlp(
  videoIds: string[],
  runner: YtdlpRunner = { run: (args) => runProcess(args) },
  capturedAt = new Date(),
): Promise<ProviderVideoStats[]> {
  const results: ProviderVideoStats[] = [];
  for (const videoId of [...new Set(videoIds)]) {
    let processResult;
    try {
      processResult = await runner.run([
        ...VIDEO_STATS_ARGS,
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
    } catch (error) {
      if (error instanceof YtdlpError) throw error;
      throw new YtdlpError("YTDLP_FAILED");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(processResult.stdout) as unknown;
    } catch {
      throw new YtdlpError("YTDLP_INVALID_JSON");
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : videoId;
    results.push({
      videoId: id,
      viewCount: readNullableCount(record.view_count),
      likeCount: readNullableCount(record.like_count),
      commentCount: readNullableCount(record.comment_count),
      capturedAt,
    });
  }
  return results;
}
