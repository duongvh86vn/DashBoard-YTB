// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page.js";
import { AuthProvider } from "../../lib/auth-context.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const emptyDashboardTrend = {
  period: {
    startDate: "2026-07-28",
    endDate: "2026-08-24",
    days: 28,
    timeZone: "Asia/Bangkok",
  },
  totals: { viewDelta: null, subscriberDelta: null, publishedVideos: 0 },
  coverage: {
    totalChannels: 0,
    channelsWithCurrentSnapshot: 0,
    channelsWithBaseline: 0,
    requestedDays: 28,
    completeDays: 0,
    partialDays: 0,
    coveragePercent: 0,
  },
  series: [],
};

const populatedDashboardTrend = {
  ...emptyDashboardTrend,
  totals: { viewDelta: "3500", subscriberDelta: "42", publishedVideos: 2 },
  coverage: {
    totalChannels: 2,
    channelsWithCurrentSnapshot: 2,
    channelsWithBaseline: 2,
    requestedDays: 28,
    completeDays: 28,
    partialDays: 0,
    coveragePercent: 100,
  },
  series: [
    {
      date: "2026-08-22",
      viewDelta: "1000",
      subscriberDelta: "12",
      publishedVideos: 1,
      hasSnapshot: true,
    },
    {
      date: "2026-08-23",
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 0,
      hasSnapshot: false,
    },
    {
      date: "2026-08-24",
      viewDelta: "2500",
      subscriberDelta: "30",
      publishedVideos: 1,
      hasSnapshot: true,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Phase 8 dashboard", () => {
  it("renders real-data summary surfaces and empty states without fabrication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") {
          return Promise.resolve(
            jsonResponse({
              user: {
                id: "00000000-0000-4000-8000-000000000002",
                email: "viewer@example.com",
                role: "VIEWER",
                isEnabled: true,
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z",
                disabledAt: null,
              },
            }),
          );
        }
        if (path.startsWith("/api/v1/channels?")) {
          return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 100, total: 0 }));
        }
        if (path.startsWith("/api/v1/videos/recent?")) {
          return Promise.resolve(
            jsonResponse({ items: [], page: 1, pageSize: 6, total: 0, warmingUpCount: 0 }),
          );
        }
        if (path.startsWith("/api/v1/videos/rankings/weekly?")) {
          return Promise.resolve(
            jsonResponse({ items: [], page: 1, pageSize: 5, total: 0, warmingUpCount: 0 }),
          );
        }
        if (path === "/api/v1/dashboard/trends?days=28") {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        if (path.includes("/api/v1/ai/reports/daily/")) {
          return Promise.resolve(
            jsonResponse({
              kind: "DAILY",
              reportDate: "2026-08-23",
              available: false,
              report: null,
            }),
          );
        }
        if (path.includes("/api/v1/ai/reports/weekly/")) {
          return Promise.resolve(
            jsonResponse({
              kind: "WEEKLY",
              reportDate: "2026-08-23",
              available: false,
              report: null,
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );
    const { container } = render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Tổng quan giám sát" })).toBeInTheDocument();
    expect(await screen.findByText("Chưa có video snapshot thật.")).toBeInTheDocument();
    expect(screen.getByText("Chưa đủ baseline 7 ngày để xếp hạng.")).toBeInTheDocument();
    expect(container.querySelector('a[href*="health"]')).toBeNull();
    expect(screen.getByText("Kênh đang theo dõi")).toBeInTheDocument();
    expect(screen.getByText("Chưa có kênh để phân tích")).toBeInTheDocument();
  });

  it("turns canonical channel and video snapshots into accessible charts", async () => {
    const rankedVideo = {
      rank: 1,
      channelId: "00000000-0000-4000-8000-000000000010",
      channelTitle: "Kênh Mẫu",
      thumbnail: null,
      currentLikes: "100",
      currentComments: "10",
      status: "READY",
      vph1h: null,
      vph3h: null,
      vph6h: null,
      smoothedVph: null,
      breakout24h: null,
      breakout48h: null,
      breakout7d: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") {
          return Promise.resolve(
            jsonResponse({
              user: {
                id: "00000000-0000-4000-8000-000000000002",
                email: "viewer@example.com",
                role: "VIEWER",
                isEnabled: true,
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z",
                disabledAt: null,
              },
            }),
          );
        }
        if (path.startsWith("/api/v1/channels?")) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000010",
                  youtubeChannelId: "UC0000000000000000000000",
                  originalInput: "@kenhmau",
                  canonicalUrl: "https://www.youtube.com/channel/UC0000000000000000000000",
                  handle: "@kenhmau",
                  title: "Kênh Mẫu",
                  description: null,
                  thumbnail: null,
                  subscriberCount: "1250",
                  videoCount: "48",
                  lifetimeViewCount: "10000",
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
                {
                  id: "00000000-0000-4000-8000-000000000011",
                  youtubeChannelId: "UC1111111111111111111111",
                  originalInput: "@kenhthuhai",
                  canonicalUrl: "https://www.youtube.com/channel/UC1111111111111111111111",
                  handle: "@kenhthuhai",
                  title: "Kênh Thứ Hai",
                  description: null,
                  thumbnail: null,
                  subscriberCount: null,
                  videoCount: "12",
                  lifetimeViewCount: "20000",
                  lastUploadAt: "2026-08-24T07:00:00.000Z",
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
              ],
              page: 1,
              pageSize: 100,
              total: 2,
            }),
          );
        }
        if (path.startsWith("/api/v1/videos/recent?")) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  ...rankedVideo,
                  id: "00000000-0000-4000-8000-000000000020",
                  youtubeVideoId: "video-recent",
                  title: "Video mới nhất",
                  publishedAt: "2026-08-24T08:00:00.000Z",
                  currentViews: "2500",
                  weeklyGain: null,
                  baselineAt: null,
                },
              ],
              page: 1,
              pageSize: 6,
              total: 1,
              warmingUpCount: 0,
            }),
          );
        }
        if (path.startsWith("/api/v1/videos/rankings/weekly?")) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  ...rankedVideo,
                  id: "00000000-0000-4000-8000-000000000021",
                  youtubeVideoId: "video-weekly",
                  title: "Video tăng trưởng",
                  publishedAt: "2026-08-20T08:00:00.000Z",
                  currentViews: "5000",
                  currentLikes: "200",
                  currentComments: "20",
                  weeklyGain: "500",
                  baselineAt: "2026-08-17T08:00:00.000Z",
                },
              ],
              page: 1,
              pageSize: 5,
              total: 1,
              warmingUpCount: 0,
            }),
          );
        }
        if (path === "/api/v1/dashboard/trends?days=28") {
          return Promise.resolve(jsonResponse(populatedDashboardTrend));
        }
        if (path.includes("/api/v1/ai/reports/daily/")) {
          return Promise.resolve(
            jsonResponse({
              kind: "DAILY",
              reportDate: "2026-08-24",
              available: false,
              report: null,
            }),
          );
        }
        if (path.includes("/api/v1/ai/reports/weekly/")) {
          return Promise.resolve(
            jsonResponse({
              kind: "WEEKLY",
              reportDate: "2026-08-24",
              available: false,
              report: null,
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "So sánh các kênh" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hiệu suất video" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bảng chỉ số kênh" })).toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: "Phân tích 30 ngày" })).toHaveLength(2);
    expect(await screen.findByRole("img", { name: "Kênh Mẫu: 1.250" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Video mới nhất: 2.500" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Video tăng trưởng: +500" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Các kênh tăng 3.500 lượt xem trong 28 ngày qua" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Lượt xem tăng trong 28 ngày/ })).toBeInTheDocument();

    const lifetimeViews = screen.getByText("Tổng lượt xem trọn đời").closest("article");
    expect(lifetimeViews).not.toBeNull();
    expect(within(lifetimeViews!).getByText("30.000")).toBeInTheDocument();

    const subscribers = screen.getByText("Tổng người đăng ký").closest("article");
    expect(subscribers).not.toBeNull();
    expect(within(subscribers!).getByText("—")).toBeInTheDocument();
    expect(within(subscribers!).getByText("1/2 kênh có snapshot")).toBeInTheDocument();
  });

  it("keeps canonical charts visible when ADMIN health and AI requests fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/auth/me") {
          return Promise.resolve(
            jsonResponse({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "admin@example.com",
                role: "ADMIN",
                isEnabled: true,
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z",
                disabledAt: null,
              },
            }),
          );
        }
        if (path.startsWith("/api/v1/channels?")) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000010",
                  youtubeChannelId: "UC0000000000000000000000",
                  originalInput: "@kenhmau",
                  canonicalUrl: "https://www.youtube.com/channel/UC0000000000000000000000",
                  handle: "@kenhmau",
                  title: "Kênh vẫn hiển thị",
                  description: null,
                  thumbnail: null,
                  subscriberCount: "1250",
                  videoCount: "48",
                  lifetimeViewCount: "10000",
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
              ],
              page: 1,
              pageSize: 100,
              total: 1,
            }),
          );
        }
        if (path.startsWith("/api/v1/videos/recent?")) {
          return Promise.resolve(
            jsonResponse({ items: [], page: 1, pageSize: 6, total: 0, warmingUpCount: 0 }),
          );
        }
        if (path.startsWith("/api/v1/videos/rankings/weekly?")) {
          return Promise.resolve(
            jsonResponse({ items: [], page: 1, pageSize: 5, total: 0, warmingUpCount: 0 }),
          );
        }
        if (path === "/api/v1/dashboard/trends?days=28") {
          return Promise.resolve(
            jsonResponse({ error: { code: "DATABASE_ERROR", message: "internal detail" } }, 503),
          );
        }
        if (path === "/api/v1/health" || path.includes("/api/v1/ai/reports/daily/")) {
          return Promise.resolve(
            jsonResponse({ error: { code: "DATABASE_ERROR", message: "internal detail" } }, 503),
          );
        }
        if (path.includes("/api/v1/ai/reports/weekly/")) {
          return Promise.resolve(
            jsonResponse({
              kind: "WEEKLY",
              reportDate: "2026-08-24",
              available: false,
              report: null,
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    expect(
      await screen.findByRole("img", { name: "Kênh vẫn hiển thị: 1.250" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Health check tạm thời không khả dụng")).toBeInTheDocument();
    expect(
      screen.getByText("Không tải được một phần báo cáo AI. Dữ liệu canonical không bị ảnh hưởng."),
    ).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu xu hướng tạm thời không khả dụng.")).toBeInTheDocument();
  });
});
