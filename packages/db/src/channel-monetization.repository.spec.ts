import { describe, expect, it, vi } from "vitest";

import { ChannelMonetizationRepository } from "./channel-monetization.repository.js";

const effectiveDate = new Date("2026-08-27T00:00:00.000Z");

describe("ChannelMonetizationRepository", () => {
  it("upserts one USD setting per channel and effective date", async () => {
    const upsert = vi.fn(async (input) => input);
    const repository = new ChannelMonetizationRepository({
      channelMonetizationSetting: { upsert },
    } as never);

    await repository.upsert({
      channelId: "channel-1",
      effectiveDate,
      isMonetized: true,
      rpmMicros: 1_250_000n,
      recordedByUserId: "admin-1",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        channelId_effectiveDate: { channelId: "channel-1", effectiveDate },
      },
      create: {
        channelId: "channel-1",
        effectiveDate,
        isMonetized: true,
        rpmMicros: 1_250_000n,
        currency: "USD",
        recordedByUserId: "admin-1",
      },
      update: {
        isMonetized: true,
        rpmMicros: 1_250_000n,
        currency: "USD",
        recordedByUserId: "admin-1",
      },
    });
  });

  it("returns one latest effective row per channel in stable order", async () => {
    const older = {
      id: "setting-1",
      channelId: "channel-1",
      effectiveDate: new Date("2026-08-20T00:00:00.000Z"),
    };
    const latest = { ...older, id: "setting-2", effectiveDate };
    const other = { ...older, id: "setting-3", channelId: "channel-2" };
    const findMany = vi.fn(async () => [latest, older, other]);
    const repository = new ChannelMonetizationRepository({
      channelMonetizationSetting: { findMany },
    } as never);

    await expect(
      repository.latestEffectiveForChannels(["channel-1", "channel-2"], effectiveDate),
    ).resolves.toEqual([latest, other]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        channelId: { in: ["channel-1", "channel-2"] },
        effectiveDate: { lte: effectiveDate },
      },
      orderBy: [
        { channelId: "asc" },
        { effectiveDate: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
    });
  });

  it("does not issue an unbounded query for an empty channel selection", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new ChannelMonetizationRepository({
      channelMonetizationSetting: { findMany },
    } as never);

    await expect(repository.latestEffectiveForChannels([], effectiveDate)).resolves.toEqual([]);
    await expect(repository.listEffectiveThroughDate([], effectiveDate)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
