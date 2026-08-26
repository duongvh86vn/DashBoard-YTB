import { describe, expect, it, vi } from "vitest";

import { VideoRepository } from "./video.repository.js";

describe("VideoRepository published range", () => {
  it("uses an end-exclusive published-at range and selects no unrelated fields", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new VideoRepository({ video: { findMany } } as never);
    const start = new Date("2026-07-28T00:00:00.000Z");
    const endExclusive = new Date("2026-08-27T00:00:00.000Z");

    await expect(repository.listPublishedBetween(start, endExclusive)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { publishedAt: { gte: start, lt: endExclusive } },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      select: { channelId: true, publishedAt: true },
    });
  });

  it("summarizes current available videos but retains observed uploads that later disappear", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({
        _count: { _all: 50, durationSeconds: 48 },
        _sum: { durationSeconds: 201_600 },
      })
      .mockResolvedValueOnce({
        _max: { lastSeenAt: new Date("2026-08-25T00:00:00.000Z") },
      });
    const count = vi.fn(async () => 12);
    const repository = new VideoRepository({ video: { aggregate, count } } as never);
    const start = new Date("2026-07-27T00:00:00.000Z");
    const endExclusive = new Date("2026-08-26T00:00:00.000Z");

    await expect(
      repository.summarizePublicCatalog("channel-id", start, endExclusive),
    ).resolves.toEqual({
      knownPublicVideos: 50,
      durationKnownVideos: 48,
      durationSecondsTotal: 201_600,
      publishedVideos: 12,
      catalogObservedAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    expect(aggregate).toHaveBeenNthCalledWith(1, {
      where: { channelId: "channel-id", isAvailable: true },
      _count: { _all: true, durationSeconds: true },
      _sum: { durationSeconds: true },
    });
    expect(aggregate).toHaveBeenNthCalledWith(2, {
      where: { channelId: "channel-id" },
      _max: { lastSeenAt: true },
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        channelId: "channel-id",
        publishedAt: { gte: start, lt: endExclusive },
      },
    });
  });
});
