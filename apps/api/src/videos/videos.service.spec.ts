import { describe, expect, it } from "vitest";

import { VideosService } from "./videos.service.js";

const visibleChannelId = "00000000-0000-4000-8000-000000000020";
const hiddenChannelId = "00000000-0000-4000-8000-000000000021";
const adminSubject = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN" as const,
};
const viewerSubject = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "VIEWER" as const,
};

function video(id: string, channelId: string) {
  return {
    id,
    youtubeVideoId: `youtube-${id}`,
    channelId,
    title: id,
    description: null,
    thumbnail: null,
    publishedAt: new Date("2026-08-20T00:00:00.000Z"),
    durationSeconds: null,
    currentViews: null,
    currentLikes: null,
    currentComments: null,
    monitorTier: "STANDARD" as const,
    firstSeenAt: new Date("2026-08-20T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-25T00:00:00.000Z"),
    isAvailable: true,
    isPinned: false,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:00.000Z"),
  };
}

function service(visibleChannelIds: string[] | null) {
  const videos = [video("visible-video", visibleChannelId), video("hidden-video", hiddenChannelId)];
  return new VideosService({
    access: { resolveVisibleChannelIds: async () => visibleChannelIds },
    unitOfWork: {
      transaction: async (work) =>
        work({
          channels: {
            findById: async (id: string) =>
              id === visibleChannelId || id === hiddenChannelId ? { id } : null,
          },
          videos: {
            list: async (input: { channelId: string }) => {
              const items = videos.filter((item) => item.channelId === input.channelId);
              return { items, total: items.length };
            },
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

describe("VideosService access scope", () => {
  it("keeps ADMIN channel videos unrestricted when the resolver returns null", async () => {
    const result = await service(null).listRecent({
      channelId: hiddenChannelId,
      page: 1,
      pageSize: 20,
      subject: adminSubject,
    });

    expect(result).toMatchObject({
      total: 1,
      items: [{ id: "hidden-video", channelId: hiddenChannelId, currentViews: null }],
    });
  });

  it("returns not-found semantics for a VIEWER listing videos outside the visible set", async () => {
    await expect(
      service([visibleChannelId]).listRecent({
        channelId: hiddenChannelId,
        page: 1,
        pageSize: 20,
        subject: viewerSubject,
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND", status: 404 });
  });

  it("returns not-found semantics when a VIEWER requests a hidden video through a visible channel", async () => {
    await expect(
      service([visibleChannelId]).snapshots({
        channelId: visibleChannelId,
        videoId: "hidden-video",
        page: 1,
        pageSize: 20,
        subject: viewerSubject,
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND", status: 404 });
  });

  it("denies all channel video data when a VIEWER has no assigned channels", async () => {
    await expect(
      service([]).listRecent({
        channelId: visibleChannelId,
        page: 1,
        pageSize: 20,
        subject: viewerSubject,
      }),
    ).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND", status: 404 });
  });
});
