import { describe, expect, it } from "vitest";

import { DailyFinalizeJob } from "./daily-finalize.job.js";

describe("DailyFinalizeJob", () => {
  it("leaves deltas null when the previous calendar day is missing", async () => {
    let input: Record<string, unknown> | undefined;
    const job = new DailyFinalizeJob({
      timeZone: "Asia/Bangkok",
      currentDate: () => "2026-08-22",
      unitOfWork: {
        transaction: async (work) =>
          work({
            dailyStats: {
              findByChannelAndDate: async () => null,
              upsert: async (value: unknown) => {
                input = value as unknown as Record<string, unknown>;
                return value as never;
              },
            },
          } as never),
      },
    });
    await job.run({
      id: "channel-id",
      subscriberCount: 10n,
      videoCount: 2n,
      lifetimeViewCount: 100n,
      lastChannelScanAt: new Date("2026-08-22T00:00:00.000Z"),
    } as never);
    expect(input).toMatchObject({
      subscriberDelta: null,
      videoDelta: null,
      viewDelta: null,
      coverageStatus: "COMPLETE",
    });
  });
});
