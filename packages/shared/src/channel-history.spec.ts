import { describe, expect, it } from "vitest";

import {
  deriveActivityStatus,
  deriveCoverageStatus,
  deriveMetricDeltas,
  localCalendarDate,
  previousCalendarDate,
} from "./channel-history.js";

describe("channel history rules", () => {
  const now = new Date("2026-08-22T00:00:00.000Z");

  it("separates no history, recent activity, and dormant channels", () => {
    expect(deriveActivityStatus(null, now, 30)).toBe("NO_UPLOAD_HISTORY");
    expect(deriveActivityStatus(new Date("2026-08-01T00:00:00.000Z"), now, 30)).toBe(
      "ACTIVE_RECENT",
    );
    expect(deriveActivityStatus(new Date("2026-07-01T00:00:00.000Z"), now, 30)).toBe("DORMANT");
  });

  it("keeps negative corrections and leaves missing baselines null", () => {
    expect(
      deriveMetricDeltas(
        { subscriberCount: 10n, videoCount: 4n, lifetimeViewCount: 90n },
        { subscriberCount: 12n, videoCount: 3n, lifetimeViewCount: 100n },
      ),
    ).toEqual({ subscriberDelta: -2n, videoDelta: 1n, viewDelta: -10n });
    expect(
      deriveMetricDeltas({ subscriberCount: 1n, videoCount: null, lifetimeViewCount: 2n }, null),
    ).toEqual({ subscriberDelta: null, videoDelta: null, viewDelta: null });
  });

  it("uses complete coverage only when every canonical metric is present", () => {
    expect(
      deriveCoverageStatus({ subscriberCount: 1n, videoCount: 2n, lifetimeViewCount: 3n }),
    ).toBe("COMPLETE");
    expect(
      deriveCoverageStatus({ subscriberCount: 1n, videoCount: null, lifetimeViewCount: 3n }),
    ).toBe("PARTIAL");
  });

  it("calculates the configured local calendar boundary", () => {
    expect(localCalendarDate(new Date("2026-08-21T17:30:00.000Z"), "Asia/Bangkok")).toBe(
      "2026-08-22",
    );
    expect(previousCalendarDate("2026-08-22")).toBe("2026-08-21");
  });
});
