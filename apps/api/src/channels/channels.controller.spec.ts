import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CHANNELS_APPLICATION_PORT } from "./channels-application.port.js";
import { ChannelsController } from "./channels.controller.js";

const channelId = "00000000-0000-4000-8000-000000000003";
const publicIntelligence = vi.fn(async (input: { id: string; days: number }) => ({
  channelId: input.id,
  period: { days: input.days },
}));

describe("ChannelsController public intelligence", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [{ provide: CHANNELS_APPLICATION_PORT, useValue: { publicIntelligence } }],
    }).compile();
    app = module.createNestApplication({ logger: false });
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
    expect(publicIntelligence).toHaveBeenCalledWith({ id: channelId, days: 7 });
  });
});
