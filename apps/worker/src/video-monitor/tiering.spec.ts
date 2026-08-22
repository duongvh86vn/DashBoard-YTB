import { describe, expect, it } from "vitest";

import { shouldRetainVideo, tierVideo } from "./tiering.js";

const now = new Date("2026-08-22T00:00:00.000Z");
const atDays = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("video tiering", () => {
  it.each([
    [0, "HOT"],
    [7, "HOT"],
    [8, "WARM"],
    [30, "WARM"],
    [31, "ARCHIVED"],
  ])("keeps the %s-day boundary deterministic", (days, tier) => {
    expect(
      tierVideo({
        publishedAt: atDays(days),
        now,
        previousTier: null,
        isPinned: false,
        localVph1h: null,
      }).tier,
    ).toBe(tier);
  });

  it("keeps pinned videos in the candidate pool regardless of age", () => {
    expect(
      tierVideo({
        publishedAt: atDays(365),
        now,
        previousTier: null,
        isPinned: true,
        localVph1h: null,
      }),
    ).toMatchObject({ tier: "PINNED", candidate: true });
  });

  it("retains old HOT videos and reactivates a stale candidate", () => {
    expect(
      tierVideo({
        publishedAt: atDays(90),
        now,
        previousTier: "HOT",
        isPinned: false,
        localVph1h: null,
      }),
    ).toMatchObject({ tier: "OLD_HOT", candidate: true });
    expect(
      tierVideo({
        publishedAt: atDays(90),
        now,
        previousTier: "ARCHIVED",
        isPinned: false,
        localVph1h: null,
        recentlyReactivated: true,
      }),
    ).toMatchObject({ tier: "OLD_HOT", candidate: true });
  });

  it("does not invent an age when publishedAt is unavailable", () => {
    expect(
      tierVideo({ publishedAt: null, now, previousTier: null, isPinned: false, localVph1h: null }),
    ).toMatchObject({ tier: "HOT", ageDays: null, candidate: true });
  });

  it("keeps deterministic high-VPH videos HOT and retains active history", () => {
    expect(
      tierVideo({
        publishedAt: atDays(365),
        now,
        previousTier: "ARCHIVED",
        isPinned: false,
        localVph1h: 1_000,
      }).tier,
    ).toBe("HOT");
    expect(
      shouldRetainVideo({
        publishedAt: atDays(365),
        now,
        isPinned: false,
        monitorTier: "HOT",
      }),
    ).toBe(true);
    expect(
      shouldRetainVideo({
        publishedAt: atDays(365),
        now,
        isPinned: false,
        monitorTier: "ARCHIVED",
      }),
    ).toBe(false);
  });
});
