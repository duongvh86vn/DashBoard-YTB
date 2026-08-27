import { describe, expect, it, vi } from "vitest";

import { DashboardService } from "./dashboard.service.js";

const firstChannelId = "00000000-0000-4000-8000-000000000101";
const secondChannelId = "00000000-0000-4000-8000-000000000102";
const subject = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "ADMIN" as const,
};

function channel(input: {
  id: string;
  title: string;
  lifetimeViewCount: bigint | null;
  lastChannelScanAt: Date | null;
}) {
  return {
    id: input.id,
    youtubeChannelId: `UC${input.id.replace(/-/gu, "").slice(0, 22)}`,
    originalInput: input.title,
    canonicalUrl: `https://www.youtube.com/channel/${input.id}`,
    handle: null,
    title: input.title,
    description: null,
    thumbnail: null,
    subscriberCount: null,
    videoCount: null,
    lifetimeViewCount: input.lifetimeViewCount,
    lastUploadAt: null,
    availabilityStatus: "ACTIVE" as const,
    activityStatus: "UNKNOWN" as const,
    lastChannelScanAt: input.lastChannelScanAt,
    lastHealthCheckAt: null,
    lastSeenAliveAt: null,
    consecutiveHealthFailures: 0,
    firstUnavailableAt: null,
    isEnabled: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T08:00:00.000Z"),
    archivedAt: null,
  };
}

function dailyStat(
  channelId: string,
  date: string,
  viewDelta: bigint | null,
  lifetimeViewCount: bigint | null = null,
) {
  return {
    id: `${channelId}-${date}`,
    channelId,
    date: new Date(`${date}T00:00:00.000Z`),
    subscriberCount: null,
    videoCount: null,
    lifetimeViewCount,
    subscriberDelta: null,
    videoDelta: null,
    viewDelta,
    coverageStatus: viewDelta === null ? ("PARTIAL" as const) : ("COMPLETE" as const),
    sourceSummary: {},
    createdAt: new Date(`${date}T00:00:00.000Z`),
    updatedAt: new Date(`${date}T00:00:00.000Z`),
  };
}

