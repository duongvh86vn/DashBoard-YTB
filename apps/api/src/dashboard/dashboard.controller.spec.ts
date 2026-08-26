import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DASHBOARD_APPLICATION_PORT } from "./dashboard-application.port.js";
import { DashboardController } from "./dashboard.controller.js";

const viewer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.test",
  role: "VIEWER" as const,
  isEnabled: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  disabledAt: null,
};
const trends = vi.fn(async (input: { days: number; subject: unknown }) => ({
  period: {
    startDate: "2026-07-29",
    endDate: "2026-08-25",
    days: input.days,
    timeZone: "Asia/Bangkok",
  },
  totals: { viewDelta: null, subscriberDelta: null, publishedVideos: 0 },
  coverage: {
    totalChannels: 0,
    channelsWithCurrentSnapshot: 0,
    channelsWithBaseline: 0,
    requestedDays: input.days,
    completeDays: 0,
    partialDays: 0,
    coveragePercent: 0,
  },
  series: [],
}));

describe("DashboardController", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DASHBOARD_APPLICATION_PORT, useValue: { trends } }],
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

  it("exposes the authenticated dashboard trend contract with no-store caching", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/dashboard/trends?days=28");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ period: { days: 28, timeZone: "Asia/Bangkok" } });
    expect(trends).toHaveBeenCalledWith({ days: 28, subject: viewer });
  });
});
