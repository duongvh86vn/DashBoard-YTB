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
  const [groupA, groupB] = await Promise.all([
    client.channelGroup.create({
      data: { name: "Phase 11 Group A", slug: "phase11-group-a", description: null },
    }),
    client.channelGroup.create({
      data: { name: "Phase 11 Group B", slug: "phase11-group-b", description: null },
    }),
  ]);
  await client.channelGroupChannel.createMany({
    data: [
      { groupId: groupA.id, channelId: assignedA.id },
      { groupId: groupA.id, channelId: overlap.id },
      { groupId: groupB.id, channelId: overlap.id },
      { groupId: groupB.id, channelId: assignedB.id },
    ],
  });
  await client.userChannelGroup.createMany({
    data: [groupA.id, groupB.id].map((groupId) => ({
      userId: viewer.id,
      groupId,
      assignedByUserId: admin.id,
    })),
  });
  const [assignedVideo, hiddenVideo] = await Promise.all([
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
        youtubeVideoId: "phase11-hidden-video",
        channelId: hidden.id,
        title: "Hidden video",
        publishedAt: new Date("2026-08-25T00:00:00.000Z"),
        lastSeenAt: now,
      },
    }),
  ]);
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
    groupA,
    groupB,
    assignedVideo,
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
      await client.video.deleteMany({
        where: { id: { in: [seeded.assignedVideo.id, seeded.hiddenVideo.id] } },
      });
      await client.channelGroup.deleteMany({
        where: { id: { in: [seeded.groupA.id, seeded.groupB.id] } },
      });
      await client.channel.deleteMany({
        where: {
          id: {
            in: [seeded.assignedA.id, seeded.overlap.id, seeded.assignedB.id, seeded.hidden.id],
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
      [seeded.groupA.id, seeded.groupB.id].sort(),
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
