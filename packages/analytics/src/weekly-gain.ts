import type { MetricSnapshot, WeeklyGainResult } from "./contracts.js";

const DEFAULT_BASELINE_TOLERANCE_MS = 24 * 60 * 60 * 1_000;

export interface WeeklyGainInput {
  snapshots: readonly MetricSnapshot[];
  now?: Date;
  windowDays?: number;
  baselineToleranceMs?: number;
}

export function calculateWeeklyGain(input: WeeklyGainInput): WeeklyGainResult {
  const now = input.now ?? new Date();
  const windowMs = (input.windowDays ?? 7) * 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return { status: "WARMING_UP" };
  const ordered = [...input.snapshots].sort(
    (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
  );
  const latest = [...ordered]
    .reverse()
    .find((snapshot) => snapshot.capturedAt.getTime() <= now.getTime() && snapshot.views !== null);
  if (!latest || latest.views === null) return { status: "WARMING_UP" };

  const cutoff = now.getTime() - windowMs;
  const baseline = [...ordered]
    .reverse()
    .find((snapshot) => snapshot.capturedAt.getTime() <= cutoff && snapshot.views !== null);
  if (!baseline || baseline.views === null) return { status: "WARMING_UP" };
  const tolerance = input.baselineToleranceMs ?? DEFAULT_BASELINE_TOLERANCE_MS;
  if (cutoff - baseline.capturedAt.getTime() > tolerance) return { status: "WARMING_UP" };
  return {
    status: "READY",
    gain: latest.views - baseline.views,
    baselineAt: baseline.capturedAt,
  };
}
