// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page.js";
import { AuthProvider } from "../../lib/auth-context.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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

const scopeGroupAId = "00000000-0000-4000-8000-000000000030";
const scopeGroupBId = "00000000-0000-4000-8000-000000000031";
const scopeChannelId = "00000000-0000-4000-8000-000000000032";

const scopedChannel = {
  id: scopeChannelId,
  youtubeChannelId: "UC2222222222222222222222",
  originalInput: "@kenhphamvi",
  canonicalUrl: "https://www.youtube.com/channel/UC2222222222222222222222",
  handle: "@kenhphamvi",
  title: "Kênh phạm vi",
  description: null,
  thumbnail: null,
  subscriberCount: "25",
  videoCount: "3",
  lifetimeViewCount: "150",
  lastUploadAt: null,
  availabilityStatus: "ACTIVE",
  activityStatus: "ACTIVE",
  lastChannelScanAt: "2026-08-26T12:00:00.000Z",
  lastHealthCheckAt: null,
  lastSeenAliveAt: "2026-08-26T12:00:00.000Z",
  isEnabled: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-26T12:00:00.000Z",
  archivedAt: null,
};

const accessibleScopeGroups = {
  items: [
    {
      id: scopeGroupAId,
      name: "Nhóm A",
      slug: "nhom-a",
      description: null,
      channelCount: 1,
      viewerCount: 1,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    {
      id: scopeGroupBId,
      name: "Nhóm rỗng",
      slug: "nhom-rong",
      description: null,
      channelCount: 0,
      viewerCount: 1,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Phase 8 dashboard", () => {
  it("applies one group/channel scope to every canonical dashboard request", async () => {
    const requestedPaths: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      requestedPaths.push(path);
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
      if (path === "/api/v1/channel-groups/accessible") {
        return Promise.resolve(jsonResponse(accessibleScopeGroups));
      }
      if (path.startsWith("/api/v1/channels?")) {
        const empty = path.includes(`groupId=${scopeGroupBId}`);
        return Promise.resolve(
          jsonResponse({
            items: empty ? [] : [scopedChannel],
            page: 1,
            pageSize: 100,
            total: empty ? 0 : 1,
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
      if (path.startsWith("/api/v1/dashboard/trends?")) {
        return Promise.resolve(jsonResponse(emptyDashboardTrend));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    const groupSelect = await screen.findByRole("combobox", { name: /Nhóm kênh/ });
    expect(groupSelect).toHaveValue("");
    const initialChannelSelect = screen.getByRole("combobox", { name: /Kênh cần xem/ });
    expect(initialChannelSelect).toHaveValue("");
    await waitFor(() => {
      expect(groupSelect).not.toBeDisabled();
      expect(initialChannelSelect).not.toBeDisabled();
      expect(requestedPaths).toContain("/api/v1/dashboard/trends?days=28");
    });

    requestedPaths.length = 0;
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await waitFor(() => expect(groupSelect).toHaveValue(scopeGroupAId));
    const groupQuery = `groupId=${scopeGroupAId}`;
    await waitFor(() => {
      expect(requestedPaths, JSON.stringify(requestedPaths)).toContain(
        `/api/v1/channels?page=1&pageSize=100&${groupQuery}`,
      );
      expect(requestedPaths, JSON.stringify(requestedPaths)).toContain(
        `/api/v1/videos/recent?page=1&pageSize=6&${groupQuery}`,
      );
      expect(requestedPaths).toContain(
        `/api/v1/videos/rankings/weekly?page=1&pageSize=5&${groupQuery}`,
      );
      expect(requestedPaths).toContain(`/api/v1/dashboard/trends?days=28&${groupQuery}`);
    });

    const channelSelect = screen.getByRole("combobox", { name: /Kênh cần xem/ });
    await waitFor(() => expect(channelSelect).toHaveTextContent("Kênh phạm vi"));
    requestedPaths.length = 0;
    fireEvent.change(channelSelect, { target: { value: scopeChannelId } });
    const channelQuery = `${groupQuery}&channelId=${scopeChannelId}`;
    await waitFor(() => {
      expect(requestedPaths).toContain(`/api/v1/channels?page=1&pageSize=100&${channelQuery}`);
      expect(requestedPaths).toContain(`/api/v1/videos/recent?page=1&pageSize=6&${channelQuery}`);
      expect(requestedPaths).toContain(
        `/api/v1/videos/rankings/weekly?page=1&pageSize=5&${channelQuery}`,
      );
      expect(requestedPaths).toContain(`/api/v1/dashboard/trends?days=28&${channelQuery}`);
    });

    requestedPaths.length = 0;
    fireEvent.change(groupSelect, { target: { value: scopeGroupBId } });
    await waitFor(() => {
      expect(channelSelect).toHaveValue("");
      for (const path of [
        `/api/v1/channels?page=1&pageSize=100&groupId=${scopeGroupBId}`,
        `/api/v1/videos/recent?page=1&pageSize=6&groupId=${scopeGroupBId}`,
        `/api/v1/videos/rankings/weekly?page=1&pageSize=5&groupId=${scopeGroupBId}`,
        `/api/v1/dashboard/trends?days=28&groupId=${scopeGroupBId}`,
      ]) {
        expect(requestedPaths).toContain(path);
      }
      expect(requestedPaths.some((path) => path.includes(`channelId=${scopeChannelId}`))).toBe(
        false,
      );
      expect(
        requestedPaths.some(
          (path) =>
            (path.startsWith("/api/v1/channels?") ||
              path.startsWith("/api/v1/videos/recent?") ||
              path.startsWith("/api/v1/videos/rankings/weekly?") ||
              path.startsWith("/api/v1/dashboard/trends?")) &&
            !path.includes(`groupId=${scopeGroupBId}`),
        ),
      ).toBe(false);
    });
    expect(await screen.findByText("Tất cả kênh · Nhóm rỗng")).toBeInTheDocument();
  });

  it("preserves selected and empty-group scopes during warm-up and minute polling", async () => {
    vi.useFakeTimers();
    const requestedPaths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        requestedPaths.push(path);
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
        if (path === "/api/v1/channel-groups/accessible") {
          return Promise.resolve(jsonResponse(accessibleScopeGroups));
        }
        if (path.startsWith("/api/v1/channels?")) {
          const empty = path.includes(`groupId=${scopeGroupBId}`);
          return Promise.resolve(
            jsonResponse({
              items: empty ? [] : [scopedChannel],
              page: 1,
              pageSize: 100,
              total: empty ? 0 : 1,
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
        if (path.startsWith("/api/v1/dashboard/trends?")) {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });

    const groupSelect = screen.getByRole("combobox", { name: /Nhóm kênh/ });
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    const channelSelect = screen.getByRole("combobox", { name: /Kênh cần xem/ });
    fireEvent.change(channelSelect, { target: { value: scopeChannelId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });

    const assertSelectedScope = () => {
      const metricPaths = requestedPaths.filter(
        (path) =>
          path.startsWith("/api/v1/videos/recent?") ||
          path.startsWith("/api/v1/videos/rankings/weekly?") ||
          path.startsWith("/api/v1/dashboard/trends?"),
      );
      expect(metricPaths.length).toBeGreaterThan(0);
      expect(
        metricPaths.every(
          (path) =>
            path.includes(`groupId=${scopeGroupAId}`) &&
            path.includes(`channelId=${scopeChannelId}`),
        ),
      ).toBe(true);
      const channelPaths = requestedPaths.filter((path) => path.startsWith("/api/v1/channels?"));
      expect(channelPaths.length).toBeGreaterThan(0);
      expect(channelPaths.every((path) => path.includes(`groupId=${scopeGroupAId}`))).toBe(true);
      expect(channelPaths.some((path) => path.includes(`channelId=${scopeChannelId}`))).toBe(true);
    };

    requestedPaths.length = 0;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    assertSelectedScope();

    requestedPaths.length = 0;
    await act(async () => vi.advanceTimersByTimeAsync(50_000));
    assertSelectedScope();

    fireEvent.change(groupSelect, { target: { value: scopeGroupBId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    requestedPaths.length = 0;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    const emptyScopePaths = requestedPaths.filter(
      (path) =>
        path.startsWith("/api/v1/channels?") ||
        path.startsWith("/api/v1/videos/recent?") ||
        path.startsWith("/api/v1/videos/rankings/weekly?") ||
        path.startsWith("/api/v1/dashboard/trends?"),
    );
    expect(emptyScopePaths.length).toBeGreaterThan(0);
    expect(emptyScopePaths.every((path) => path.includes(`groupId=${scopeGroupBId}`))).toBe(true);
    expect(emptyScopePaths.every((path) => !path.includes("channelId="))).toBe(true);
  });

  it("loads every channel-option page instead of truncating the selector at 100", async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      ...scopedChannel,
      id: `00000000-0000-4000-8000-${(1000 + index).toString(16).padStart(12, "0")}`,
      title: `Kênh ${index + 1}`,
      handle: `@kenh${index + 1}`,
    }));
    const lastChannel = {
      ...scopedChannel,
      id: "00000000-0000-4000-8000-000000001101",
      title: "Kênh 101",
      handle: "@kenh101",
    };
    const requestedPaths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        requestedPaths.push(path);
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
        if (path === "/api/v1/channel-groups/accessible") {
          return Promise.resolve(jsonResponse(accessibleScopeGroups));
        }
        if (path === "/api/v1/channels?page=1&pageSize=100") {
          return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 100, total: 0 }));
        }
        if (path === `/api/v1/channels?page=1&pageSize=100&groupId=${scopeGroupAId}`) {
          return Promise.resolve(
            jsonResponse({ items: pageOne, page: 1, pageSize: 100, total: 101 }),
          );
        }
        if (path === `/api/v1/channels?page=2&pageSize=100&groupId=${scopeGroupAId}`) {
          return Promise.resolve(
            jsonResponse({ items: [lastChannel], page: 2, pageSize: 100, total: 101 }),
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
        if (path.startsWith("/api/v1/dashboard/trends?")) {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    const groupSelect = await screen.findByRole("combobox", { name: /Nhóm kênh/ });
    await waitFor(() => expect(groupSelect).not.toBeDisabled());
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await waitFor(() =>
      expect(requestedPaths, JSON.stringify(requestedPaths)).toContain(
        `/api/v1/channels?page=2&pageSize=100&groupId=${scopeGroupAId}`,
      ),
    );
    expect(await screen.findByRole("option", { name: "Kênh 101 · @kenh101" })).toBeInTheDocument();
    expect(requestedPaths).toContain(
      `/api/v1/channels?page=2&pageSize=100&groupId=${scopeGroupAId}`,
    );
    expect(screen.getByText("101 kênh có thể chọn")).toBeInTheDocument();
  });

  it("ignores a late response from the previously selected group", async () => {
    let resolveOldTrend!: (response: Response) => void;
    const oldTrend = new Promise<Response>((resolve) => {
      resolveOldTrend = resolve;
    });
    const requestedPaths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        requestedPaths.push(path);
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
        if (path === "/api/v1/channel-groups/accessible") {
          return Promise.resolve(jsonResponse(accessibleScopeGroups));
        }
        if (path.startsWith("/api/v1/channels?")) {
          const empty = path.includes(`groupId=${scopeGroupBId}`);
          return Promise.resolve(
            jsonResponse({
              items: empty ? [] : [scopedChannel],
              page: 1,
              pageSize: 100,
              total: empty ? 0 : 1,
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
        if (path === `/api/v1/dashboard/trends?days=28&groupId=${scopeGroupAId}`) {
          return oldTrend;
        }
        if (path.startsWith("/api/v1/dashboard/trends?")) {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    const groupSelect = await screen.findByRole("combobox", { name: /Nhóm kênh/ });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /Kênh cần xem/ })).not.toBeDisabled(),
    );
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await waitFor(() =>
      expect(requestedPaths).toContain(`/api/v1/dashboard/trends?days=28&groupId=${scopeGroupAId}`),
    );
    fireEvent.change(groupSelect, { target: { value: scopeGroupBId } });
    expect(await screen.findByText("Tất cả kênh · Nhóm rỗng")).toBeInTheDocument();
    expect(await screen.findByText("Chưa có kênh để phân tích")).toBeInTheDocument();

    await act(async () => {
      resolveOldTrend(jsonResponse(populatedDashboardTrend));
      await oldTrend;
    });

    expect(screen.getByText("Tất cả kênh · Nhóm rỗng")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Các kênh tăng 3\.500 lượt xem/ }),
    ).not.toBeInTheDocument();
  });

  it("serializes slow same-scope polling so the dashboard cannot starve", async () => {
    vi.useFakeTimers();
    const oldChannels = deferred<Response>();
    const oldRecent = deferred<Response>();
    const oldWeekly = deferred<Response>();
    const oldTrends = deferred<Response>();
    const calls = { channels: 0, recent: 0, weekly: 0, trends: 0 };
    const freshChannel = {
      ...scopedChannel,
      title: "Kênh mới nhất",
      subscriberCount: "2000",
      lifetimeViewCount: "9000",
    };
    const recentVideo = {
      rank: 1,
      id: "00000000-0000-4000-8000-000000000040",
      youtubeVideoId: "fresh-recent",
      channelId: freshChannel.id,
      channelTitle: freshChannel.title,
      title: "Video mới nhất",
      thumbnail: null,
      publishedAt: "2026-08-26T11:00:00.000Z",
      currentViews: "4000",
      currentLikes: "40",
      currentComments: "4",
      weeklyGain: null,
      baselineAt: null,
      status: "READY",
      vph1h: null,
      vph3h: null,
      vph6h: null,
      smoothedVph: null,
      breakout24h: null,
      breakout48h: null,
      breakout7d: null,
    };
    const weeklyVideo = {
      ...recentVideo,
      id: "00000000-0000-4000-8000-000000000041",
      youtubeVideoId: "fresh-weekly",
      title: "Video tăng mới nhất",
      currentViews: "8000",
      weeklyGain: "800",
      baselineAt: "2026-08-19T11:00:00.000Z",
    };
    const freshTrend = {
      ...populatedDashboardTrend,
      totals: { ...populatedDashboardTrend.totals, viewDelta: "9000" },
    };
    const oldChannel = {
      ...scopedChannel,
      title: "Kênh cũ",
      subscriberCount: "100",
      lifetimeViewCount: "1000",
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
        if (path === "/api/v1/channel-groups/accessible") {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        if (path === "/api/v1/channels?page=1&pageSize=100") {
          calls.channels += 1;
          return calls.channels === 1
            ? oldChannels.promise
            : Promise.resolve(
                jsonResponse({ items: [freshChannel], page: 1, pageSize: 100, total: 1 }),
              );
        }
        if (path === "/api/v1/videos/recent?page=1&pageSize=6") {
          calls.recent += 1;
          return calls.recent === 1
            ? oldRecent.promise
            : Promise.resolve(
                jsonResponse({
                  items: [recentVideo],
                  page: 1,
                  pageSize: 6,
                  total: 1,
                  warmingUpCount: 0,
                }),
              );
        }
        if (path === "/api/v1/videos/rankings/weekly?page=1&pageSize=5") {
          calls.weekly += 1;
          return calls.weekly === 1
            ? oldWeekly.promise
            : Promise.resolve(
                jsonResponse({
                  items: [weeklyVideo],
                  page: 1,
                  pageSize: 5,
                  total: 1,
                  warmingUpCount: 0,
                }),
              );
        }
        if (path === "/api/v1/dashboard/trends?days=28") {
          calls.trends += 1;
          return calls.trends === 1 ? oldTrends.promise : Promise.resolve(jsonResponse(freshTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    expect(calls).toEqual({ channels: 1, recent: 1, weekly: 1, trends: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toEqual({ channels: 1, recent: 1, weekly: 1, trends: 1 });
    expect(screen.getByText("Đang tải dashboard…")).toBeInTheDocument();

    await act(async () => {
      oldChannels.resolve(jsonResponse({ items: [oldChannel], page: 1, pageSize: 100, total: 1 }));
      oldRecent.resolve(
        jsonResponse({ items: [], page: 1, pageSize: 6, total: 0, warmingUpCount: 0 }),
      );
      oldWeekly.resolve(
        jsonResponse({ items: [], page: 1, pageSize: 5, total: 0, warmingUpCount: 0 }),
      );
      oldTrends.resolve(jsonResponse(emptyDashboardTrend));
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    expect(screen.getByRole("img", { name: "Kênh cũ: 100" })).toBeInTheDocument();
    expect(screen.queryByText("Đang tải dashboard…")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByRole("img", { name: "Kênh mới nhất: 2.000" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Video mới nhất: 4.000" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Video tăng mới nhất: +800" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Các kênh tăng 9.000 lượt xem trong 28 ngày qua" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Kênh cũ: 100" })).not.toBeInTheDocument();
  });

  it("clears a revoked selected group instead of retaining stale scoped metrics", async () => {
    vi.useFakeTimers();
    let revoked = false;
    let groupRequests = 0;
    const requestedPaths: string[] = [];
    const notFound = () =>
      jsonResponse({ error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } }, 404);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        requestedPaths.push(path);
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
        if (path === "/api/v1/channel-groups/accessible") {
          groupRequests += 1;
          return Promise.resolve(jsonResponse(revoked ? { items: [] } : accessibleScopeGroups));
        }
        const isRevokedScope = revoked && path.includes(`groupId=${scopeGroupAId}`);
        if (isRevokedScope) return Promise.resolve(notFound());
        if (path.startsWith("/api/v1/channels?")) {
          return Promise.resolve(
            jsonResponse({
              items: revoked ? [] : [scopedChannel],
              page: 1,
              pageSize: 100,
              total: revoked ? 0 : 1,
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
        if (path.startsWith("/api/v1/dashboard/trends?")) {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    const groupSelect = screen.getByRole("combobox", { name: /Nhóm kênh/ });
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    expect(screen.getByRole("img", { name: "Kênh phạm vi: 25" })).toBeInTheDocument();

    revoked = true;
    requestedPaths.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      for (let index = 0; index < 40; index += 1) await Promise.resolve();
    });

    expect(groupSelect).toHaveValue("");
    expect(groupRequests).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("option", { name: "Nhóm A · 1 kênh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Kênh phạm vi: 25" })).not.toBeInTheDocument();
    expect(requestedPaths.some((path) => path.includes(`groupId=${scopeGroupAId}`))).toBe(true);
    expect(requestedPaths).toContain("/api/v1/channels?page=1&pageSize=100");
    expect(screen.getAllByText("Tất cả nhóm được phép").length).toBeGreaterThan(0);
  });

  it("resets only a revoked selected channel and keeps its accessible group scope", async () => {
    vi.useFakeTimers();
    let channelRevoked = false;
    const requestedPaths: string[] = [];
    const notFound = () =>
      jsonResponse({ error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } }, 404);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        requestedPaths.push(path);
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
        if (path === "/api/v1/channel-groups/accessible") {
          return Promise.resolve(jsonResponse(accessibleScopeGroups));
        }
        const isSelectedGroup = path.includes(`groupId=${scopeGroupAId}`);
        const isSelectedChannel = path.includes(`channelId=${scopeChannelId}`);
        if (channelRevoked && isSelectedGroup && isSelectedChannel) {
          return Promise.resolve(notFound());
        }
        if (path.startsWith("/api/v1/channels?")) {
          const items = channelRevoked && isSelectedGroup ? [] : [scopedChannel];
          return Promise.resolve(
            jsonResponse({ items, page: 1, pageSize: 100, total: items.length }),
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
        if (path.startsWith("/api/v1/dashboard/trends?")) {
          return Promise.resolve(jsonResponse(emptyDashboardTrend));
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }),
    );

    render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    const groupSelect = screen.getByRole("combobox", { name: /Nhóm kênh/ });
    fireEvent.change(groupSelect, { target: { value: scopeGroupAId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    const channelSelect = screen.getByRole("combobox", { name: /Kênh cần xem/ });
    fireEvent.change(channelSelect, { target: { value: scopeChannelId } });
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve();
    });
    expect(screen.getByRole("img", { name: "Kênh phạm vi: 25" })).toBeInTheDocument();

    channelRevoked = true;
    requestedPaths.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      for (let index = 0; index < 50; index += 1) await Promise.resolve();
    });

    expect(groupSelect).toHaveValue(scopeGroupAId);
    expect(channelSelect).toHaveValue("");
    expect(screen.queryByRole("img", { name: "Kênh phạm vi: 25" })).not.toBeInTheDocument();
    expect(requestedPaths.some((path) => path.includes(`channelId=${scopeChannelId}`))).toBe(true);
    const canonicalPaths = requestedPaths.filter(
      (path) =>
        path.startsWith("/api/v1/channels?") ||
        path.startsWith("/api/v1/videos/recent?") ||
        path.startsWith("/api/v1/videos/rankings/weekly?") ||
        path.startsWith("/api/v1/dashboard/trends?"),
    );
    expect(canonicalPaths.length).toBeGreaterThan(0);
    expect(canonicalPaths.every((path) => path.includes(`groupId=${scopeGroupAId}`))).toBe(true);
    for (const groupOnlyPath of [
      `/api/v1/channels?page=1&pageSize=100&groupId=${scopeGroupAId}`,
      `/api/v1/videos/recent?page=1&pageSize=6&groupId=${scopeGroupAId}`,
      `/api/v1/videos/rankings/weekly?page=1&pageSize=5&groupId=${scopeGroupAId}`,
      `/api/v1/dashboard/trends?days=28&groupId=${scopeGroupAId}`,
    ]) {
      expect(requestedPaths).toContain(groupOnlyPath);
    }
    expect(screen.getByText("Tất cả kênh · Nhóm A")).toBeInTheDocument();
  });

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
    expect(screen.getByText("Báo cáo AI toàn hệ thống chỉ dành cho ADMIN.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cài đặt" })).not.toBeInTheDocument();
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

    const subscribers = screen.getByText("Người đăng ký đã ghi nhận").closest("article");
    expect(subscribers).not.toBeNull();
    expect(within(subscribers!).getByText("≥ 1.250")).toBeInTheDocument();
    expect(
      within(subscribers!).getByText("1/2 kênh có số liệu · 1 chưa xác minh"),
    ).toBeInTheDocument();
    expect(screen.getByText("0*")).toBeInTheDocument();
    expect(screen.getByText("chưa xác minh")).toBeInTheDocument();
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
    const healthPanel = screen
      .getByRole("heading", { name: "Tình trạng hệ thống" })
      .closest("article");
    const aiPanel = screen.getByRole("heading", { name: "Báo cáo AI" }).closest("article");
    expect(healthPanel).not.toBeNull();
    expect(aiPanel).not.toBeNull();
    expect(within(healthPanel!).getByText("Toàn hệ thống · Chỉ ADMIN")).toBeInTheDocument();
    expect(within(aiPanel!).getByText("Toàn hệ thống · Chỉ ADMIN")).toBeInTheDocument();
  });
});
