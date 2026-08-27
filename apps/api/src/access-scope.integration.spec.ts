import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hashSessionToken } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import { createPrismaClient, SessionRepository, VideoRepository } from "@yt-monitor/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "./app.module.js";
import {
  CHANNEL_GROUPS_APPLICATION_PORT,
  type ChannelGroupsApplicationPort,
} from "./channel-groups/channel-groups-application.port.js";
import { SessionAuthenticator } from "./auth/session-authenticator.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for access-scope integration tests");

const client = createPrismaClient(databaseUrl);
const sessionSecret = "phase11-access-session-secret-value";
const viewerToken = "v".repeat(43);
const now = new Date("2026-08-26T08:00:00.000Z");
const rankingNow = new Date();
const rankingBaselineAt = new Date(rankingNow.getTime() - 7 * 24 * 60 * 60 * 1_000 - 60_000);
const rankingLatestAt = new Date(rankingNow.getTime() - 60_000);
const missingGroupId = "00000000-0000-4000-8000-000000000091";
const missingChannelId = "00000000-0000-4000-8000-000000000092";
const env: ApiEnv = {
  NODE_ENV: "test",
  APP_VERSION: "0.1.0",
  APP_TIMEZONE: "Asia/Bangkok",
  LOG_LEVEL: "silent",
  DATABASE_URL: databaseUrl,
  API_PORT: 5000,
  WORKER_HEARTBEAT_STALE_SECONDS: 45,
  DEPLOYMENT_MODE: "LOCAL",
  APP_PUBLIC_URL: "http://127.0.0.1:3000",
  APP_ALLOWED_ORIGINS: ["http://127.0.0.1:3000"],
  SESSION_SECRET: sessionSecret,
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  TRUST_PROXY: false,
};

type Seeded = Awaited<ReturnType<typeof seedAccessRows>>;

