import { describe, expect, it, vi } from "vitest";

import { DailyFinalizeJob } from "./daily-finalize.job.js";

describe("DailyFinalizeJob", () => {
  it("preflights the canonical local-date row without replacing PARTIAL", async () => {
    const findByChannelAndDate = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ coverageStatus: "PARTIAL" });
    const job = new DailyFinalizeJob({
      timeZone: "Asia/Bangkok",
      currentDate: () => "2026-08-22",
      unitOfWork: {
        transaction: async (work) => work({ dailyStats: { findByChannelAndDate } } as never),
      },
    });

    await expect(job.needsFinalization("channel-id")).resolves.toBe(true);
    await expect(job.needsFinalization("channel-id")).resolves.toBe(false);
    expect(findByChannelAndDate).toHaveBeenNthCalledWith(
      1,
      "channel-id",
      new Date("2026-08-22T00:00:00.000Z"),
    );
  });

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
    await job.run(
      {
        id: "channel-id",
        subscriberCount: 10n,
        videoCount: 2n,
        lifetimeViewCount: 100n,
        lastChannelScanAt: new Date("2026-08-22T00:00:00.000Z"),
      } as never,
      { freshCollectionSucceeded: true },
    );
    expect(input).toMatchObject({
      subscriberDelta: null,
      videoDelta: null,
      viewDelta: null,
      coverageStatus: "COMPLETE",
    });
  });

  it("writes a partial null row instead of reusing stale current metrics", async () => {
    let input: Record<string, unknown> | undefined;
    const job = new DailyFinalizeJob({
      timeZone: "Asia/Bangkok",
      currentDate: () => "2026-08-22",
      unitOfWork: {
        transaction: async (work) =>
          work({
            dailyStats: {
              findByChannelAndDate: async (_channelId: string, date: Date) =>
                date.toISOString().startsWith("2026-08-21")
                  ? {
                      subscriberCount: 9n,
                      videoCount: 1n,
                      lifetimeViewCount: 90n,
                    }
                  : null,
              upsert: async (value: unknown) => {
                input = value as Record<string, unknown>;
                return value as never;
              },
            },
          } as never),
      },
    });

    await job.run(
      {
        id: "channel-id",
        subscriberCount: 10n,
        videoCount: 2n,
        lifetimeViewCount: 100n,
        lastChannelScanAt: new Date("2026-08-21T00:00:00.000Z"),
      } as never,
      { freshCollectionSucceeded: false },
    );

    expect(input).toMatchObject({
      subscriberCount: null,
      videoCount: null,
      lifetimeViewCount: null,
      subscriberDelta: null,
      videoDelta: null,
      viewDelta: null,
      coverageStatus: "PARTIAL",
      sourceSummary: {
        subscriberCount: { source: "MISSING_FRESH_COLLECTION", capturedAt: null },
      },
    });
  });

  it("does not overwrite a canonical row that was already finalized today", async () => {
    let writes = 0;
    const job = new DailyFinalizeJob({
      timeZone: "Asia/Bangkok",
      currentDate: () => "2026-08-22",
      unitOfWork: {
        transaction: async (work) =>
          work({
            dailyStats: {
              findByChannelAndDate: async (_channelId: string, date: Date) =>
                date.toISOString().startsWith("2026-08-22") ? { id: "existing" } : null,
              upsert: async () => {
                writes += 1;
                return {} as never;
              },
            },
          } as never),
      },
    });

    await job.run(
      {
        id: "channel-id",
        subscriberCount: 11n,
        videoCount: 3n,
        lifetimeViewCount: 120n,
        lastChannelScanAt: new Date("2026-08-22T12:00:00.000Z"),
      } as never,
      { freshCollectionSucceeded: true },
    );

    expect(writes).toBe(0);
  });
});
