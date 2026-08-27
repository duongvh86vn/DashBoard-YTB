export type { CoverageResult, MetricSnapshot, WeeklyGainResult } from "./contracts.js";
export { calculateCoverage, type CoverageDayStatus } from "./coverage.js";
export {
  calculateBenchmark,
  calculateBreakoutMultiple,
  type BreakoutBenchmark,
} from "./breakout.js";
export { median, percentile } from "./percentiles.js";
export {
  rankBreakout,
  rankHot,
  rankWeekly,
  type BreakoutRankingCandidate,
  type HotRankingCandidate,
} from "./rankings.js";
export { calculateSmoothedVph, calculateVph } from "./vph.js";
export { calculateWeeklyGain, type WeeklyGainInput } from "./weekly-gain.js";
export {
  calculateEstimatedRevenueMicros,
  formatRpmMicros,
  formatUsdMicros,
  parseRpmMicros,
} from "./revenue.js";