async function seedAccessRows() {
  const [admin, viewer] = await Promise.all([
    client.user.create({
      data: {
        email: "phase11-access-admin@example.test",
        passwordHash: "unused-admin-hash",
        role: "ADMIN",
      },
    }),
    client.user.create({
      data: {
        email: "phase11-access-viewer@example.test",
        passwordHash: "unused-viewer-hash",
        role: "VIEWER",
      },
    }),
  ]);
  const channels = await Promise.all(
    ["assigned-a", "overlap", "assigned-b", "hidden"].map((name, index) =>
      client.channel.create({
        data: {
          youtubeChannelId: `UCphase11access${String(index).padStart(9, "0")}`,
          originalInput: `@${name}`,
          canonicalUrl: `https://www.youtube.com/channel/phase11-${name}`,
          title: name,
        },
      }),
    ),
  );
  const [assignedA, overlap, assignedB, hidden] = channels as [
    (typeof channels)[number],
    (typeof channels)[number],
    (typeof channels)[number],
    (typeof channels)[number],
  ];
  const archivedChannel = await client.channel.create({
    data: {
      youtubeChannelId: "UCphase11access000000004",
      originalInput: "@archived",
      canonicalUrl: "https://www.youtube.com/channel/phase11-archived",
      title: "archived",
      isEnabled: false,
      availabilityStatus: "ARCHIVED",
      archivedAt: now,
    },
  });
  const [groupA, groupB, emptyGroup, archivedGroup, unassignedGroup] = await Promise.all([
    client.channelGroup.create({
      data: { name: "Phase 11 Group A", slug: "phase11-group-a", description: null },
    }),
    client.channelGroup.create({
      data: { name: "Phase 11 Group B", slug: "phase11-group-b", description: null },
    }),
    client.channelGroup.create({
      data: { name: "Phase 11 Empty Group", slug: "phase11-empty-group", description: null },
    }),
    client.channelGroup.create({
      data: {
        name: "Phase 11 Archived Group",
        slug: "phase11-archived-group",
        description: null,
        archivedAt: now,
      },
    }),
    client.channelGroup.create({
      data: {
        name: "Phase 11 Unassigned Group",
        slug: "phase11-unassigned-group",
        description: null,
      },
    }),
  ]);
  await client.channelGroupChannel.createMany({
    data: [
      { groupId: groupA.id, channelId: assignedA.id },
      { groupId: groupA.id, channelId: overlap.id },
      { groupId: groupB.id, channelId: overlap.id },
      { groupId: groupB.id, channelId: assignedB.id },
      { groupId: archivedGroup.id, channelId: hidden.id },
    ],
  });
  await client.userChannelGroup.createMany({
    data: [groupA.id, groupB.id, emptyGroup.id, archivedGroup.id].map((groupId) => ({
      userId: viewer.id,
      groupId,
      assignedByUserId: admin.id,
    })),
  });
  const [assignedVideo, overlapVideo, assignedBVideo, hiddenVideo] = await Promise.all([
    client.video.create({
      data: {
        youtubeVideoId: "phase11-assigned-video",
        channelId: assignedA.id,
        title: "Assigned video",
        publishedAt: new Date("2026-08-25T00:00:00.000Z"),
        lastSeenAt: now,
      },
    }),
    client.video.create({
      data: {
        youtubeVideoId: "phase11-overlap-video",
        channelId: overlap.id,
        title: "Overlap video",
        publishedAt: new Date("2026-08-24T00:00:00.000Z"),
        lastSeenAt: now,
      },
    }),
    client.video.create({
      data: {
        youtubeVideoId: "phase11-assigned-b-video",
        channelId: assignedB.id,
        title: "Assigned B video",
        publishedAt: new Date("2026-08-23T00:00:00.000Z"),
        lastSeenAt: now,
      },
    }),
    client.video.create({
      data: {
        youtubeVideoId: "phase11-hidden-video",
        channelId: hidden.id,
        title: "Hidden video",
        publishedAt: new Date("2026-08-25T00:00:00.000Z"),
        lastSeenAt: now,
      },
    }),
  ]);
  await client.videoSnapshot.createMany({
    data: [assignedVideo, overlapVideo, assignedBVideo, hiddenVideo].flatMap((video, index) => [
      {
        videoId: video.id,
        channelId: video.channelId,
        capturedAt: rankingBaselineAt,
        snapshotBucket: rankingBaselineAt,
        views: BigInt(100 + index),
        likes: null,
        comments: null,
        source: "YTDLP" as const,
      },
      {
        videoId: video.id,
        channelId: video.channelId,
        capturedAt: rankingLatestAt,
        snapshotBucket: rankingLatestAt,
        views: BigInt(200 + index),
        likes: null,
        comments: null,
        source: "YTDLP" as const,
      },
    ]),
  });
  await new SessionRepository(client).create({
    userId: viewer.id,
    tokenHash: hashSessionToken(sessionSecret, viewerToken),
    now,
    idleExpiresAt: new Date("2026-08-26T10:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-08-27T08:00:00.000Z"),
  });
  return {
    admin,
    viewer,
    assignedA,
    overlap,
    assignedB,
    hidden,
    archivedChannel,
    groupA,
    groupB,
    emptyGroup,
    archivedGroup,
    unassignedGroup,
    assignedVideo,
    overlapVideo,
    assignedBVideo,
    hiddenVideo,
  };
}

