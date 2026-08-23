import { createHash } from "node:crypto";

export interface AnalysisFingerprintInput {
  channelId?: string;
  timeRange: string;
  videoIds: readonly string[];
  metricSummary: unknown;
  promptVersion: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function createAnalysisFingerprint(input: AnalysisFingerprintInput): string {
  const normalized = {
    channelId: input.channelId ?? null,
    metricSummary: canonicalize(input.metricSummary),
    promptVersion: input.promptVersion,
    timeRange: input.timeRange,
    videoIds: [...input.videoIds].sort(),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
