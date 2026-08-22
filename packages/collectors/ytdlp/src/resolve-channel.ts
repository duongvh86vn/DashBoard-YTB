import type { ResolvedChannel } from "@yt-monitor/shared";

import { YtdlpError } from "./errors.js";
import {
  normalizeChannelInput,
  normalizeResolvedChannel,
  type NormalizedChannelInput,
} from "./normalize.js";
import { runProcess, type ProcessRunnerOptions } from "./process-runner.js";

export const RESOLVE_CHANNEL_ARGS = [
  "--dump-single-json",
  "--skip-download",
  "--no-warnings",
  "--no-playlist",
] as const;

export interface YtdlpRunner {
  run(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

function resolveTarget(input: NormalizedChannelInput): string {
  return input.canonicalUrl;
}

export async function resolveChannelWithYtdlp(
  input: string,
  runner: YtdlpRunner = {
    run: (args) => runProcess(args),
  },
): Promise<ResolvedChannel | null> {
  const normalized = normalizeChannelInput(input);
  let result;
  try {
    result = await runner.run([...RESOLVE_CHANNEL_ARGS, resolveTarget(normalized)]);
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
  return normalizeResolvedChannel(parsed);
}

export function createYtdlpRunner(options: ProcessRunnerOptions = {}): YtdlpRunner {
  return { run: (args) => runProcess(args, options) };
}