describe("real PostgreSQL VIEWER access scope through the API", () => {
  let app: INestApplication;
  let seeded: Seeded;
  let groups: ChannelGroupsApplicationPort;

  beforeAll(async () => {
    seeded = await seedAccessRows();
    const sessionAuthenticator = new SessionAuthenticator({
      sessions: new SessionRepository(client),
      sessionSecret,
      idleMinutes: 120,
      clock: { now: () => new Date(now) },
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.forProduction({ env, databaseClient: client, sessionAuthenticator })],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    await app.init();
    groups = app.get<ChannelGroupsApplicationPort>(CHANNEL_GROUPS_APPLICATION_PORT);
  });

  afterAll(async () => {
    if (seeded !== undefined) {
      const videoIds = [
        seeded.assignedVideo.id,
        seeded.overlapVideo.id,
        seeded.assignedBVideo.id,
        seeded.hiddenVideo.id,
      ];
      await client.videoSnapshot.deleteMany({ where: { videoId: { in: videoIds } } });
      await client.video.deleteMany({
        where: { id: { in: videoIds } },
      });
      await client.channelGroup.deleteMany({
        where: {
          id: {
            in: [
              seeded.groupA.id,
              seeded.groupB.id,
              seeded.emptyGroup.id,
              seeded.archivedGroup.id,
              seeded.unassignedGroup.id,
            ],
          },
        },
      });
      await client.channel.deleteMany({
        where: {
          id: {
            in: [
              seeded.assignedA.id,
              seeded.overlap.id,
              seeded.assignedB.id,
              seeded.hidden.id,
              seeded.archivedChannel.id,
            ],
          },
        },
      });
      await client.session.deleteMany({ where: { userId: seeded.viewer.id } });
      await client.user.deleteMany({ where: { id: { in: [seeded.viewer.id, seeded.admin.id] } } });
    }
    if (app !== undefined) await app.close();
  });

  function viewerGet(path: string) {
    return request(app.getHttpServer()).get(path).set("Cookie", `yhm_session=${viewerToken}`);
  }

  async function expectVisibleChannelIds(expected: string[]) {
    const response = await viewerGet("/api/v1/channels").expect(200);
    expect(response.body.total).toBe(expected.length);
    expect(response.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [...expected].sort(),
    );
  }

  it("scopes all dashboard sources to the VIEWER union, selected group/channel, and empty group", async () => {
    const sources = [
      { name: "channels", path: "/api/v1/channels", kind: "channels" },
      { name: "trends", path: "/api/v1/dashboard/trends", kind: "trends" },
      { name: "revenue", path: "/api/v1/dashboard/revenue", kind: "revenue" },
      {
        name: "daily video leaders",
        path: "/api/v1/dashboard/daily-video-leaders",
        kind: "daily-video-leaders",
      },
      { name: "recent videos", path: "/api/v1/videos/recent", kind: "videos" },
      { name: "weekly ranking", path: "/api/v1/videos/rankings/weekly", kind: "videos" },
    ] as const;
    const scopes = [
      {
        name: "assigned-group union",
        query: {},
        channelIds: [seeded.assignedA.id, seeded.overlap.id, seeded.assignedB.id],
        videoIds: [seeded.assignedVideo.id, seeded.overlapVideo.id, seeded.assignedBVideo.id],
      },
      {
        name: "assigned group",
        query: { groupId: seeded.groupA.id },
        channelIds: [seeded.assignedA.id, seeded.overlap.id],
        videoIds: [seeded.assignedVideo.id, seeded.overlapVideo.id],
      },
      {
        name: "assigned direct channel",
        query: { channelId: seeded.assignedA.id },
        channelIds: [seeded.assignedA.id],
        videoIds: [seeded.assignedVideo.id],
      },
      {
        name: "assigned group and direct channel",
        query: { groupId: seeded.groupA.id, channelId: seeded.assignedA.id },
        channelIds: [seeded.assignedA.id],
        videoIds: [seeded.assignedVideo.id],
      },
      {
        name: "assigned empty group",
        query: { groupId: seeded.emptyGroup.id },
        channelIds: [],
        videoIds: [],
      },
    ];

    for (const source of sources) {
      for (const scope of scopes) {
        const response = await viewerGet(source.path).query(scope.query).expect(200);
        if (source.kind === "trends") {
          expect(response.body.coverage.totalChannels, `${source.name}: ${scope.name}`).toBe(
            scope.channelIds.length,
          );
          continue;
        }
        if (source.kind === "revenue" || source.kind === "daily-video-leaders") {
          expect(response.body.totalChannels, `${source.name}: ${scope.name}`).toBe(
            scope.channelIds.length,
          );
          continue;
        }

        const expectedIds = source.kind === "channels" ? scope.channelIds : scope.videoIds;
        expect(response.body.total, `${source.name}: ${scope.name}`).toBe(expectedIds.length);
        expect(
          response.body.items.map((item: { id: string }) => item.id).sort(),
          `${source.name}: ${scope.name}`,
        ).toEqual([...expectedIds].sort());
      }
    }
  });

  it("returns one not-found HTTP shape for every invalid selection across all dashboard sources", async () => {
    const sources = [
      ["channels", "/api/v1/channels"],
      ["trends", "/api/v1/dashboard/trends"],
      ["revenue", "/api/v1/dashboard/revenue"],
      ["daily video leaders", "/api/v1/dashboard/daily-video-leaders"],
      ["recent videos", "/api/v1/videos/recent"],
      ["weekly ranking", "/api/v1/videos/rankings/weekly"],
    ] as const;
    const invalidSelections = [
      ["missing group", { groupId: missingGroupId }],
      ["archived group", { groupId: seeded.archivedGroup.id }],
      ["active unassigned group", { groupId: seeded.unassignedGroup.id }],
      ["missing channel", { channelId: missingChannelId }],
      ["archived channel", { channelId: seeded.archivedChannel.id }],
      ["unauthorized channel", { channelId: seeded.hidden.id }],
      ["group/channel mismatch", { groupId: seeded.groupA.id, channelId: seeded.assignedB.id }],
    ] as const;
    const notFoundBody = {
      error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" },
    };

    for (const [sourceName, path] of sources) {
      for (const [selectionName, query] of invalidSelections) {
        const response = await viewerGet(path).query(query);
        expect(response.status, `${sourceName}: ${selectionName}`).toBe(404);
        expect(response.body, `${sourceName}: ${selectionName}`).toEqual(notFoundBody);
      }
    }
  });

  it("re-evaluates union, replacement, empty assignment and archived groups for one session", async () => {
    await expect(
      new VideoRepository(client).listForRanking({
        channelId: seeded.assignedA.id,
        channelIds: [],
      }),
    ).resolves.toEqual([]);
    await expectVisibleChannelIds([seeded.assignedA.id, seeded.overlap.id, seeded.assignedB.id]);
    const accessibleGroups = await viewerGet("/api/v1/channel-groups/accessible").expect(200);
    expect(accessibleGroups.body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [seeded.groupA.id, seeded.groupB.id, seeded.emptyGroup.id].sort(),
    );
    await viewerGet(`/api/v1/channels/${seeded.assignedA.id}`).expect(200);
    await viewerGet(`/api/v1/channels/${seeded.assignedA.id}/videos`).expect(200);
    await viewerGet(`/api/v1/videos?channelId=${seeded.assignedA.id}`).expect(200);
    await viewerGet(`/api/v1/videos/${seeded.assignedVideo.id}`).expect(200);
    await viewerGet(`/api/v1/channels/${seeded.hidden.id}`).expect(404);
    await viewerGet(`/api/v1/channels/${seeded.hidden.id}/videos`).expect(404);
    await viewerGet(`/api/v1/videos/${seeded.hiddenVideo.id}`).expect(404);

    await groups.replaceViewerGroups({
      actorUserId: seeded.admin.id,
      userId: seeded.viewer.id,
      groupIds: [seeded.groupB.id],
    });
    await expectVisibleChannelIds([seeded.overlap.id, seeded.assignedB.id]);
    await viewerGet(`/api/v1/channels/${seeded.assignedA.id}`).expect(404);
    await viewerGet(`/api/v1/channels/${seeded.assignedB.id}`).expect(200);

    await groups.replaceViewerGroups({
      actorUserId: seeded.admin.id,
      userId: seeded.viewer.id,
      groupIds: [],
    });
    await expectVisibleChannelIds([]);
    await viewerGet(`/api/v1/channels/${seeded.assignedB.id}`).expect(404);
    const emptyRankings = await viewerGet("/api/v1/videos").expect(200);
    expect(emptyRankings.body).toMatchObject({ items: [], total: 0 });

    await groups.replaceViewerGroups({
      actorUserId: seeded.admin.id,
      userId: seeded.viewer.id,
      groupIds: [seeded.groupB.id],
    });
    await viewerGet(`/api/v1/channels/${seeded.assignedB.id}`).expect(200);
    await groups.archive({ actorUserId: seeded.admin.id, id: seeded.groupB.id });
    await expectVisibleChannelIds([]);
    await viewerGet(`/api/v1/channels/${seeded.assignedB.id}`).expect(404);
  });
});
