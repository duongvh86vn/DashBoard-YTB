// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { AdminGate } from "./auth-gate.js";
import { UsersScreen } from "./users-screen.js";

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
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.com",
  role: "VIEWER",
  isEnabled: true,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  disabledAt: null,
} as const;

const secondViewer = {
  ...viewer,
  id: "00000000-0000-4000-8000-000000000003",
  email: "second@example.com",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderUsers(groupAccessEnabled = false) {
  return render(
    <AuthProvider>
      <AdminGate>
        <UsersScreen groupAccessEnabled={groupAccessEnabled} />
      </AdminGate>
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("UsersScreen", () => {
  const groupA = {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Nhóm A",
    slug: "nhom-a",
    description: null,
    channelCount: 2,
    viewerCount: 0,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
  const groupB = {
    ...groupA,
    id: "00000000-0000-4000-8000-000000000011",
    name: "Nhóm B",
    slug: "nhom-b",
  };

  it("never calls the Users API for a direct VIEWER visit", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { ...viewer, role: "VIEWER" } }));
    vi.stubGlobal("fetch", fetchMock);

    renderUsers();

    expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(calls.some(([path]) => String(path).startsWith("/api/v1/users"))).toBe(false);
  });

  it("renders empty state and server pagination boundaries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 21 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondViewer], page: 2, pageSize: 20, total: 21 }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(await screen.findByText(secondViewer.email)).toBeInTheDocument();
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/users?page=2&pageSize=20");

    fireEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    expect(await screen.findByText("Chưa có tài khoản VIEWER.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  });

  it("offers a fixed-copy retry state when the list service is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockRejectedValueOnce(new TypeError("planted network detail"))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("planted network detail");
    fireEvent.click(screen.getByRole("button", { name: "Thử tải lại danh sách" }));

    expect(await screen.findByText("Chưa có tài khoản VIEWER.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts an obsolete list request when pagination changes again", async () => {
    let pageTwoSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/v1/auth/me") return Promise.resolve(jsonResponse({ user: admin }));
      if (path === "/api/v1/users?page=2&pageSize=20") {
        pageTwoSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 21 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(pageTwoSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Trang trước" }));

    await waitFor(() => expect(pageTwoSignal?.aborted).toBe(true));
    expect(fetchMock.mock.calls.filter(([path]) => String(path).includes("page=1")).length).toBe(2);
  });

  it("creates a VIEWER, clears its password, and refetches server state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ user: viewer }, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    const email = await screen.findByRole("textbox", { name: "Email VIEWER mới" });
    const password = screen.getByLabelText("Mật khẩu VIEWER mới");
    fireEvent.change(email, { target: { value: viewer.email } });
    fireEvent.change(password, { target: { value: "password-long-enough" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    expect(password).toHaveValue("");
    const [path, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(path).toBe("/api/v1/users");
    expect(init.body).toBe(
      JSON.stringify({ email: viewer.email, password: "password-long-enough" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("creates a VIEWER with the complete multi-group selection and renders assignment chips", async () => {
    let created = false;
    let assigned = false;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/auth/me") return jsonResponse({ user: admin });
      if (path === "/api/v1/channel-groups") return jsonResponse({ items: [groupA, groupB] });
      if (path === `/api/v1/channel-groups/${groupA.id}`) {
        return jsonResponse({
          group: { ...groupA, channelIds: [], viewerIds: assigned ? [viewer.id] : [] },
        });
      }
      if (path === `/api/v1/channel-groups/${groupB.id}`) {
        return jsonResponse({
          group: { ...groupB, channelIds: [], viewerIds: assigned ? [viewer.id] : [] },
        });
      }
      if (path === "/api/v1/users?page=1&pageSize=20") {
        return jsonResponse({
          items: created ? [viewer] : [],
          page: 1,
          pageSize: 20,
          total: created ? 1 : 0,
        });
      }
      if (path === "/api/v1/users" && init?.method === "POST") {
        created = true;
        return jsonResponse({ user: viewer }, 201);
      }
      if (path === `/api/v1/users/${viewer.id}/channel-groups`) {
        assigned = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderUsers(true);

    fireEvent.change(await screen.findByRole("textbox", { name: "Email VIEWER mới" }), {
      target: { value: viewer.email },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu VIEWER mới"), {
      target: { value: "password-long-enough" },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Nhóm A cho VIEWER mới" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Nhóm B cho VIEWER mới" }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));

    await waitFor(() => {
      const assignment = fetchMock.mock.calls.find(
        ([path]) => path === `/api/v1/users/${viewer.id}/channel-groups`,
      );
      expect(assignment?.[1]?.body).toBe(JSON.stringify({ groupIds: [groupA.id, groupB.id] }));
    });
    const row = (await screen.findByText(viewer.email)).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Nhóm A")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Nhóm B")).toBeInTheDocument();
  });

  it("replaces a VIEWER assignment with an explicit empty set that visibly means no access", async () => {
    let assigned = true;
    const fetchMock = vi.fn(async (path: string) => {
      if (path === "/api/v1/auth/me") return jsonResponse({ user: admin });
      if (path === "/api/v1/users?page=1&pageSize=20")
        return jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 });
      if (path === "/api/v1/channel-groups") return jsonResponse({ items: [groupA, groupB] });
      if (path === `/api/v1/channel-groups/${groupA.id}`)
        return jsonResponse({
          group: { ...groupA, channelIds: [], viewerIds: assigned ? [viewer.id] : [] },
        });
      if (path === `/api/v1/channel-groups/${groupB.id}`)
        return jsonResponse({ group: { ...groupB, channelIds: [], viewerIds: [] } });
      if (path === `/api/v1/users/${viewer.id}/channel-groups`) {
        assigned = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderUsers(true);

    const row = (await screen.findByText(viewer.email)).closest("tr") as HTMLElement;
    expect(await within(row).findByText("Nhóm A")).toBeInTheDocument();
    fireEvent.click(
      within(row).getByRole("button", { name: `Phân quyền nhóm của ${viewer.email}` }),
    );
    const dialog = screen.getByRole("dialog", { name: "Phân quyền nhóm kênh" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Nhóm A" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu phân quyền" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
      const call = calls.find(([path]) => path === `/api/v1/users/${viewer.id}/channel-groups`);
      expect(call?.[1]?.body).toBe(JSON.stringify({ groupIds: [] }));
    });
    expect(await within(row).findByText("Không có quyền xem kênh")).toBeInTheDocument();
  });

  it("reports the recoverable no-access state when account creation succeeds but assignment fails", async () => {
    let created = false;
    let assignmentAttempts = 0;
    let assigned = false;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/auth/me") return jsonResponse({ user: admin });
      if (path === "/api/v1/channel-groups") return jsonResponse({ items: [groupA] });
      if (path === `/api/v1/channel-groups/${groupA.id}`)
        return jsonResponse({
          group: { ...groupA, channelIds: [], viewerIds: assigned ? [viewer.id] : [] },
        });
      if (path === "/api/v1/users?page=1&pageSize=20")
        return jsonResponse({
          items: created ? [viewer] : [],
          page: 1,
          pageSize: 20,
          total: created ? 1 : 0,
        });
      if (path === "/api/v1/users" && init?.method === "POST") {
        created = true;
        return jsonResponse({ user: viewer }, 201);
      }
      if (path === `/api/v1/users/${viewer.id}/channel-groups`) {
        assignmentAttempts += 1;
        if (assignmentAttempts > 1) {
          assigned = true;
          return new Response(null, { status: 204 });
        }
        return jsonResponse(
          { error: { code: "CHANNEL_GROUP_MEMBERSHIP_INVALID", message: "planted" } },
          400,
        );
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderUsers(true);

    fireEvent.change(await screen.findByRole("textbox", { name: "Email VIEWER mới" }), {
      target: { value: viewer.email },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu VIEWER mới"), {
      target: { value: "password-long-enough" },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Nhóm A cho VIEWER mới" }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tài khoản đã được tạo nhưng hiện chưa có quyền xem kênh",
    );
    expect(screen.getByLabelText("Mật khẩu VIEWER mới")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: `Phân quyền nhóm của ${viewer.email}` }));
    const dialog = screen.getByRole("dialog", { name: "Phân quyền nhóm kênh" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Nhóm A" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu phân quyền" }));

    await waitFor(() => expect(assignmentAttempts).toBe(2));
    expect(screen.queryByText(/Tài khoản đã được tạo nhưng/u)).toBeNull();
    const repairedRow = screen.getByText(viewer.email).closest("tr") as HTMLElement;
    expect(await within(repairedRow).findByText("Nhóm A")).toBeInTheDocument();
  });

  it("still clears creation credentials when a retry succeeds after an earlier conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "USER_ALREADY_EXISTS", message: "planted conflict detail" } },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ user: viewer }, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    const email = await screen.findByRole("textbox", { name: "Email VIEWER mới" });
    const password = screen.getByLabelText("Mật khẩu VIEWER mới");
    fireEvent.change(email, { target: { value: viewer.email } });
    fireEvent.change(password, { target: { value: "first-password-long" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email này đã được sử dụng.");

    fireEvent.change(email, { target: { value: viewer.email } });
    fireEvent.change(password, { target: { value: "second-password-long" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    expect(email).toHaveValue("");
    expect(password).toHaveValue("");
  });

  it("traps dialog focus, closes on Escape, and restores the invoking control", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    const trigger = await screen.findByRole("button", {
      name: `Thu hồi phiên của ${viewer.email}`,
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Thu hồi phiên đăng nhập" });
    const cancel = within(dialog).getByRole("button", { name: "Hủy" });
    const confirm = within(dialog).getByRole("button", { name: "Xác nhận thu hồi phiên" });
    expect(cancel).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Thu hồi phiên đăng nhập" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("uses semantic confirmations, suppresses duplicate revoke, and refetches after success", async () => {
    let resolveRevoke!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRevoke = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: `Thu hồi phiên của ${viewer.email}` });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Thu hồi phiên đăng nhập" });
    expect(dialog).toHaveTextContent("tất cả phiên đăng nhập");
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toHaveFocus();
    const confirm = within(dialog).getByRole("button", { name: "Xác nhận thu hồi phiên" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Thu hồi phiên đăng nhập" })).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.filter(
        ([path]) => path === `/api/v1/users/${viewer.id}/revoke-sessions`,
      ),
    ).toHaveLength(1);
    resolveRevoke(new Response(null, { status: 204 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders a fixed mutation error inside the active modal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "AUTH_FORBIDDEN", message: "planted server text" } }, 403),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    fireEvent.click(
      await screen.findByRole("button", { name: `Thu hồi phiên của ${viewer.email}` }),
    );
    const dialog = screen.getByRole("dialog", { name: "Thu hồi phiên đăng nhập" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Xác nhận thu hồi phiên" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Bạn không có quyền thực hiện thao tác này.");
    expect(alert).not.toHaveTextContent("planted server text");
  });

  it("wires email, reset, disable, and enable controls to server-refetched lifecycle state", async () => {
    const updatedViewer = { ...viewer, email: "next@example.com" };
    const disabledViewer = {
      ...updatedViewer,
      isEnabled: false,
      disabledAt: "2026-08-22T01:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ user: updatedViewer }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [updatedViewer], page: 1, pageSize: 20, total: 1 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [updatedViewer], page: 1, pageSize: 20, total: 1 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [disabledViewer], page: 1, pageSize: 20, total: 1 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [updatedViewer], page: 1, pageSize: 20, total: 1 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Đổi email của ${viewer.email}` }));
    fireEvent.change(screen.getByLabelText("Email mới"), {
      target: { value: updatedViewer.email },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Lưu email" }));
    expect(await screen.findByText(updatedViewer.email)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: `Đặt lại mật khẩu của ${updatedViewer.email}` }),
    );
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
      target: { value: "discarded-password" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hủy" }));
    fireEvent.click(
      screen.getByRole("button", { name: `Đặt lại mật khẩu của ${updatedViewer.email}` }),
    );
    expect(screen.getByLabelText("Mật khẩu mới")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
      target: { value: "replacement-password" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Xác nhận đặt lại mật khẩu",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    fireEvent.click(screen.getByRole("button", { name: `Vô hiệu hóa ${updatedViewer.email}` }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Xác nhận vô hiệu hóa",
      }),
    );
    expect(await screen.findByText("Đã vô hiệu hóa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Kích hoạt ${updatedViewer.email}` }));
    expect(await screen.findByText("Đang hoạt động")).toBeInTheDocument();

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[2]).toMatchObject([
      `/api/v1/users/${viewer.id}`,
      { method: "PATCH", body: JSON.stringify({ email: updatedViewer.email }) },
    ]);
    expect(calls[4]).toMatchObject([
      `/api/v1/users/${viewer.id}/reset-password`,
      { method: "POST", body: JSON.stringify({ password: "replacement-password" }) },
    ]);
    expect(calls[6]?.[0]).toBe(`/api/v1/users/${viewer.id}/disable`);
    expect(calls[8]?.[0]).toBe(`/api/v1/users/${viewer.id}/enable`);
  });

  it("keeps a delete-alias target in the VIEWER list as disabled with an unchanged total", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 21 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondViewer], page: 2, pageSize: 20, total: 21 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              ...secondViewer,
              isEnabled: false,
              disabledAt: "2026-08-22T02:00:00.000Z",
            },
          ],
          page: 2,
          pageSize: 20,
          total: 21,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(await screen.findByText(secondViewer.email)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: `Xóa (vô hiệu hóa) ${secondViewer.email}` }),
    );
    const dialog = screen.getByRole("dialog", { name: "Xóa theo nghiệp vụ" });
    expect(dialog).toHaveTextContent("không xóa dữ liệu");
    fireEvent.click(within(dialog).getByRole("button", { name: "Xác nhận vô hiệu hóa" }));

    expect(await screen.findByText("Đã vô hiệu hóa")).toBeInTheDocument();
    expect(screen.getByText(secondViewer.email)).toBeInTheDocument();
    expect(screen.getByText("21 VIEWER")).toBeInTheDocument();
    expect(screen.getByText("Trang 2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3]).toMatchObject([
      `/api/v1/users/${secondViewer.id}`,
      { method: "DELETE", body: "{}" },
    ]);
    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/v1/users?page=2&pageSize=20");
  });

  it("falls back one page when a refetch observes an unrelated out-of-band list shrink", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 21 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondViewer], page: 2, pageSize: 20, total: 21 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 2, pageSize: 20, total: 20 }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 20 }));
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();

    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(await screen.findByText(secondViewer.email)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: `Thu hồi phiên của ${secondViewer.email}` }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Xác nhận thu hồi phiên",
      }),
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls[5]?.[0]).toBe("/api/v1/users?page=1&pageSize=20"),
    );
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();
    expect(screen.getByText("Trang 1")).toBeInTheDocument();
  });

  it.each([
    [400, "VALIDATION_ERROR", "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại."],
    [403, "AUTH_FORBIDDEN", "Bạn không có quyền thực hiện thao tác này."],
    [404, "USER_NOT_FOUND", "Không tìm thấy người dùng."],
    [409, "USER_ALREADY_EXISTS", "Email này đã được sử dụng."],
  ])("keeps auth and renders fixed copy for %s/%s", async (status, code, message) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code, message: "planted server text" } }, status),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();

    if (code === "VALIDATION_ERROR" || code === "USER_ALREADY_EXISTS") {
      fireEvent.change(screen.getByRole("textbox", { name: "Email VIEWER mới" }), {
        target: { value: "duplicate@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Mật khẩu VIEWER mới"), {
        target: { value: "password-long-enough" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tạo VIEWER" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: `Thu hồi phiên của ${viewer.email}` }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Xác nhận thu hồi phiên",
        }),
      );
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).not.toHaveTextContent("planted server text");
    expect(navigation.replace).not.toHaveBeenCalledWith("/login");
  });

  it("clears global auth only for exact unauthenticated protected responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(jsonResponse({ items: [viewer], page: 1, pageSize: 20, total: 1 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" } },
          401,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderUsers();
    expect(await screen.findByText(viewer.email)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Thu hồi phiên của ${viewer.email}` }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Xác nhận thu hồi phiên",
      }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  });
});
