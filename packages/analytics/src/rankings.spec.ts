import { describe, expect, it } from "vitest";

import { rankBreakout, rankHot, rankWeekly } from "./rankings.js";

const base = { channelId: "channel-a", publishedAt: new Date("2026-08-20T00:00:00.000Z") };

describe("independent video rankings", () => {
  it("sorts weekly by signed seven-day gain, not lifetime views", () => {
    const result = rankWeekly(
      [
        {
          ...base,
          id: "b",
          snapshots: [
            { capturedAt: new Date("2026-08-15T00:00:00.000Z"), views: 50_000n },
            { capturedAt: new Date("2026-08-22T00:00:00.000Z"), views: 90_000n },
          ],
        },
        {
          ...base,
          id: "a",
          snapshots: [
            { capturedAt: new Date("2026-08-15T00:00:00.000Z"), views: 10_000n },
            { capturedAt: new Date("2026-08-22T00:00:00.000Z"), views: 60_000n },
          ],
        },
      ],
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result[0]?.weeklyGain).toBe(50_000n);
  });

  it("keeps warm-up rows out of weekly ranking", () => {
    expect(
      rankWeekly(
        [
          {
            ...base,
            id: "warming",
            snapshots: [{ capturedAt: new Date("2026-08-22T00:00:00.000Z"), views: 1n }],
          },
        ],
        new Date("2026-08-22T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("keeps Hot Now and Breakout as separate orderings", () => {
    const rows = [
      { id: "slow", vph1h: 100, vph3h: 100, breakout: 9 },
      { id: "hot", vph1h: 200, vph3h: 200, breakout: 2 },
    ];
    expect(rankHot(rows).map((item) => item.id)).toEqual(["hot", "slow"]);
    expect(rankBreakout(rows).map((item) => item.id)).toEqual(["slow", "hot"]);
  });
});
