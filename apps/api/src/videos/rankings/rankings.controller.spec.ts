import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { VIDEO_RANKINGS_APPLICATION_PORT } from "./rankings-application.port.js";
import { VideoRankingsController } from "./rankings.controller.js";

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
const page = { items: [], page: 1, pageSize: 20, total: 0, warmingUpCount: 0 };
const recent = vi.fn(async () => page);
const weekly = vi.fn(async () => page);
const hot = vi.fn(async () => page);
const breakout = vi.fn(async () => page);
const snapshots = vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));
const get = vi.fn(async (input: { videoId: string }) => ({ id: input.videoId }));

describe("VideoRankingsController subject propagation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VideoRankingsController],
      providers: [
        {
          provide: VIDEO_RANKINGS_APPLICATION_PORT,
          useValue: { recent, weekly, hot, breakout, snapshots, get },
        },
      ],
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

  it.each([
    ["recent alias", "/api/v1/videos/recent", recent],
    ["recent", "/api/v1/videos", recent],
    ["weekly", "/api/v1/videos/rankings/weekly", weekly],
    ["hot", "/api/v1/videos/rankings/hot", hot],
    ["breakout", "/api/v1/videos/rankings/breakout", breakout],
  ])("forwards the authenticated subject to %s rankings", async (_name, path, operation) => {
    await request(app.getHttpServer()).get(path).expect(200);

    expect(operation).toHaveBeenCalledWith({ page: 1, pageSize: 20, subject: viewer });
  });

  it("forwards the authenticated subject to direct ranking detail", async () => {
    await request(app.getHttpServer()).get(`/api/v1/videos/${videoId}`).expect(200);

    expect(get).toHaveBeenCalledWith({ videoId, subject: viewer });
  });

  it("forwards the authenticated subject to ranking snapshots", async () => {
    await request(app.getHttpServer()).get(`/api/v1/videos/${videoId}/snapshots`).expect(200);

    expect(snapshots).toHaveBeenCalledWith({
      videoId,
      page: 1,
      pageSize: 20,
      subject: viewer,
    });
  });
});
