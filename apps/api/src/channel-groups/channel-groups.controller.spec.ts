import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PublicUser } from "@yt-monitor/auth";
import type { ApiEnv } from "@yt-monitor/config";
import type { WorkerHeartbeatRecord } from "@yt-monitor/db";
import type { ChannelGroupDetail, ChannelGroupSummary } from "@yt-monitor/shared";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "../auth/session-authentication.port.js";
import type { DatabaseHealthReader, WorkerHeartbeatReader } from "../health/health.service.js";
import { ChannelGroupApplicationError } from "./channel-group-application.error.js";
import type {
  ChannelAccessSubject,
  ChannelGroupsApplicationPort,
} from "./channel-groups-application.port.js";

const ORIGIN = "http://127.0.0.1:3000";
const SESSION_TOKEN = "g".repeat(43);
const GROUP_ID = "00000000-0000-4000-8000-000000000301";
const CHANNEL_ID = "00000000-0000-4000-8000-000000000302";
const VIEWER_ID = "00000000-0000-4000-8000-000000000303";
const ADMIN_ID = "00000000-0000-4000-8000-000000000304";

const ENV: ApiEnv = {
  NODE_ENV: "test",
  APP_VERSION: "0.1.0",
  APP_TIMEZONE: "Asia/Bangkok",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://unused:unused@invalid.test/unused",
  API_PORT: 5000,
  WORKER_HEARTBEAT_STALE_SECONDS: 45,
  DEPLOYMENT_MODE: "LOCAL",
  APP_PUBLIC_URL: ORIGIN,
  APP_ALLOWED_ORIGINS: [ORIGIN],
  SESSION_SECRET: "s".repeat(32),
  SESSION_IDLE_MINUTES: 120,
  SESSION_ABSOLUTE_HOURS: 24,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  TRUST_PROXY: false,
};

const GROUP: ChannelGroupDetail = {
  id: GROUP_ID,
  name: "Nhóm được phân quyền",
  slug: "nhom-duoc-phan-quyen",
  description: null,
  channelCount: 1,
  viewerCount: 1,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  channelIds: [CHANNEL_ID],
  viewerIds: [VIEWER_ID],
};

class AvailableDatabase implements DatabaseHealthReader {
  async pingDatabase(): Promise<{ latencyMs: number }> {
    return { latencyMs: 1 };
  }
}

class AvailableWorker implements WorkerHeartbeatReader {
  async getFreshestRunningHeartbeat(): Promise<WorkerHeartbeatRecord> {
    return {
      workerId: "worker-group-http",
      version: "0.1.0",
      status: "RUNNING",
      lastSeenAt: new Date("2026-08-26T00:00:00.000Z"),
    };
  }
}

class FixedSession implements SessionAuthenticationPort {
  constructor(private readonly user: PublicUser) {}

  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    return token === SESSION_TOKEN ? { user: this.user, session: { id: "group-session" } } : null;
  }
}

class GroupHttpApplication implements ChannelGroupsApplicationPort {
  replaceChannelsError: Error | undefined;

  async list(): Promise<{ items: ChannelGroupSummary[] }> {
    return { items: [GROUP] };
  }

  async listAccessible(input: {
    subject: ChannelAccessSubject;
  }): Promise<{ items: ChannelGroupSummary[] }> {
    return { items: input.subject.role === "VIEWER" ? [GROUP] : [GROUP] };
  }

  async get(): Promise<{ group: ChannelGroupDetail }> {
    return { group: GROUP };
  }

  async create(): Promise<{ group: ChannelGroupDetail }> {
    return { group: GROUP };
  }

  async update(): Promise<{ group: ChannelGroupDetail }> {
    return { group: GROUP };
  }

  async archive(): Promise<void> {}

  async replaceChannels(): Promise<{ group: ChannelGroupDetail }> {
    if (this.replaceChannelsError) throw this.replaceChannelsError;
    return { group: GROUP };
  }

  async replaceViewerGroups(): Promise<void> {}

  async resolveVisibleChannelIds(subject: ChannelAccessSubject): Promise<string[] | null> {
    return subject.role === "ADMIN" ? null : [CHANNEL_ID];
  }
}

function publicUser(role: "ADMIN" | "VIEWER"): PublicUser {
  return {
    id: role === "ADMIN" ? ADMIN_ID : VIEWER_ID,
    email: role === "ADMIN" ? "admin@example.com" : "viewer@example.com",
    role,
    isEnabled: true,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    disabledAt: null,
  };
}

