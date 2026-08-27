import { describe, expect, it, vi } from "vitest";

import { VideoCatalogScanRepository } from "./video-catalog-scan.repository.js";

describe("VideoCatalogScanRepository", () => {
  it("claims one immutable coverage record per channel and local date", async () => {
    const date = new Date("2026-08-27T00:00:00.000Z");
    const capturedAt = new Date("2026-08-27T00:20:00.000Z");
    const snapshotBucket = new Date("2026-08-26T17:00:00.000Z");
    const record = {
      id: "scan-1",
      channelId: "channel-1",
      date,
      capturedAt,
      snapshotBucket,
      totalVideos: 183,
      videosWithViews: 180,
      coverageStatus: "PARTIAL",
      createdAt: capturedAt,
      updatedAt: capturedAt,
    } as const;
    const createMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => record);
    const repository = new VideoCatalogScanRepository({
      videoCatalogScan: { createMany, findUnique },
    } as never);

    await expect(
      repository.createIfAbsent({
        channelId: "channel-1",
        date,
        capturedAt,
        snapshotBucket,
        totalVideos: 183,
        videosWithViews: 180,
        coverageStatus: "PARTIAL",
      }),
    ).resolves.toEqual({ created: true, record });

    expect(createMany).toHaveBeenCalledWith({
      data: {
        channelId: "channel-1",
        date,
        capturedAt,
        snapshotBucket,
        totalVideos: 183,
        videosWithViews: 180,
        coverageStatus: "PARTIAL",
      },
      skipDuplicates: true,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { channelId_date: { channelId: "channel-1", date } },
    });
  });

  it("keeps an empty scoped lookup bounded", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new VideoCatalogScanRepository({
      videoCatalogScan: { findMany },
    } as never);

    await expect(
      repository.listByChannelsAndDateRange(
        [],
        new Date("2026-08-26T00:00:00.000Z"),
        new Date("2026-08-27T00:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
