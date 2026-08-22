import type { CoverageResult } from "./contracts.js";

export type CoverageDayStatus = "COMPLETE" | "PARTIAL";

export function calculateCoverage(input: {
  requestedDays: number;
  statuses: readonly CoverageDayStatus[];
}): CoverageResult {
  const requestedDays = Math.max(0, Math.floor(input.requestedDays));
  const completeDays = Math.min(
    requestedDays,
    input.statuses.filter((status) => status === "COMPLETE").length,
  );
  const partialDays = Math.max(0, requestedDays - completeDays);
  return {
    requestedDays,
    completeDays,
    partialDays,
    coveragePercent:
      requestedDays === 0 ? 0 : Number(((completeDays / requestedDays) * 100).toFixed(2)),
  };
}
