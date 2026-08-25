import { describe, expect, it, vi } from "vitest";

import { ChannelDataScheduler, localCalendarDate } from "./channel-data.scheduler.js";

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("ChannelDataScheduler", () => {
  it("collects only never-scanned channels on the fast path and backs off partial retries", async () => {
    let now = new Date("2026-08-25T01:00:00.000Z");
    const run = vi.fn().mockResolvedValue("PARTIAL");
    const channels = [
      { id: "new", lastChannelScanAt: null },
      { id: "known", lastChannelScanAt: new Date("2026-08-25T00:00:00.000Z") },
    ];
    const scheduler = new ChannelDataScheduler({
      channels: { listEnabled: async () => channels as never },
      stats: { run } as never,
      daily: { run: vi.fn() } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      initialRetryMs: 15 * 60_000,
      timeZone: "Asia/Bangkok",
      now: () => now,
    });

    await scheduler.runInitialStatsOnce();
    await scheduler.runInitialStatsOnce();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));

    now = new Date(now.getTime() + 15 * 60_000);
    await scheduler.runInitialStatsOnce();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("collects a fresh snapshot before finalizing the 00:10 local daily row", async () => {
    const initial = { id: "channel", lastChannelScanAt: null, subscriberCount: null };
    const refreshed = {
      id: "channel",
      lastChannelScanAt: new Date("2026-08-24T17:10:00.000Z"),
      subscriberCount: 123n,
    };
    const listEnabled = vi.fn().mockResolvedValueOnce([initial]).mockResolvedValueOnce([refreshed]);
    const stats = vi.fn().mockResolvedValue("SUCCESS");
    const daily = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ChannelDataScheduler({
      channels: { listEnabled },
      stats: { run: stats } as never,
      daily: { run: daily, needsFinalization: async () => true } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-24T17:10:20.000Z"),
    });

    await scheduler.runDailyIfDue();
    await scheduler.runDailyIfDue();

    expect(stats).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledWith(refreshed, { freshCollectionSucceeded: true });
  });

  it("does not finalize outside 00:10 and resolves calendar dates in the configured zone", async () => {
    const listEnabled = vi.fn();
    const scheduler = new ChannelDataScheduler({
      channels: { listEnabled },
      stats: { run: vi.fn() } as never,
      daily: { run: vi.fn() } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-24T17:09:59.000Z"),
    });

    await scheduler.runDailyIfDue();
    expect(listEnabled).not.toHaveBeenCalled();
    expect(localCalendarDate(new Date("2026-08-24T18:00:00.000Z"), "Asia/Bangkok")).toBe(
      "2026-08-25",
    );
  });

  it("catches up a missing daily row when the worker starts after 00:10", async () => {
    const channel = { id: "channel", lastChannelScanAt: null };
    const stats = vi.fn().mockResolvedValue("SUCCESS");
    const daily = vi.fn().mockResolvedValue(undefined);
    const scheduler = new ChannelDataScheduler({
      channels: { listEnabled: async () => [channel] as never },
      stats: { run: stats } as never,
      daily: { run: daily, needsFinalization: async () => true } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-25T05:00:00.000Z"),
    });

    await scheduler.runDailyIfDue();

    expect(stats).toHaveBeenCalledOnce();
    expect(daily).toHaveBeenCalledOnce();
  });

  it("does no collection work after restart when today's canonical row already exists", async () => {
    const channel = { id: "channel", lastChannelScanAt: null };
    const stats = vi.fn();
    const run = vi.fn();
    const needsFinalization = vi.fn().mockResolvedValue(false);
    const scheduler = new ChannelDataScheduler({
      channels: { listEnabled: async () => [channel] as never },
      stats: { run: stats } as never,
      daily: { run, needsFinalization } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-25T05:00:00.000Z"),
    });

    await scheduler.runDailyIfDue();

    expect(needsFinalization).toHaveBeenCalledWith("channel");
    expect(stats).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("starts and stops all polling timers idempotently", () => {
    vi.useFakeTimers();
    try {
      const scheduler = new ChannelDataScheduler({
        channels: { listEnabled: async () => [] },
        stats: { run: vi.fn() } as never,
        daily: { run: vi.fn() } as never,
        logger: logger(),
        statsIntervalMs: 6 * 60 * 60_000,
        timeZone: "Asia/Bangkok",
      });
      scheduler.start();
      scheduler.start();
      expect(vi.getTimerCount()).toBe(3);
      scheduler.stop();
      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never overlaps initial and scheduled collection passes", async () => {
    let release!: (value: "SUCCESS") => void;
    const run = vi.fn(
      () =>
        new Promise<"SUCCESS">((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = new ChannelDataScheduler({
      channels: {
        listEnabled: async () => [{ id: "channel", lastChannelScanAt: null }] as never,
      },
      stats: { run } as never,
      daily: { run: vi.fn() } as never,
      logger: logger(),
      statsIntervalMs: 6 * 60 * 60_000,
      timeZone: "Asia/Bangkok",
    });

    const scheduled = scheduler.runScheduledStatsOnce();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await scheduler.runInitialStatsOnce();
    expect(run).toHaveBeenCalledTimes(1);
    release("SUCCESS");
    await scheduled;
  });
});
