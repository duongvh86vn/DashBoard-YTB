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
});
