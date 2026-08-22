import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { ChannelConflictError } from "./channel-errors.js";
import { ChannelRepository } from "./channel.repository.js";
import { ChannelDailyStatRepository } from "./channel-daily-stat.repository.js";
import { SyncRunRepository } from "./sync-run.repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const client = createPrismaClient(databaseUrl);
const channels = new ChannelRepository(client);
const dailyStats = new ChannelDailyStatRepository(client);
const syncRuns = new SyncRunRepository(client);

const resolved = {
  youtubeChannelId: "UC1234567890123456789012",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Example",
  description: null,
  thumbnail: null,
};

describe("channel persistence", () => {
  beforeEach(async () => {
    await client.channelDailyStat.deleteMany();
    await client.channelSnapshot.deleteMany();
    await client.syncRun.deleteMany();
    await client.channel.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("requires canonical identity, deduplicates, and stores nullable metrics", async () => {
    const channel = await channels.create({ originalInput: "@example", resolved });
    expect(channel.youtubeChannelId).toBe(resolved.youtubeChannelId);
    await expect(channels.findByYoutubeChannelId(resolved.youtubeChannelId)).resolves.toMatchObject(
      { id: channel.id },
    );
    await expect(
      channels.create({ originalInput: "https://youtube.com/@example", resolved }),
    ).rejects.toBeInstanceOf(ChannelConflictError);

    const capturedAt = new Date("2026-08-22T00:00:00.000Z");
    await channels.createSnapshot({
      channelId: channel.id,
      capturedAt,
      subscriberCount: 10n,
      videoCount: null,
      lifetimeViewCount: 100n,
      lastUploadAt: null,
      source: "YTDLP",
      sourceDetails: {
        lifetimeViewCount: { source: "YTDLP", capturedAt: capturedAt.toISOString() },
      },
    });
    await expect(
      client.channelSnapshot.findFirst({ where: { channelId: channel.id } }),
    ).resolves.toMatchObject({
      subscriberCount: 10n,
      videoCount: null,
      source: "YTDLP",
    });
  });

  it("upserts daily stats without inventing a missing previous-day delta", async () => {
    const channel = await channels.create({ originalInput: "@example", resolved });
    const date = new Date("2026-08-22T00:00:00.000Z");
    await expect(
      dailyStats.upsert({
        channelId: channel.id,
        date,
        subscriberCount: 10n,
        videoCount: 2n,
        lifetimeViewCount: 100n,
        subscriberDelta: null,
        videoDelta: null,
        viewDelta: null,
        coverageStatus: "COMPLETE",
        sourceSummary: { source: "YTDLP" },
      }),
    ).resolves.toMatchObject({ coverageStatus: "COMPLETE", subscriberDelta: null });
    await expect(dailyStats.findByChannelAndDate(channel.id, date)).resolves.toMatchObject({
      lifetimeViewCount: 100n,
    });
  });

  it("records safe sync lifecycle metadata", async () => {
    const channel = await channels.create({ originalInput: "@example", resolved });
    const run = await syncRuns.create({
      channelId: channel.id,
      jobType: "CHANNEL_RESOLVE",
      status: "RUNNING",
    });
    await expect(
      syncRuns.complete(run.id, {
        status: "SUCCESS",
        completedAt: new Date("2026-08-22T00:00:01.000Z"),
        recordsProcessed: 1,
      }),
    ).resolves.toMatchObject({ status: "SUCCESS", recordsProcessed: 1, errorMessageSafe: null });
  });
});
