import { describe, expect, it } from "vitest";

import { transitionChannelHealth } from "./state-machine.js";

const baseState = {
  availabilityStatus: "ACTIVE" as const,
  activityStatus: "ACTIVE_RECENT" as const,
  consecutiveHealthFailures: 0,
  firstUnavailableAt: null,
  lastSeenAliveAt: new Date("2026-08-22T00:00:00.000Z"),
};

const evidence = {
  evidenceCode: "UNKNOWN" as const,
  evidenceTextSafe: null,
  httpStatus: null,
  durationMs: 10,
};

describe("channel health state machine", () => {
  it("keeps a channel active when public success exists despite yt-dlp failure", () => {
    const result = transitionChannelHealth({
      state: baseState,
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: { publicPage: "PUBLIC_PAGE_RENDERED", ytdlp: "YTDLP_ERROR", rss: "RSS_MISSING" },
      evidence: { ...evidence, evidenceCode: "ACTIVE_PUBLIC_PAGE" },
    });
    expect(result.normalizedAvailability).toBe("ACTIVE");
    expect(result.state.consecutiveHealthFailures).toBe(0);
    expect(result.deletionConfirmed).toBe(false);
  });

  it("does not delete on CAPTCHA/network failure", () => {
    const result = transitionChannelHealth({
      state: baseState,
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: { publicPage: "PUBLIC_PAGE_BLOCKED", ytdlp: "YTDLP_ERROR", rss: "NETWORK_ERROR" },
      evidence: { ...evidence, evidenceCode: "BLOCKED_PUBLIC_PAGE" },
    });
    expect(result.normalizedAvailability).toBe("UNKNOWN");
    expect(result.deletionConfirmed).toBe(false);
    expect(result.retryAt).toEqual(new Date("2026-08-22T01:30:00.000Z"));
  });

  it("requires a second temporal confirmation before deletion", () => {
    const first = transitionChannelHealth({
      state: baseState,
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: { publicPage: "PUBLIC_PAGE_NOT_FOUND", ytdlp: "YTDLP_ERROR", rss: "RSS_MISSING" },
      evidence: { ...evidence, evidenceCode: "NOT_FOUND_PUBLIC_PAGE" },
    });
    expect(first.normalizedAvailability).toBe("NOT_FOUND");
    expect(first.deletionConfirmed).toBe(false);

    const second = transitionChannelHealth({
      state: first.state,
      checkedAt: new Date("2026-08-22T01:31:00.000Z"),
      signals: { publicPage: "PUBLIC_PAGE_NOT_FOUND", ytdlp: "YTDLP_ERROR", rss: "RSS_MISSING" },
      evidence: { ...evidence, evidenceCode: "NOT_FOUND_PUBLIC_PAGE" },
    });
    expect(second.normalizedAvailability).toBe("DELETED_OR_TERMINATED");
    expect(second.deletionConfirmed).toBe(true);
  });

  it("allows two independent strong signals in one check", () => {
    const result = transitionChannelHealth({
      state: baseState,
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: {
        publicPage: "PUBLIC_PAGE_TERMINATED",
        ytdlp: "YTDLP_NOT_FOUND",
        rss: "RSS_MISSING",
      },
      evidence: { ...evidence, evidenceCode: "TERMINATED_PUBLIC_PAGE" },
    });
    expect(result.normalizedAvailability).toBe("DELETED_OR_TERMINATED");
    expect(result.deletionConfirmed).toBe(true);
  });

  it("resets failure state on recovery", () => {
    const result = transitionChannelHealth({
      state: {
        ...baseState,
        availabilityStatus: "NOT_FOUND",
        consecutiveHealthFailures: 1,
        firstUnavailableAt: new Date("2026-08-22T00:00:00.000Z"),
      },
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: { publicPage: "PUBLIC_PAGE_RENDERED", ytdlp: "YTDLP_OK", rss: "RSS_OK" },
      evidence: { ...evidence, evidenceCode: "ACTIVE_PUBLIC_PAGE" },
    });
    expect(result.normalizedAvailability).toBe("ACTIVE");
    expect(result.state.consecutiveHealthFailures).toBe(0);
    expect(result.state.firstUnavailableAt).toBeNull();
  });

  it("never changes archived channels", () => {
    const result = transitionChannelHealth({
      state: { ...baseState, availabilityStatus: "ARCHIVED" },
      checkedAt: new Date("2026-08-22T01:00:00.000Z"),
      signals: {
        publicPage: "PUBLIC_PAGE_NOT_FOUND",
        ytdlp: "YTDLP_NOT_FOUND",
        rss: "RSS_MISSING",
      },
      evidence: { ...evidence, evidenceCode: "ARCHIVED" },
    });
    expect(result.normalizedAvailability).toBe("ARCHIVED");
    expect(result.deletionConfirmed).toBe(false);
  });
});
