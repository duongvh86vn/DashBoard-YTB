export interface MetricSnapshot {
  capturedAt: Date;
  views: bigint | null;
}

export type WeeklyGainResult =
  { status: "READY"; gain: bigint; baselineAt: Date } | { status: "WARMING_UP" };

export interface CoverageResult {
  requestedDays: number;
  completeDays: number;
  partialDays: number;
  coveragePercent: number;
}
