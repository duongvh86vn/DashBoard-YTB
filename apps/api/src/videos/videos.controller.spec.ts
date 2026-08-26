import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { VIDEOS_APPLICATION_PORT } from "./videos-application.port.js";
import { VideosController } from "./videos.controller.js";

const channelId = "00000000-0000-4000-8000-000000000020";
const videoId = "00000000-0000-4000-8000-000000000030";
const viewer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.test",
  role: "VIEWER" as const,
  isEnabled: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  disabledAt: null,
};
const listRecent = vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));
const snapshots = vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));

describe("VideosController subject propagation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [{ provide: VIDEOS_APPLICATION_PORT, useValue: { listRecent, snapshots } }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(((request, _response, next) => {
      (request as typeof request & { user: typeof viewer }).user = viewer;
      next();
    }) as RequestHandler);
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("forwards the authenticated subject to channel video listing", async () => {
    await request(app.getHttpServer()).get(`/api/v1/channels/${channelId}/videos`).expect(200);

    expect(listRecent).toHaveBeenCalledWith({
      channelId,
      page: 1,
      pageSize: 50,
      subject: viewer,
    });
  });

  it("forwards the authenticated subject to channel video snapshots", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/channels/${channelId}/videos/${videoId}/snapshots`)
      .expect(200);

    expect(snapshots).toHaveBeenCalledWith({
      channelId,
      videoId,
      page: 1,
      pageSize: 50,
      subject: viewer,
    });
  });
});
