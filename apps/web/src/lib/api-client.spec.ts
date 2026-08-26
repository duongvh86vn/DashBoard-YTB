// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  changePassword,
  createViewer,
  deleteViewer,
  disableViewer,
  enableViewer,
  getDashboardTrends,
  getCurrentUser,
  listAccessibleChannelGroups,
  listChannels,
  listRecentVideos,
  listWeeklyVideoRanking,
  listViewers,
  login,
  logout,
  resetViewerPassword,
  replaceChannelGroupChannels,
  replaceViewerChannelGroups,
  revokeViewerSessions,
  updateViewerEmail,
} from "./api-client.js";

const viewer = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.com",
  role: "VIEWER",
  isEnabled: true,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  disabledAt: null,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("same-origin API client", () => {
  it("sends safe GET with same-origin credentials and no unsafe headers or body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { ...viewer, role: "ADMIN" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentUser();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(path).toBe("/api/v1/auth/me");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
    expect(init.body).toBeUndefined();
    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.has("X-CSRF-Protection")).toBe(false);
  });

  it("sends one unsafe request with exact JSON/CSRF headers and never retries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: { code: "AUTH_INVALID_CREDENTIALS", message: "planted server detail" },
        },
        401,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await login("admin@example.com", "planted-password").catch(
      (reason: unknown) => reason,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(path).toBe("/api/v1/auth/login");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-CSRF-Protection")).toBe("1");
    expect(init.body).toBe(
      JSON.stringify({ email: "admin@example.com", password: "planted-password" }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "AUTH_INVALID_CREDENTIALS" });
    expect(String(error)).not.toContain("planted server detail");
    expect(String(error)).not.toContain("planted-password");
  });

  it("handles 204 before JSON parsing and sends exact empty action objects", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).resolves.toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe("{}");
  });

  it("rejects 204 as a typed generic error when an endpoint requires a response body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const operations = [
      () => getCurrentUser(),
      () => createViewer({ email: viewer.email, password: "password-long-enough" }),
      () => updateViewerEmail(viewer.id, "next@example.com"),
    ];

    for (const operation of operations) {
      const error = await operation().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ status: 204, code: null });
      expect(String(error)).toBe("ApiError: API request failed");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("turns non-JSON and schema-invalid success/error payloads into generic failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>proxy error</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{broken", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ user: { id: "missing-fields" } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "DATABASE_ERROR", message: "planted internal exception" } },
          500,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    for (const expectedStatus of [200, 200, 200, 500]) {
      const error = await getCurrentUser().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: expectedStatus, code: null });
      expect(String(error)).not.toMatch(/proxy error|missing-fields|planted internal/u);
    }
  });

  it("uses URLSearchParams, encoded IDs, optional signals, and exact routes/bodies for all seven mutations", async () => {
    const controller = new AbortController();
    const responses = [
      jsonResponse({ items: [viewer], page: 2, pageSize: 25, total: 26 }),
      jsonResponse({ user: viewer }, 201),
      jsonResponse({ user: { ...viewer, email: "next@example.com" } }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() as Response);
    vi.stubGlobal("fetch", fetchMock);
    const id = "viewer/id?#";

    await listViewers({ page: 2, pageSize: 25, signal: controller.signal });
    await createViewer({ email: viewer.email, password: "password-long-enough" });
    await updateViewerEmail(id, "next@example.com");
    await resetViewerPassword(id, "replacement-password");
    await revokeViewerSessions(id);
    await disableViewer(id);
    await enableViewer(id);
    await deleteViewer(id);
    await changePassword("current-password", "replacement-password");

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/v1/users?page=2&pageSize=25",
      "/api/v1/users",
      "/api/v1/users/viewer%2Fid%3F%23",
      "/api/v1/users/viewer%2Fid%3F%23/reset-password",
      "/api/v1/users/viewer%2Fid%3F%23/revoke-sessions",
      "/api/v1/users/viewer%2Fid%3F%23/disable",
      "/api/v1/users/viewer%2Fid%3F%23/enable",
      "/api/v1/users/viewer%2Fid%3F%23",
      "/api/v1/auth/change-password",
    ]);
    expect(calls[0]?.[1].signal).toBe(controller.signal);
    expect(calls[1]?.[1].body).toBe(
      JSON.stringify({ email: viewer.email, password: "password-long-enough" }),
    );
    expect(calls[2]?.[1]).toMatchObject({ method: "PATCH" });
    expect(calls[2]?.[1].body).toBe(JSON.stringify({ email: "next@example.com" }));
    expect(calls[3]?.[1].body).toBe(JSON.stringify({ password: "replacement-password" }));
    expect(calls.slice(4, 8).map(([, init]) => init.body)).toEqual(["{}", "{}", "{}", "{}"]);
    expect(calls[7]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("sends complete channel and viewer group replacement arrays, including an explicit empty set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          group: {
            id: "00000000-0000-4000-8000-000000000010",
            name: "Nhóm A",
            slug: "nhom-a",
            description: null,
            channelCount: 2,
            viewerCount: 0,
            channelIds: [
              "00000000-0000-4000-8000-000000000020",
              "00000000-0000-4000-8000-000000000021",
            ],
            viewerIds: [],
            createdAt: "2026-08-26T00:00:00.000Z",
            updatedAt: "2026-08-26T00:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          group: {
            id: "00000000-0000-4000-8000-000000000010",
            name: "Nhóm A",
            slug: "nhom-a",
            description: null,
            channelCount: 0,
            viewerCount: 0,
            channelIds: [],
            viewerIds: [],
            createdAt: "2026-08-26T00:00:00.000Z",
            updatedAt: "2026-08-26T00:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const channelIds = [
      "00000000-0000-4000-8000-000000000020",
      "00000000-0000-4000-8000-000000000021",
    ];
    await replaceChannelGroupChannels("group/id", channelIds);
    await replaceChannelGroupChannels("group/empty", []);
    await replaceViewerChannelGroups("viewer/multi", [
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
    ]);
    await replaceViewerChannelGroups("viewer/id", []);

    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(fetchMock.mock.calls[0]).toMatchObject([
      "/api/v1/channel-groups/group%2Fid/channels",
      { method: "PUT", body: JSON.stringify({ channelIds }) },
    ]);
    expect(fetchMock.mock.calls[1]).toMatchObject([
      "/api/v1/channel-groups/group%2Fempty/channels",
      { method: "PUT", body: JSON.stringify({ channelIds: [] }) },
    ]);
    expect(fetchMock.mock.calls[2]).toMatchObject([
      "/api/v1/users/viewer%2Fmulti/channel-groups",
      {
        method: "PUT",
        body: JSON.stringify({
          groupIds: [
            "00000000-0000-4000-8000-000000000010",
            "00000000-0000-4000-8000-000000000011",
          ],
        }),
      },
    ]);
    expect(fetchMock.mock.calls[3]).toMatchObject([
      "/api/v1/users/viewer%2Fid/channel-groups",
      { method: "PUT", body: JSON.stringify({ groupIds: [] }) },
    ]);
  });

  it("adds the authorized dashboard scope to every filtered read", async () => {
    const groupId = "00000000-0000-4000-8000-000000000010";
    const channelId = "00000000-0000-4000-8000-000000000020";
    const controller = new AbortController();
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/v1/channel-groups/accessible") {
        return jsonResponse({
          items: [
            {
              id: groupId,
              name: "Nhóm A",
              slug: "nhom-a",
              description: null,
              channelCount: 1,
              viewerCount: 1,
              createdAt: "2026-08-26T00:00:00.000Z",
              updatedAt: "2026-08-26T00:00:00.000Z",
            },
          ],
        });
      }
      if (path.startsWith("/api/v1/channels?")) {
        return jsonResponse({ items: [], page: 1, pageSize: 100, total: 0 });
      }
      if (path.startsWith("/api/v1/videos/recent?")) {
        return jsonResponse({ items: [], page: 1, pageSize: 6, total: 0, warmingUpCount: 0 });
      }
      if (path.startsWith("/api/v1/videos/rankings/weekly?")) {
        return jsonResponse({ items: [], page: 1, pageSize: 5, total: 0, warmingUpCount: 0 });
      }
      if (path.startsWith("/api/v1/dashboard/trends?")) {
        return jsonResponse({
          period: {
            startDate: "2026-07-30",
            endDate: "2026-08-26",
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
        });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await listAccessibleChannelGroups(controller.signal);
    await listChannels({ page: 1, pageSize: 100, groupId, channelId, signal: controller.signal });
    await listRecentVideos({
      page: 1,
      pageSize: 6,
      groupId,
      channelId,
      signal: controller.signal,
    });
    await listWeeklyVideoRanking({
      page: 1,
      pageSize: 5,
      groupId,
      channelId,
      signal: controller.signal,
    });
    await getDashboardTrends({ days: 28, groupId, channelId, signal: controller.signal });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/channel-groups/accessible",
      `/api/v1/channels?page=1&pageSize=100&groupId=${groupId}&channelId=${channelId}`,
      `/api/v1/videos/recent?page=1&pageSize=6&groupId=${groupId}&channelId=${channelId}`,
      `/api/v1/videos/rankings/weekly?page=1&pageSize=5&groupId=${groupId}&channelId=${channelId}`,
      `/api/v1/dashboard/trends?days=28&groupId=${groupId}&channelId=${channelId}`,
    ]);
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.signal).toBe(controller.signal);
    }
  });
});
