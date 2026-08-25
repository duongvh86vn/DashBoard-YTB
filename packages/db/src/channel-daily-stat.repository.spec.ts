import { describe, expect, it, vi } from "vitest";

import { ChannelDailyStatRepository } from "./channel-daily-stat.repository.js";

describe("ChannelDailyStatRepository range reads", () => {
  it("loads only requested channels and inclusive calendar dates in stable order", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new ChannelDailyStatRepository({
      channelDailyStat: { findMany },
    } as never);
    const startDate = new Date("2026-07-28T00:00:00.000Z");
    const endDate = new Date("2026-08-25T00:00:00.000Z");

    await expect(
      repository.listByChannelsAndDateRange(["channel-b", "channel-a"], startDate, endDate),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        channelId: { in: ["channel-b", "channel-a"] },
        date: { gte: startDate, lte: endDate },
      },
      orderBy: [{ date: "asc" }, { channelId: "asc" }],
    });
  });

  it("does not issue an unbounded query when there are no enabled channels", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new ChannelDailyStatRepository({
      channelDailyStat: { findMany },
    } as never);

    await expect(
      repository.listByChannelsAndDateRange([], new Date(0), new Date()),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