function setting(input: {
  id: string;
  channelId: string;
  effectiveDate: string;
  isMonetized: boolean;
  rpmMicros: bigint | null;
}) {
  return {
    id: input.id,
    channelId: input.channelId,
    effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`),
    isMonetized: input.isMonetized,
    rpmMicros: input.rpmMicros,
    currency: "USD",
    recordedByUserId: subject.id,
    createdAt: new Date(`${input.effectiveDate}T01:00:00.000Z`),
    updatedAt: new Date(`${input.effectiveDate}T01:00:00.000Z`),
  };
}

function fixture(input: {
  channels: ReturnType<typeof channel>[];
  stats: ReturnType<typeof dailyStat>[];
  settings: ReturnType<typeof setting>[];
  selectedChannelIds?: string[] | null;
}) {
  const resolveSelectedChannelIds = vi.fn(async () => input.selectedChannelIds ?? null);
  return {
    resolveSelectedChannelIds,
    value: new DashboardService({
      access: {
        resolveVisibleChannelIds: async () => null,
        resolveSelectedChannelIds,
      },
      timeZone: "Asia/Bangkok",
      now: () => new Date("2026-08-25T08:00:00.000Z"),
      unitOfWork: {
        transaction: async (work) =>
          work({
            channels: {
              listEnabled: async (ids?: readonly string[]) =>
                ids === undefined
                  ? input.channels
                  : input.channels.filter((item) => ids.includes(item.id)),
            },
            dailyStats: {
              listByChannelsAndDateRange: async (ids: readonly string[]) =>
                input.stats.filter((item) => ids.includes(item.channelId)),
            },
            channelMonetization: {
              listEffectiveThroughDate: async (ids: readonly string[]) =>
                input.settings.filter((item) => ids.includes(item.channelId)),
            },
          } as never),
      },
    }),
  };
}

describe("DashboardService revenue", () => {
  it("calculates signed revenue from canonical daily deltas even when the live counter has drifted", async () => {
    const result = await fixture({
      channels: [
        channel({
          id: firstChannelId,
          title: "Monetized",
          lifetimeViewCount: 2_000n,
          lastChannelScanAt: new Date("2026-08-25T08:00:00.000Z"),
        }),
        channel({
          id: secondChannelId,
          title: "Disabled",
          lifetimeViewCount: null,
          lastChannelScanAt: null,
        }),
      ],
      stats: [
        dailyStat(firstChannelId, "2026-08-23", 1_000n),
        dailyStat(firstChannelId, "2026-08-24", -500n, 1_500n),
        dailyStat(firstChannelId, "2026-08-25", 250n, 1_750n),
      ],
      settings: [
        setting({
          id: "setting-1",
          channelId: firstChannelId,
          effectiveDate: "2026-08-23",
          isMonetized: true,
          rpmMicros: 2_000_000n,
        }),
        setting({
          id: "setting-2",
          channelId: secondChannelId,
          effectiveDate: "2026-08-23",
          isMonetized: false,
          rpmMicros: null,
        }),
      ],
    }).value.revenue({ days: 3, subject });

    expect(result.metric).toEqual({
      totalEstimatedRevenueUsd: "1.5",
      observedEstimatedRevenueUsd: "1.5",
      status: "COMPLETE",
      coveredChannelDays: 6,
      totalChannelDays: 6,
    });
    expect(result.series).toEqual([
      {
        date: "2026-08-23",
        totalEstimatedRevenueUsd: "2",
        observedEstimatedRevenueUsd: "2",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
      {
        date: "2026-08-24",
        totalEstimatedRevenueUsd: "-1",
        observedEstimatedRevenueUsd: "-1",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
      {
        date: "2026-08-25",
        totalEstimatedRevenueUsd: "0.5",
        observedEstimatedRevenueUsd: "0.5",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
    ]);
    expect(result.channels).toEqual([
      expect.objectContaining({
        channelId: secondChannelId,
        monetizationStatus: "DISABLED",
        rpmUsd: null,
        totalEstimatedRevenueUsd: "0",
        status: "COMPLETE",
      }),
      expect.objectContaining({
        channelId: firstChannelId,
        monetizationStatus: "ENABLED",
        rpmUsd: "2",
        totalEstimatedRevenueUsd: "1.5",
        status: "COMPLETE",
      }),
    ]);
  });

  it("keeps missing RPM or view deltas unknown and labels observed revenue as partial only", async () => {
    const result = await fixture({
      channels: [
        channel({
          id: firstChannelId,
          title: "Partial",
          lifetimeViewCount: 99_000n,
          lastChannelScanAt: new Date("2026-08-25T08:00:00.000Z"),
        }),
        channel({
          id: secondChannelId,
          title: "Unconfigured",
          lifetimeViewCount: null,
          lastChannelScanAt: null,
        }),
      ],
      stats: [dailyStat(firstChannelId, "2026-08-24", 1_000n, 50_000n)],
      settings: [
        setting({
          id: "setting-1",
          channelId: firstChannelId,
          effectiveDate: "2026-08-24",
          isMonetized: true,
          rpmMicros: 1_500_000n,
        }),
      ],
    }).value.revenue({ days: 2, subject });

    expect(result.metric).toEqual({
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: "1.5",
      status: "PARTIAL",
      coveredChannelDays: 1,
      totalChannelDays: 4,
    });
    expect(result.series[1]).toMatchObject({
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: null,
      status: "UNAVAILABLE",
      coveredChannels: 0,
    });
    expect(result.channels.find((item) => item.channelId === secondChannelId)).toMatchObject({
      monetizationStatus: "UNCONFIGURED",
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: null,
      status: "UNAVAILABLE",
      coveredDays: 0,
    });
  });

  it("applies the exact resolved channel scope before reading metrics or settings", async () => {
    const scoped = fixture({
      channels: [
        channel({
          id: firstChannelId,
          title: "Visible",
          lifetimeViewCount: null,
          lastChannelScanAt: null,
        }),
        channel({
          id: secondChannelId,
          title: "Hidden",
          lifetimeViewCount: null,
          lastChannelScanAt: null,
        }),
      ],
      stats: [],
      settings: [],
      selectedChannelIds: [firstChannelId],
    });

    const result = await scoped.value.revenue({
      days: 1,
      groupId: "00000000-0000-4000-8000-000000000201",
      channelId: firstChannelId,
      subject,
    });

    expect(result.totalChannels).toBe(1);
    expect(result.channels.map((item) => item.channelId)).toEqual([firstChannelId]);
    expect(scoped.resolveSelectedChannelIds).toHaveBeenCalledOnce();
  });

  it("returns a strict unavailable response for an empty selected cohort", async () => {
    const result = await fixture({
      channels: [],
      stats: [],
      settings: [],
      selectedChannelIds: [],
    }).value.revenue({ days: 2, subject });

    expect(result).toMatchObject({
      metric: {
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: null,
        status: "UNAVAILABLE",
        coveredChannelDays: 0,
        totalChannelDays: 0,
      },
      configuredChannels: 0,
      monetizedChannels: 0,
      totalChannels: 0,
      channels: [],
    });
    expect(result.series).toEqual([
      {
        date: "2026-08-24",
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: null,
        status: "UNAVAILABLE",
        coveredChannels: 0,
        totalChannels: 0,
      },
      {
        date: "2026-08-25",
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: null,
        status: "UNAVAILABLE",
        coveredChannels: 0,
        totalChannels: 0,
      },
    ]);
  });
});
