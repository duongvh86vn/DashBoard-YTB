import type { MetricSnapshot } from "./contracts.js";
import { calculateSmoothedVph } from "./vph.js";
import { calculateWeeklyGain } from "./weekly-gain.js";

export function rankWeekly<T extends { id: string; snapshots: readonly MetricSnapshot[] }>(
  videos: readonly T[],
  now: Date,
): Array<T & { weeklyGain: bigint; baselineAt: Date }> {
  return videos
    .flatMap((video) => {
      const result = calculateWeeklyGain({ snapshots: video.snapshots, now });
      return result.status === "READY"
        ? [{ ...video, weeklyGain: result.gain, baselineAt: result.baselineAt }]
        : [];
    })
    .sort((left, right) => {
      if (left.weeklyGain !== right.weeklyGain) return left.weeklyGain > right.weeklyGain ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
}

export interface HotRankingCandidate {
  id: string;
  vph1h: number | null;
  vph3h: number | null;
}

export function rankHot<T extends HotRankingCandidate>(
  videos: readonly T[],
): Array<T & { smoothedVph: number }> {
  return videos
    .flatMap((video) => {
      const score = calculateSmoothedVph(video);
      return score === null ? [] : [{ ...video, smoothedVph: score }];
    })
    .sort((left, right) => right.smoothedVph - left.smoothedVph || left.id.localeCompare(right.id));
}

export interface BreakoutRankingCandidate {
  id: string;
  breakout: number | null;
}

export function rankBreakout<T extends BreakoutRankingCandidate>(
  videos: readonly T[],
): Array<T & { breakout: number }> {
  return videos
    .flatMap((video) => {
      const score = video.breakout;
      return score === null ? [] : [{ ...video, breakout: score }];
    })
    .sort((left, right) => right.breakout - left.breakout || left.id.localeCompare(right.id));
}
