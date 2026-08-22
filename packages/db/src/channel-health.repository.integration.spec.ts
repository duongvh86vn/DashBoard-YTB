import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { ChannelHealthRepository } from "./channel-health.repository.js";
import { ChannelRepository } from "./channel.repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const client = createPrismaClient(databaseUrl);
const channels = new ChannelRepository(client);
const healthChecks = new ChannelHealthRepository(client);

describe("channel health persistence", () => {
  beforeEach(async () => {
    await client.channelHealthCheck.deleteMany();
    await client.channelDailyStat.deleteMany();
    await client.channelSnapshot.deleteMany();
    await client.syncRun.deleteMany();
    await client.channel.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("keeps ordered sanitized evidence and paginates health history", async () => {
    const channel = await channels.create({
      originalInput: "@health-example",
      resolved: {
        youtubeChannelId: "UC1234567890123456789012",
        canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
        handle: "@health-example",
        title: "Health example",
        description: null,
        thumbnail: null,
      },
    });
    const later = new Date("2026-08-22T00:00:02.000Z");
    const earlier = new Date("2026-08-22T00:00:01.000Z");
    await healthChecks.create({
      channelId: channel.id,
      checkedAt: earlier,
      publicPageStatus: "PUBLIC_PAGE_BLOCKED",
      ytdlpStatus: "YTDLP_ERROR",
      rssStatus: "NETWORK_ERROR",
      normalizedAvailability: "UNKNOWN",
      evidenceCode: "BLOCKED_PUBLIC_PAGE",
      evidenceTextSafe: "captcha challenge",
      httpStatus: 429,
      durationMs: 1200,
    });
    await healthChecks.create({
      channelId: channel.id,
      checkedAt: later,
      publicPageStatus: "PUBLIC_PAGE_RENDERED",
      ytdlpStatus: "YTDLP_OK",
      rssStatus: "RSS_OK",
      normalizedAvailability: "ACTIVE",
      evidenceCode: "ACTIVE_PUBLIC_PAGE",
      evidenceTextSafe: "Example channel",
      httpStatus: 200,
      durationMs: 500,
    });

    await expect(healthChecks.list(channel.id, 1, 1)).resolves.toMatchObject({
      total: 2,
      items: [{ checkedAt: later, evidenceTextSafe: "Example channel" }],
    });
    const raw = await client.channelHealthCheck.findFirst({ where: { channelId: channel.id } });
    expect(raw).toMatchObject({ httpStatus: expect.any(Number), durationMs: expect.any(Number) });
    expect(raw?.evidenceTextSafe).not.toContain("<html");
  });
});
