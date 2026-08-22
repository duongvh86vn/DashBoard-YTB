import { describe, expect, it, vi } from "vitest";

import { ChannelHealthScheduler } from "./channel-health.scheduler.js";

describe("ChannelHealthScheduler", () => {
  it("processes enabled channels sequentially and retains a circuit window", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        normalizedAvailability: "ACTIVE",
        deletionConfirmed: false,
        retryAt: null,
        signals: { publicPage: "PUBLIC_PAGE_RENDERED", ytdlp: "YTDLP_OK", rss: "RSS_OK" },
      })
      .mockResolvedValueOnce({
        normalizedAvailability: "UNKNOWN",
        deletionConfirmed: false,
        retryAt: null,
        signals: { publicPage: "TIMEOUT", ytdlp: "YTDLP_ERROR", rss: "NETWORK_ERROR" },
      });
    const scheduler = new ChannelHealthScheduler({
      channels: {
        listEnabled: async () => [{ id: "one" }, { id: "two" }] as never,
      },
      job: { run } as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      intervalMs: 60_000,
    });
    await scheduler.runOnce();
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.circuitState()).toMatchObject({ samples: 2, open: false });
  });

  it("stops and starts its timer idempotently", () => {
    vi.useFakeTimers();
    try {
      const scheduler = new ChannelHealthScheduler({
        channels: { listEnabled: async () => [] },
        job: { run: vi.fn() } as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        intervalMs: 60_000,
      });
      scheduler.start();
      scheduler.start();
      scheduler.stop();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
