import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ChannelMonetizationRepository } from "./channel-monetization.repository.js";
import { createPrismaClient } from "./client.js";
import { VideoCatalogScanRepository } from "./video-catalog-scan.repository.js";
import { VideoRepository } from "./video.repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const client = createPrismaClient(databaseUrl);
const monetization = new ChannelMonetizationRepository(client);
const scans = new VideoCatalogScanRepository(client);
const videos = new VideoRepository(client);
const channelIds: string[] = [];
const userIds: string[] = [];

async function createFixtures(label: string) {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await client.user.create({
    data: {
      email: `${unique}@phase12-integration.example`,
      passwordHash: "integration-password-hash",
      role: "ADMIN",
    },
  });
  const channel = await client.channel.create({
    data: {
      youtubeChannelId: `UC${randomUUID().replace(/-/gu, "").slice(0, 22)}`,
      originalInput: `@${unique}`,
      canonicalUrl: `https://www.youtube.com/@${unique}`,
      title: `Phase 12 ${label}`,
    },
  });
  userIds.push(user.id);
  channelIds.push(channel.id);
  return { user, channel };
}

afterEach(async () => {
  if (channelIds.length > 0) {
    await client.videoSnapshot.deleteMany({ where: { channelId: { in: channelIds } } });
    await client.videoCatalogScan.deleteMany({ where: { channelId: { in: channelIds } } });
    await client.video.deleteMany({ where: { channelId: { in: channelIds } } });
    await client.channelMonetizationSetting.deleteMany({
      where: { channelId: { in: channelIds } },
    });
    await client.channel.deleteMany({ where: { id: { in: channelIds } } });
    channelIds.length = 0;
  }
  if (userIds.length > 0) {
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  }
});

afterAll(async () => client.$disconnect());

describe("Phase 12 repositories against PostgreSQL", () => {
  it("keeps effective-dated RPM history and updates only the matching review date", async () => {
    const { user, channel } = await createFixtures("rpm-history");
    const firstDate = new Date("2026-08-20T00:00:00.000Z");
    const reviewDate = new Date("2026-08-27T00:00:00.000Z");

    await monetization.upsert({
      channelId: channel.id,
      effectiveDate: firstDate,
      isMonetized: true,
      rpmMicros: 1_250_000n,
      recordedByUserId: user.id,
    });
    await monetization.upsert({
      channelId: channel.id,
      effectiveDate: reviewDate,
      isMonetized: true,
      rpmMicros: 1_500_000n,
      recordedByUserId: user.id,
    });
    await monetization.upsert({
      channelId: channel.id,
      effectiveDate: reviewDate,
      isMonetized: false,
      rpmMicros: null,
      recordedByUserId: user.id,
    });

    await expect(
      monetization.latestEffectiveForChannel(channel.id, new Date("2026-08-26T00:00:00.000Z")),
    ).resolves.toMatchObject({ isMonetized: true, rpmMicros: 1_250_000n });
    await expect(
      monetization.latestEffectiveForChannel(channel.id, reviewDate),
    ).resolves.toMatchObject({ isMonetized: false, rpmMicros: null });
    await expect(
      client.channelMonetizationSetting.count({ where: { channelId: channel.id } }),
    ).resolves.toBe(2);
  });

  it("keeps the first catalog scan immutable per channel/day and returns exact buckets", async () => {
    const { channel } = await createFixtures("catalog-comparison");
    const date = new Date("2026-08-27T00:00:00.000Z");
    const baselineBucket = new Date("2026-08-25T17:00:00.000Z");
    const currentBucket = new Date("2026-08-26T17:00:00.000Z");
    const video = await client.video.create({
      data: {
        youtubeVideoId: `phase12-${Date.now()}`,
        channelId: channel.id,
        title: "Daily leader candidate",
        lastSeenAt: currentBucket,
      },
    });
    await client.videoSnapshot.createMany({
      data: [
        {
          videoId: video.id,
          channelId: channel.id,
          capturedAt: baselineBucket,
          snapshotBucket: baselineBucket,
          views: 1_000n,
          source: "YTDLP_CATALOG",
        },
        {
          videoId: video.id,
          channelId: channel.id,
          capturedAt: currentBucket,
          snapshotBucket: currentBucket,
          views: 7_000n,
          source: "YTDLP_CATALOG",
        },
      ],
    });

    const first = await scans.createIfAbsent({
      channelId: channel.id,
      date,
      capturedAt: currentBucket,
      snapshotBucket: currentBucket,
      totalVideos: 1,
      videosWithViews: 1,
      coverageStatus: "COMPLETE",
    });
    const second = await scans.createIfAbsent({
      channelId: channel.id,
      date,
      capturedAt: currentBucket,
      snapshotBucket: currentBucket,
      totalVideos: 2,
      videosWithViews: 1,
      coverageStatus: "PARTIAL",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record).toMatchObject({
      totalVideos: 1,
      videosWithViews: 1,
      coverageStatus: "COMPLETE",
      snapshotBucket: currentBucket,
    });
    await expect(
      client.videoCatalogScan.count({ where: { channelId: channel.id, date } }),
    ).resolves.toBe(1);
    await expect(
      videos.listForCatalogComparison([channel.id], [baselineBucket, currentBucket]),
    ).resolves.toMatchObject([
      {
        id: video.id,
        snapshots: [
          { snapshotBucket: baselineBucket, views: 1_000n, source: "YTDLP_CATALOG" },
          { snapshotBucket: currentBucket, views: 7_000n, source: "YTDLP_CATALOG" },
        ],
      },
    ]);
  });

  it("allows exactly one concurrent first writer for a channel/day", async () => {
    const { channel } = await createFixtures("catalog-concurrent-claim");
    const date = new Date("2026-08-27T00:00:00.000Z");
    const firstBucket = new Date("2026-08-26T17:20:00.000Z");
    const secondBucket = new Date("2026-08-26T17:21:00.000Z");
    const base = {
      channelId: channel.id,
      date,
      totalVideos: 1,
      videosWithViews: 1,
      coverageStatus: "COMPLETE" as const,
    };

    const results = await Promise.all([
      scans.createIfAbsent({
        ...base,
        capturedAt: firstBucket,
        snapshotBucket: firstBucket,
      }),
      scans.createIfAbsent({
        ...base,
        capturedAt: secondBucket,
        snapshotBucket: secondBucket,
      }),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.record.id))).toHaveLength(1);
    await expect(
      client.videoCatalogScan.count({ where: { channelId: channel.id, date } }),
    ).resolves.toBe(1);
  });

  it("rejects a scan labelled complete when any public view counter is missing", async () => {
    const { channel } = await createFixtures("catalog-coverage-constraint");

    await expect(
      client.videoCatalogScan.create({
        data: {
          channelId: channel.id,
          date: new Date("2026-08-27T00:00:00.000Z"),
          capturedAt: new Date("2026-08-26T17:20:00.000Z"),
          snapshotBucket: new Date("2026-08-26T17:20:00.000Z"),
          totalVideos: 2,
          videosWithViews: 1,
          coverageStatus: "COMPLETE",
        },
      }),
    ).rejects.toThrow();
  });
});
