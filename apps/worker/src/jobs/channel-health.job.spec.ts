import { describe, expect, it, vi } from "vitest";

import type { ChannelRecord } from "@yt-monitor/db";
import { ChannelHealthJob } from "./channel-health.job.js";

const channel = {
  id: "00000000-0000-4000-8000-000000000003",
  youtubeChannelId: "UC1234567890123456789012",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  handle: "@example",
  title: "Example",
  availabilityStatus: "ACTIVE" as const,
  activityStatus: "ACTIVE_RECENT" as const,
  consecutiveHealthFailures: 0,
  firstUnavailableAt: null,
  lastSeenAliveAt: new Date("2026-08-22T00:00:00.000Z"),
} as ChannelRecord;

function makeJob(overrides: Partial<ConstructorParameters<typeof ChannelHealthJob>[0]> = {}) {
  const healthCreate = vi.fn();
  const updateHealth = vi.fn();
  const syncCreate = vi.fn(async () => ({ id: "sync-1" }));
  const syncComplete = vi.fn();
  const unitOfWork = {
    transaction: async (work: (repositories: unknown) => Promise<unknown>) =>
      work({
        healthChecks: { create: healthCreate },
        channels: { updateHealth },
        syncRuns: { create: syncCreate, complete: syncComplete },
      }),
  };
  const job = new ChannelHealthJob({
    unitOfWork: unitOfWork as never,
    publicCheck: async () => ({
      status: "PUBLIC_PAGE_RENDERED" as const,
      channelId: channel.youtubeChannelId,
      evidence: {
        evidenceCode: "ACTIVE_PUBLIC_PAGE" as const,
        evidenceTextSafe: "Example",
        httpStatus: 200,
        durationMs: 10,
      },
    }),
    ytdlpCheck: async () => ({ status: "YTDLP_ERROR" as const }),
    rssCheck: async () => ({ status: "RSS_MISSING" as const }),
    now: () => new Date("2026-08-22T01:00:00.000Z"),
    ...overrides,
  });
  return { job, healthCreate, updateHealth, syncComplete };
}

describe("ChannelHealthJob", () => {
  it("records public success and resets stale failures", async () => {
    const { job, healthCreate, updateHealth } = makeJob();
    const result = await job.run(channel);
    expect(result.normalizedAvailability).toBe("ACTIVE");
    expect(healthCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        publicPageStatus: "PUBLIC_PAGE_RENDERED",
        normalizedAvailability: "ACTIVE",
      }),
    );
    expect(updateHealth).toHaveBeenCalledWith(
      channel.id,
      expect.objectContaining({
        consecutiveHealthFailures: 0,
      }),
    );
  });

  it("does not transition deletion during a provider incident", async () => {
    const { job, healthCreate, syncComplete } = makeJob({
      circuitOpen: () => true,
      publicCheck: async () => ({
        status: "PUBLIC_PAGE_NOT_FOUND" as const,
        channelId: null,
        evidence: {
          evidenceCode: "NOT_FOUND_PUBLIC_PAGE" as const,
          evidenceTextSafe: "not found",
          httpStatus: 404,
          durationMs: 10,
        },
      }),
      ytdlpCheck: async () => ({ status: "YTDLP_NOT_FOUND" as const }),
      rssCheck: async () => ({ status: "RSS_MISSING" as const }),
    });
    const result = await job.run(channel);
    expect(result.deletionConfirmed).toBe(false);
    expect(healthCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedAvailability: "ACTIVE",
        evidenceCode: "PROVIDER_INCIDENT",
      }),
    );
    expect(syncComplete).toHaveBeenCalledWith(
      "sync-1",
      expect.objectContaining({
        status: "PARTIAL",
        errorCode: "SYSTEM_PROVIDER_INCIDENT",
      }),
    );
  });
});
