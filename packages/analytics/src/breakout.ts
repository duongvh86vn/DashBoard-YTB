import { median, percentile } from "./percentiles.js";

export interface BreakoutBenchmark {
  median: number | null;
  p75: number | null;
  p90: number | null;
  sampleSize: number;
}

export function calculateBenchmark(values: readonly bigint[]): BreakoutBenchmark {
  const numeric = values.filter((value) => value >= 0n).map(Number);
  return {
    median: median(numeric),
    p75: percentile(numeric, 0.75),
    p90: percentile(numeric, 0.9),
    sampleSize: numeric.length,
  };
}

export function calculateBreakoutMultiple(
  currentViews: bigint | null,
  comparableViews: readonly bigint[],
): number | null {
  if (currentViews === null) return null;
  const benchmark = calculateBenchmark(comparableViews).median;
  if (benchmark === null || benchmark <= 0) return null;
  return Number(currentViews) / benchmark;
}
