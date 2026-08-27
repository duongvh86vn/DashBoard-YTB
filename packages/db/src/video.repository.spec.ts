import { describe, expect, it, vi } from "vitest";

import { VideoRepository } from "./video.repository.js";

describe("VideoRepository published range", () => {
  it("loads every video that has one of the requested daily catalog buckets", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new VideoRepository({ video: { findMany } } as never);
    const baseline = new Date("2026-08-25T17:00:00.000Z");
    const current = new Date("2026-08-26T17:00:00.000Z");
    const method = (repository as unknown as Record<string, unknown>)[
      "listForCatalogComparison"
    ] as ((channelIds: string[], buckets: Date[]) => Promise<unknown>) | undefined;
    expect(method).toBeDefined();
    if (!method) return;

    await expect(method.call(repository, ["channel-1"], [baseline, current])).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        channelId: { in: ["channel-1"] },
        snapshots: {
          some: {
            source: "YTDLP_CATALOG",
            snapshotBucket: { in: [baseline, current] },
          },
        },
      },
      orderBy: [{ channelId: "asc" }, { id: "asc" }],
      include: {
        snapshots: {
          where: {
            source: "YTDLP_CATALOG",
            snapshotBucket: { in: [baseline, current] },
          },
          orderBy: [{ snapshotBucket: "asc" }, { id: "asc" }],
        },
        channel: { select: { id: true, title: true, thumbnail: true } },
      },
    });
  });

  it("intersects a direct ranking channel with an empty visible-channel scope", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new VideoRepository({ video: { findMany } } as never);

    await expect(
      repository.listForRanking({ channelId: "channel-id", channelIds: [] }),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        isAvailable: true,
        AND: [{ channelId: "channel-id" }, { channelId: { in: [] } }],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 5_000,
      include: {
        snapshots: {
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          take: 300,
        },
        channel: { select: { id: true, title: true, thumbnail: true } },
      },
    });
  });

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