async function createApp(role: "ADMIN" | "VIEWER") {
  const groups = new GroupHttpApplication();
  const dynamicModule = AppModule.forTesting({
    env: ENV,
    databaseHealthReader: new AvailableDatabase(),
    workerHeartbeatReader: new AvailableWorker(),
    sessionAuthenticator: new FixedSession(publicUser(role)),
    channelGroupsApplication: groups,
  });
  const module = await Test.createTestingModule({ imports: [dynamicModule] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.init();
  return { app, groups };
}

function authenticated(server: Parameters<typeof request>[0]) {
  return {
    get: (path: string) => request(server).get(path).set("Cookie", `yhm_session=${SESSION_TOKEN}`),
    delete: (path: string) =>
      request(server)
        .delete(path)
        .set("Cookie", `yhm_session=${SESSION_TOKEN}`)
        .set("Origin", ORIGIN)
        .set("X-CSRF-Protection", "1")
        .set("Content-Type", "application/json")
        .send({}),
    post: (path: string, body: object) =>
      request(server)
        .post(path)
        .set("Cookie", `yhm_session=${SESSION_TOKEN}`)
        .set("Origin", ORIGIN)
        .set("X-CSRF-Protection", "1")
        .send(body),
    patch: (path: string, body: object) =>
      request(server)
        .patch(path)
        .set("Cookie", `yhm_session=${SESSION_TOKEN}`)
        .set("Origin", ORIGIN)
        .set("X-CSRF-Protection", "1")
        .send(body),
    put: (path: string, body: object) =>
      request(server)
        .put(path)
        .set("Cookie", `yhm_session=${SESSION_TOKEN}`)
        .set("Origin", ORIGIN)
        .set("X-CSRF-Protection", "1")
        .send(body),
  };
}

function expectError(
  response: request.Response,
  status: number,
  code: string,
  message: string,
): void {
  expect(response.status).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body).toEqual({ error: { code, message } });
}

describe("channel-group guarded HTTP contract", () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("allows a VIEWER to read only assigned accessible groups", async () => {
    const { app } = await createApp("VIEWER");
    apps.push(app);

    const response = await authenticated(app.getHttpServer()).get(
      "/api/v1/channel-groups/accessible",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [GROUP] });
  });

  it("returns 403 to a VIEWER for every admin group endpoint", async () => {
    const { app } = await createApp("VIEWER");
    apps.push(app);
    const http = authenticated(app.getHttpServer());
    const responses = await Promise.all([
      http.get("/api/v1/channel-groups"),
      http.get(`/api/v1/channel-groups/${GROUP_ID}`),
      http.post("/api/v1/channel-groups", { name: "Denied" }),
      http.patch(`/api/v1/channel-groups/${GROUP_ID}`, { name: "Denied" }),
      http.delete(`/api/v1/channel-groups/${GROUP_ID}`),
      http.put(`/api/v1/channel-groups/${GROUP_ID}/channels`, { channelIds: [CHANNEL_ID] }),
      http.put(`/api/v1/users/${VIEWER_ID}/channel-groups`, { groupIds: [GROUP_ID] }),
    ]);

    for (const response of responses) {
      expectError(response, 403, "AUTH_FORBIDDEN", "Forbidden");
    }
  });

  it("allows an ADMIN to atomically replace channels and VIEWER assignments", async () => {
    const { app } = await createApp("ADMIN");
    apps.push(app);
    const http = authenticated(app.getHttpServer());

    const channels = await http.put(`/api/v1/channel-groups/${GROUP_ID}/channels`, {
      channelIds: [CHANNEL_ID],
    });
    expect(channels.status).toBe(200);
    expect(channels.body).toEqual({ group: GROUP });

    const viewers = await http.put(`/api/v1/users/${VIEWER_ID}/channel-groups`, {
      groupIds: [GROUP_ID],
    });
    expect(viewers.status).toBe(204);
    expect(viewers.text).toBe("");
  });

  it("preserves exact validation and application error envelopes over HTTP", async () => {
    const { app, groups } = await createApp("ADMIN");
    apps.push(app);
    const http = authenticated(app.getHttpServer());

    const invalid = await http.put(`/api/v1/channel-groups/${GROUP_ID}/channels`, {
      channelIds: [CHANNEL_ID, CHANNEL_ID],
    });
    expectError(invalid, 400, "VALIDATION_ERROR", "Invalid request");

    groups.replaceChannelsError = ChannelGroupApplicationError.membershipInvalid();
    const rejected = await http.put(`/api/v1/channel-groups/${GROUP_ID}/channels`, {
      channelIds: [CHANNEL_ID],
    });
    expectError(
      rejected,
      400,
      "CHANNEL_GROUP_MEMBERSHIP_INVALID",
      "Channel group membership is invalid",
    );
  });
});
