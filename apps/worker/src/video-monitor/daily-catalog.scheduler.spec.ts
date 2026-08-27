import { describe, expect, it, vi } from "vitest";

import { DailyVideoCatalogScheduler } from "./daily-catalog.scheduler.js";

const channel = { id: "channel-1" };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("DailyVideoCatalogScheduler", () => {
  it("waits for the post-finalize boundary and skips an existing local-day scan", async () => {
    let now = new Date("2026-08-26T17:19:00.000Z"); // 00:19 Asia/Bangkok
    const run = vi.fn(async () => undefined);
    const findByChannelAndDate = vi.fn<
      () => Promise<null | { id: string; coverageStatus: "PARTIAL" }>
    >(async () => null);
    const scheduler = new DailyVideoCatalogScheduler({
      channels: { listEnabled: async () => [channel] } as never,
      scans: { findByChannelAndDate } as never,
      job: { run } as never,
      logger,
      timeZone: "Asia/Bangkok",
      now: () => now,
    });

    await scheduler.runIfDue();
    expect(run).not.toHaveBeenCalled();

    now = new Date("2026-08-26T17:20:00.000Z");
    await scheduler.runIfDue();
    expect(findByChannelAndDate).toHaveBeenCalledWith(
      channel.id,
      new Date("2026-08-27T00:00:00.000Z"),
    );
    expect(run).toHaveBeenCalledTimes(1);

    // PARTIAL is still the one canonical observation for that local day; do not
    // silently replace its evidence with a later retry.
    findByChannelAndDate.mockResolvedValueOnce({ id: "existing", coverageStatus: "PARTIAL" });
    await scheduler.runIfDue();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not overlap catalog passes", async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const scheduler = new DailyVideoCatalogScheduler({
      channels: { listEnabled: async () => [channel] } as never,
      scans: { findByChannelAndDate: async () => null } as never,
      job: { run } as never,
      logger,
      timeZone: "UTC",
      now: () => new Date("2026-08-27T01:00:00.000Z"),
    });

    const first = scheduler.runIfDue();
    await Promise.resolve();
    await scheduler.runIfDue();
    expect(run).toHaveBeenCalledTimes(1);
    release?.();
    await first;
  });

  it("stops safely when a long pass crosses into the next pre-boundary local day", async () => {
    const firstChannel = { id: "channel-1" };
    const secondChannel = { id: "channel-2" };
    const times = [
      new Date("2026-08-27T23:59:00.000Z"),
      new Date("2026-08-27T23:59:00.000Z"),
      new Date("2026-08-28T00:05:00.000Z"),
    ];
    const run = vi.fn(async () => undefined);
    const findByChannelAndDate = vi.fn(async () => null);
    const scheduler = new DailyVideoCatalogScheduler({
      channels: { listEnabled: async () => [firstChannel, secondChannel] } as never,
      scans: { findByChannelAndDate } as never,
      job: { run } as never,
      logger,
      timeZone: "UTC",
      now: () => times.shift() ?? new Date("2026-08-28T00:05:00.000Z"),
    });

    await scheduler.runIfDue();

    expect(findByChannelAndDate).toHaveBeenCalledOnce();
    expect(findByChannelAndDate).toHaveBeenCalledWith(
      firstChannel.id,
      new Date("2026-08-27T00:00:00.000Z"),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(firstChannel);
  });
});
