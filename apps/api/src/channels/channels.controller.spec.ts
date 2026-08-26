import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CHANNELS_APPLICATION_PORT } from "./channels-application.port.js";
import { ChannelsController } from "./channels.controller.js";

const channelId = "00000000-0000-4000-8000-000000000003";
const viewer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.test",
  role: "VIEWER" as const,
  isEnabled: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  disabledAt: null,
};
const list = vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));
const get = vi.fn(async (input: { id: string }) => ({ id: input.id }));
const healthHistory = vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 }));
const publicIntelligence = vi.fn(async (input: { id: string; days: number; subject: unknown }) => ({
  channelId: input.id,
  period: { days: input.days },
}));

describe("ChannelsController public intelligence", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [
        {
          provide: CHANNELS_APPLICATION_PORT,
          useValue: { list, get, healthHistory, publicIntelligence },
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

  it("exposes a strict no-store per-channel window", async () => {
    const response = await request(app.getHttpServer()).get(
      `/api/v1/channels/${channelId}/public-intelligence?days=7`,
    );

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ channelId, period: { days: 7 } });
    expect(publicIntelligence).toHaveBeenCalledWith({ id: channelId, days: 7, subject: viewer });
  });

  it("forwards the authenticated subject through every other scoped channel route", async () => {
    await request(app.getHttpServer()).get("/api/v1/channels").expect(200);
    await request(app.getHttpServer()).get(`/api/v1/channels/${channelId}`).expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/channels/${channelId}/health-history`)
      .expect(200);

    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20, subject: viewer });
    expect(get).toHaveBeenCalledWith({ id: channelId, subject: viewer });
    expect(healthHistory).toHaveBeenCalledWith({
      id: channelId,
      page: 1,
      pageSize: 20,
      subject: viewer,
    });
  });
});
