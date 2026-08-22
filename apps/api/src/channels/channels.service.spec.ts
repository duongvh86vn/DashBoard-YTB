import { describe, expect, it } from "vitest";
import { ChannelConflictError } from "@yt-monitor/db";

import { ChannelApplicationError } from "./channel-application.error.js";
import { ChannelsService } from "./channels.service.js";

const channel = {
  id: "00000000-0000-4000-8000-000000000003",
  youtubeChannelId: "UC1234567890123456789012",
  originalInput: "@example",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Example",
  description: null,
  thumbnail: null,
  subscriberCount: null,
  videoCount: null,
  lifetimeViewCount: null,
  lastUploadAt: null,
  availabilityStatus: "ACTIVE" as const,
  activityStatus: "UNKNOWN" as const,
  lastChannelScanAt: null,
  lastHealthCheckAt: null,
  lastSeenAliveAt: null,
  consecutiveHealthFailures: 0,
  firstUnavailableAt: null,
  isEnabled: true,
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
  updatedAt: new Date("2026-08-22T00:00:00.000Z"),
  archivedAt: null,
};

function service(provider: { resolveChannel: (input: string) => Promise<unknown> }) {
  return new ChannelsService({
    provider: provider as never,
    unitOfWork: {
      transaction: async (work) =>
        work({
          channels: {
            list: async () => ({ items: [channel], total: 1 }),
            findById: async () => channel,
            create: async () => channel,
            archive: async () => channel,
          },
        } as never),
    },
  });
}

describe("ChannelsService", () => {
  it("does not create when no provider returns a canonical channel", async () => {
    await expect(
      service({ resolveChannel: async () => null }).create({ originalInput: "@missing" }),
    ).rejects.toMatchObject({
      code: "CHANNEL_RESOLVE_FAILED",
      status: 422,
    });
  });

  it("returns stringified bigint-safe public fields", async () => {
    const result = await service({
      resolveChannel: async () => ({
        youtubeChannelId: "UC1234567890123456789012",
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
        handle: "@example",
        title: "Example",
        description: null,
        thumbnail: null,
      }),
    }).get(channel.id);
    expect(result).toMatchObject({ id: channel.id, youtubeChannelId: channel.youtubeChannelId });
  });

  it("maps canonical duplicate failures to the narrow API error", async () => {
    const duplicate = new ChannelConflictError();
    const value = new ChannelsService({
      provider: {
        resolveChannel: async () => ({
          youtubeChannelId: "UC1234567890123456789012",
          canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
          handle: "@example",
          title: "Example",
          description: null,
          thumbnail: null,
        }),
        getChannelCurrentStats: async () => null,
        listRecentVideos: async () => [],
        getVideoStats: async () => [],
      },
      unitOfWork: {
        transaction: async () => {
          throw duplicate;
        },
      },
    });
    await expect(value.create({ originalInput: "@example" })).rejects.toBeInstanceOf(
      ChannelApplicationError,
    );
  });

  it("queues an admin health check and exposes safe history", async () => {
    const serviceUnderTest = new ChannelsService({
      provider: { resolveChannel: async () => null } as never,
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: { findById: async () => channel },
            syncRuns: {
              create: async () => ({ id: "00000000-0000-4000-8000-000000000004" }),
            },
            healthChecks: {
              list: async () => ({
                total: 1,
                items: [
                  {
                    id: "00000000-0000-4000-8000-000000000005",
                    channelId: channel.id,
                    checkedAt: new Date("2026-08-22T00:00:00.000Z"),
                    publicPageStatus: "PUBLIC_PAGE_BLOCKED",
                    ytdlpStatus: "YTDLP_ERROR",
                    rssStatus: "NETWORK_ERROR",
                    normalizedAvailability: "UNKNOWN",
                    evidenceCode: "BLOCKED_PUBLIC_PAGE",
                    evidenceTextSafe: "blocked",
                    httpStatus: 429,
                    durationMs: 100,
                    createdAt: new Date("2026-08-22T00:00:00.000Z"),
                  },
                ],
              }),
            },
          } as never),
      },
    });
    await expect(serviceUnderTest.requestHealthCheck({ id: channel.id })).resolves.toEqual({
      syncRunId: "00000000-0000-4000-8000-000000000004",
      status: "QUEUED",
    });
    await expect(
      serviceUnderTest.healthHistory({ id: channel.id, page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ total: 1, items: [{ evidenceCode: "BLOCKED_PUBLIC_PAGE" }] });
  });
});
