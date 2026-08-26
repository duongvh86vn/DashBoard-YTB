// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { AdminGate } from "./auth-gate.js";
import { ChannelGroupsScreen } from "./channel-groups-screen.js";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  role: "ADMIN",
  isEnabled: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  disabledAt: null,
} as const;
const viewer = {
  ...admin,
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.com",
  role: "VIEWER",
} as const;
const groupId = "00000000-0000-4000-8000-000000000010";
const channelA = {
  id: "00000000-0000-4000-8000-000000000020",
  youtubeChannelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  originalInput: "https://youtube.com/@a",
  canonicalUrl: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
  handle: "@a",
  title: "Kênh A",
  description: null,
  thumbnail: null,
  subscriberCount: "10",
  videoCount: "2",
  lifetimeViewCount: "100",
  lastUploadAt: null,
  availabilityStatus: "AVAILABLE",
  activityStatus: "ACTIVE",
  lastChannelScanAt: null,
  lastHealthCheckAt: null,
  lastSeenAliveAt: null,
  isEnabled: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  archivedAt: null,
};
const channelB = {
  ...channelA,
  id: "00000000-0000-4000-8000-000000000021",
  youtubeChannelId: "UCbbbbbbbbbbbbbbbbbbbbbb",
  title: "Kênh B",
};
const summary = {
  id: groupId,
  name: "Trang trại",
  slug: "trang-trai",
  description: "Nhóm gốc",
  channelCount: 1,
  viewerCount: 1,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};
const detail = {
  ...summary,
  channelIds: [channelA.id],
  viewerIds: ["00000000-0000-4000-8000-000000000002"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderScreen() {
  return render(
    <AuthProvider>
      <AdminGate>
        <ChannelGroupsScreen />
      </AdminGate>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("ChannelGroupsScreen", () => {
  it("does not mount group read or write controls for a direct VIEWER visit", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: viewer }));
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
    expect(screen.queryByRole("button", { name: "Tạo nhóm" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a group and refreshes the active group list", async () => {
    let listCount = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/auth/me") return jsonResponse({ user: admin });
      if (path === "/api/v1/channels?page=1&pageSize=100") {
        return jsonResponse({ items: [channelA, channelB], page: 1, pageSize: 100, total: 2 });
      }
      if (path === "/api/v1/channel-groups" && init?.method === "POST") {
        return jsonResponse(
          { group: { ...detail, name: "Kênh mới", slug: "kenh-moi", description: null } },
          201,
        );
      }
      if (path === "/api/v1/channel-groups") {
        listCount += 1;
        return jsonResponse({
          items: listCount === 1 ? [] : [{ ...summary, name: "Kênh mới", slug: "kenh-moi" }],
        });
      }
      if (path === `/api/v1/channel-groups/${groupId}`) {
        return jsonResponse({ group: { ...detail, name: "Kênh mới", slug: "kenh-moi" } });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    expect(await screen.findByText("Chưa có nhóm kênh.")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Tên nhóm mới"), {
      target: { value: "Kênh mới" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    expect(await screen.findByRole("heading", { name: "Kênh mới" })).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      ([path, init]) => path === "/api/v1/channel-groups" && init?.method === "POST",
    );
    expect(createCall?.[1]?.body).toBe(JSON.stringify({ name: "Kênh mới", description: null }));
  });

  it("edits metadata, replaces the complete channel set, and requires archive confirmation", async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/auth/me") return jsonResponse({ user: admin });
      if (path === "/api/v1/channel-groups") return jsonResponse({ items: [summary] });
      if (path === "/api/v1/channels?page=1&pageSize=100") {
        return jsonResponse({ items: [channelA, channelB], page: 1, pageSize: 100, total: 2 });
      }
      if (path === `/api/v1/channel-groups/${groupId}` && (!init || init.method === "GET")) {
        return jsonResponse({ group: detail });
      }
      if (path === `/api/v1/channel-groups/${groupId}` && init?.method === "PATCH") {
        return jsonResponse({ group: { ...detail, name: "Nông nghiệp" } });
      }
      if (path === `/api/v1/channel-groups/${groupId}/channels`) {
        return jsonResponse({
          group: { ...detail, channelIds: [channelA.id, channelB.id], channelCount: 2 },
        });
      }
      if (path === `/api/v1/channel-groups/${groupId}` && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: "Quản lý Trang trại" }));
    const manage = await screen.findByRole("dialog", { name: "Quản lý nhóm Trang trại" });
    fireEvent.change(within(manage).getByLabelText("Tên nhóm"), {
      target: { value: "Nông nghiệp" },
    });
    fireEvent.click(within(manage).getByRole("button", { name: "Lưu thông tin" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([path, init]) =>
            path === `/api/v1/channel-groups/${groupId}` && init?.method === "PATCH",
        ),
      ).toBe(true),
    );

    fireEvent.click(within(manage).getByRole("checkbox", { name: "Kênh B" }));
    fireEvent.click(within(manage).getByRole("button", { name: "Lưu danh sách kênh" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === `/api/v1/channel-groups/${groupId}/channels`,
      );
      expect(call?.[1]?.body).toBe(JSON.stringify({ channelIds: [channelA.id, channelB.id] }));
    });

    fireEvent.click(within(manage).getByRole("button", { name: "Đóng" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ Trang trại" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    const archive = screen.getByRole("dialog", { name: "Lưu trữ nhóm kênh" });
    fireEvent.click(within(archive).getByRole("button", { name: "Xác nhận lưu trữ" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([path, init]) =>
            path === `/api/v1/channel-groups/${groupId}` && init?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });
});
