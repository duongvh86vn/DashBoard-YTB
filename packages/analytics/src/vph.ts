import type { MetricSnapshot } from "./contracts.js";

export function calculateVph(
  snapshots: readonly MetricSnapshot[],
  windowHours: number,
): number | null {
  if (!Number.isFinite(windowHours) || windowHours <= 0) return null;
  const ordered = [...snapshots].sort(
    (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
  );
  const latest = [...ordered].reverse().find((snapshot) => snapshot.views !== null);
  if (!latest || latest.views === null) return null;
  const cutoff = latest.capturedAt.getTime() - windowHours * 60 * 60 * 1_000;
  const baseline = [...ordered]
    .reverse()
    .find((snapshot) => snapshot.capturedAt.getTime() <= cutoff && snapshot.views !== null);
  if (!baseline || baseline.views === null) return null;
  const elapsedHours = (latest.capturedAt.getTime() - baseline.capturedAt.getTime()) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return null;
  return Number(latest.views - baseline.views) / elapsedHours;
}

export function calculateSmoothedVph(input: {
  vph1h: number | null;
  vph3h: number | null;
}): number | null {
  if (input.vph1h === null && input.vph3h === null) return null;
  if (input.vph1h === null) return input.vph3h;
  if (input.vph3h === null) return input.vph1h;
  return input.vph1h * 0.7 + input.vph3h * 0.3;
}
