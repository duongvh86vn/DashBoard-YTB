// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { ChannelDetailScreen } from "./channel-detail-screen.js";

const channelId = "00000000-0000-4000-8000-000000000010";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function channelResponse() {
  return {
    channel: {
      id: channelId,
      youtubeChannelId: "UC0000000000000000000000",
      originalInput: "@kenhmau",
      canonicalUrl: "https://www.youtube.com/channel/UC0000000000000000000000",
      handle: "@kenhmau",
      title: "Kênh Mẫu",
      description: null,
      thumbnail: null,
      subscriberCount: "999999",
      videoCount: "999",
      lifetimeViewCount: "9999999",
      lastUploadAt: "2026-08-24T08:00:00.000Z",
      availabilityStatus: "ACTIVE",
      activityStatus: "ACTIVE",
      lastChannelScanAt: "2026-08-24T09:00:00.000Z",
      lastHealthCheckAt: "2026-08-24T09:00:00.000Z",
      lastSeenAliveAt: "2026-08-24T09:00:00.000Z",
      isEnabled: true,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-24T09:00:00.000Z",
      archivedAt: null,
    },
  };
}

function metric(value: string | null, precision = "EXACT_AS_PUBLISHED") {
  return {
    value,
    status: value === null ? "UNAVAILABLE" : "READY",
    metricClass: "PUBLIC_CURRENT",
    precision,
    unit: "COUNT",
    reason: value === null ? "NO_CURRENT_SNAPSHOT" : null,
    provenance: {
      source: "CHANNEL_DAILY_STAT",
      capturedAt: "2026-08-26T00:10:00.000Z",
      baselineDate: null,
      method: "canonical-snapshot-current",
      methodVersion: "v1",
    },
  };
}

function intelligenceResponse() {
  const unavailable = metric(null);
  return {
    channelId,
    asOf: "2026-08-26T00:10:00.000Z",
    period: {
      startDate: "2026-07-28",
      endDate: "2026-08-26",
      days: 30,
      timeZone: "Asia/Bangkok",
    },
    metrics: {
      lifetimeViews: metric("144693948"),
      subscribers: metric("406000", "ROUNDED_3_SIGNIFICANT_DIGITS"),
      publicVideos: metric("183"),
      viewsGained: unavailable,
      subscribersGained: unavailable,
      publicInventoryDelta: unavailable,
      publishedVideos: unavailable,
      averageVideoDurationSeconds: { ...unavailable, unit: "SECONDS" },
      uploadFrequencyPerWeek: { ...unavailable, unit: "UPLOADS_PER_WEEK" },
    },
    coverage: {
      requestedDays: 30,
      completeDays: 0,
      partialDays: 0,
      coveragePercent: 0,
      hasCurrentSnapshot: true,
      hasBaseline: false,
      reportedPublicVideos: "183",
      knownPublicVideos: 0,
      durationKnownVideos: 0,
    },
    warnings: [],
  };
}

function authResponse() {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000002",
      email: "viewer@example.com",
      role: "VIEWER",
      isEnabled: true,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      disabledAt: null,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChannelDetailScreen current public intelligence", () => {
  it("uses typed intelligence totals instead of stale channel header counters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse(authResponse()));
        if (path === `/api/v1/channels/${channelId}`) {
          return Promise.resolve(jsonResponse(channelResponse()));
        }
        if (path === `/api/v1/channels/${channelId}/public-intelligence?days=30`) {
          return Promise.resolve(jsonResponse(intelligenceResponse()));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <ChannelDetailScreen channelId={channelId} />
      </AuthProvider>,
    );

    expect(await screen.findByText("Người đăng ký hiện tại")).toBeInTheDocument();
    expect(screen.getByText("406.000")).toBeInTheDocument();
    expect(screen.queryByText("999.999")).not.toBeInTheDocument();
    expect(screen.queryByText("9.999.999")).not.toBeInTheDocument();
  });

  it("shows an honest unavailable state without falling back to channel counters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse(authResponse()));
        if (path === `/api/v1/channels/${channelId}`) {
          return Promise.resolve(jsonResponse(channelResponse()));
        }
        if (path === `/api/v1/channels/${channelId}/public-intelligence?days=30`) {
          return Promise.resolve(
            jsonResponse({ error: { code: "DATABASE_ERROR", message: "internal" } }, 503),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <ChannelDetailScreen channelId={channelId} />
      </AuthProvider>,
    );

    expect(
      await screen.findByText(
        "Số liệu công khai hiện tại chưa khả dụng; không dùng bộ đếm cũ của hồ sơ kênh để thay thế.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("999.999")).not.toBeInTheDocument();
    expect(screen.queryByText("9.999.999")).not.toBeInTheDocument();
  });
});
