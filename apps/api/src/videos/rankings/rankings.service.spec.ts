import { describe, expect, it } from "vitest";

import type { VideoRankingRecord } from "@yt-monitor/db";

import { ChannelApplicationError } from "../../channels/channel-application.error.js";
import { VideoRankingsService } from "./rankings.service.js";

const now = new Date("2026-08-22T12:00:00.000Z");
const channelId = "00000000-0000-4000-8000-000000000010";
const adminSubject = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN" as const,
};
const viewerSubject = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "VIEWER" as const,
};

function video(
  id: string,
  points: Array<[string, bigint | null]>,
  videoChannelId = channelId,
): VideoRankingRecord {
  return {
    id,
    youtubeVideoId: `youtube-${id}`,
    channelId: videoChannelId,
    title: id,
    description: null,
    thumbnail: null,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
    durationSeconds: null,
    currentViews: points.at(-1)?.[1] ?? null,
    currentLikes: null,
    currentComments: null,
    vph1h: null,
    vph3h: null,
    vph6h: null,
    breakout24h: null,
    breakout48h: null,
    breakout7d: null,
    monitorTier: "HOT",
    firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSeenAt: now,
    isAvailable: true,
    isPinned: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: now,
    snapshots: points.map(([capturedAt, views], index) => ({
      id: `${id}-snapshot-${index}`,
      videoId: id,
      channelId: videoChannelId,
      capturedAt: new Date(capturedAt),
      snapshotBucket: new Date(capturedAt),
      views,
      likes: null,
      comments: null,
      source: "YTDLP" as const,
      createdAt: new Date(capturedAt),
    })),
    channel: { id: videoChannelId, title: "Example", thumbnail: null },
  };
}

function service(
  videos: VideoRankingRecord[],
  visibleChannelIds: string[] | null = null,
  selectedChannelIds: string[] | null = visibleChannelIds,
) {
  return new VideoRankingsService({
    access: {
      resolveVisibleChannelIds: async () => visibleChannelIds,
      resolveSelectedChannelIds: async (_subject, selection) => {
        if (selection.groupId !== undefined) return selectedChannelIds;
        if (selection.channelId !== undefined) {
          if (visibleChannelIds !== null && !visibleChannelIds.includes(selection.channelId)) {
            throw ChannelApplicationError.notFound();
          }
          return [selection.channelId];
        }
        return visibleChannelIds;
      },
    },
    now: () => now,
    unitOfWork: {
      transaction: async (work) =>
        work({
          videos: {
            listForRanking: async (input: { channelId?: string; channelIds?: string[] }) =>
              videos.filter(
                (item) =>
                  (input.channelId === undefined || item.channelId === input.channelId) &&
                  (input.channelIds === undefined || input.channelIds.includes(item.channelId)),
              ),
            findById: async (id: string) => videos.find((item) => item.id === id) ?? null,
          },
          videoSnapshots: {
            list: async () => [],
            count: async () => 0,
          },
        } as never),
    },
  });
}

describe("VideoRankingsService", () => {
  it("keeps ADMIN ranking results unrestricted when the resolver returns null", async () => {
    const hiddenChannelId = "00000000-0000-4000-8000-000000000011";

    const result = await service([
      video("visible", [], channelId),
      video("also-visible", [], hiddenChannelId),
    ]).recent({ page: 1, pageSize: 20, subject: adminSubject });

    expect(result).toMatchObject({ total: 2 });
  });

  it("limits VIEWER ranking results to the resolver's membership union", async () => {
    const secondChannelId = "00000000-0000-4000-8000-000000000011";
    const hiddenChannelId = "00000000-0000-4000-8000-000000000012";

    const result = await service(
      [
        video("visible-a", [], channelId),
        video("visible-b", [], secondChannelId),
        video("hidden", [], hiddenChannelId),
      ],
      [channelId, secondChannelId],
    ).recent({ page: 1, pageSize: 20, subject: viewerSubject });

    expect(result.items.map((item) => item.id).sort()).toEqual(["visible-a", "visible-b"]);
    expect(result.total).toBe(2);
  });

  it("returns an empty ranking page for a VIEWER with no assigned channels", async () => {
    const result = await service([video("hidden", [], channelId)], []).recent({
      page: 1,
      pageSize: 20,
      subject: viewerSubject,
    });

    expect(result).toMatchObject({ items: [], total: 0 });
  });

  it("limits ranking inputs to the selected group's resolved channel set", async () => {
    const secondChannelId = "00000000-0000-4000-8000-000000000011";
    const groupId = "00000000-0000-4000-8000-000000000020";
    const result = await service(
      [video("outside", [], channelId), video("inside", [], secondChannelId)],
      [channelId, secondChannelId],
      [secondChannelId],
    ).weekly({ groupId, page: 1, pageSize: 20, subject: viewerSubject });

    expect(result.items.map((item) => item.id)).toEqual([]);
    expect(result.warmingUpCount).toBe(1);
  });

  it("returns not-found semantics for a VIEWER requesting a video outside the visible set", async () => {
    await expect(
      service([video("hidden", [], channelId)], []).get({
        videoId: "hidden",
        subject: viewerSubject,
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND", status: 404 });
  });

  it("returns not-found semantics for snapshots outside a VIEWER's visible set", async () => {
    await expect(
      service([video("hidden", [], channelId)], []).snapshots({
        videoId: "hidden",
        page: 1,
        pageSize: 20,
        subject: viewerSubject,
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND", status: 404 });
  });

  it("uses rolling seven-day gain and paginates on the server", async () => {
    const result = await service([
      video("a", [
        ["2026-08-15T12:00:00.000Z", 10_000n],
        ["2026-08-22T12:00:00.000Z", 60_000n],
      ]),
      video("b", [
        ["2026-08-15T12:00:00.000Z", 50_000n],
        ["2026-08-22T12:00:00.000Z", 55_000n],
      ]),
      video("warming", [["2026-08-22T12:00:00.000Z", 99_000n]]),
    ]).weekly({ page: 1, pageSize: 1, subject: adminSubject });

    expect(result).toMatchObject({ page: 1, pageSize: 1, total: 2, warmingUpCount: 1 });
    expect(result.items[0]).toMatchObject({ id: "a", rank: 1, weeklyGain: "50000" });

    const secondPage = await service([
      video("a", [
        ["2026-08-15T12:00:00.000Z", 10_000n],
        ["2026-08-22T12:00:00.000Z", 60_000n],
      ]),
      video("b", [
        ["2026-08-15T12:00:00.000Z", 50_000n],
        ["2026-08-22T12:00:00.000Z", 55_000n],
      ]),
    ]).weekly({ page: 2, pageSize: 1, subject: adminSubject });
    expect(secondPage.items[0]).toMatchObject({ id: "b", rank: 2, weeklyGain: "5000" });
  });

  it("returns a not-found error for an unknown snapshot video", async () => {
    await expect(
      service([]).snapshots({
        videoId: "missing",
        page: 1,
        pageSize: 20,
        subject: adminSubject,
      }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_FOUND",
      status: 404,
    });
  });
});
