// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { AppShell } from "./app-shell.js";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
}));

const baseUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "viewer@example.com",
  isEnabled: true,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  disabledAt: null,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  navigation.pathname = "/";
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  it("uses a bounded mobile navigation grid so links cannot widen the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: { ...baseUser, role: "ADMIN" } })),
    );
    render(
      <AuthProvider>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </AuthProvider>,
    );

    expect(await screen.findByRole("navigation", { name: "Điều hướng chính" })).toHaveClass(
      "grid",
      "grid-cols-2",
      "min-w-0",
    );
  });

  it("shows the Users navigation only to ADMIN and exposes no raw health link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: { ...baseUser, role: "VIEWER" } })),
    );
    const { unmount } = render(
      <AuthProvider>
        <AppShell>
          <div>Nội dung</div>
        </AppShell>
      </AuthProvider>,
    );

    expect(await screen.findByText(baseUser.email)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Người dùng" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nhóm kênh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /trạng thái hệ thống/i })).not.toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: { ...baseUser, role: "ADMIN" } })),
    );
    render(
      <AuthProvider>
        <AppShell>
          <div>Nội dung</div>
        </AppShell>
      </AuthProvider>,
    );
    expect(await screen.findByRole("link", { name: "Người dùng" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(screen.getByRole("link", { name: "Nhóm kênh" })).toHaveAttribute(
      "href",
      "/channel-groups",
    );
  });

  it("logs out with an empty action and returns to login after 204", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: { ...baseUser, role: "VIEWER" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <AppShell>
          <div>Nội dung</div>
        </AppShell>
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.body).toBe("{}");
  });

  it("opens the keyboard-accessible self-service password surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: { ...baseUser, role: "VIEWER" } })),
    );
    render(
      <AuthProvider>
        <AppShell>
          <div>Nội dung</div>
        </AppShell>
      </AuthProvider>,
    );

    const trigger = await screen.findByRole("button", { name: "Đổi mật khẩu" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Đổi mật khẩu" })).toBeInTheDocument();
    const currentPassword = screen.getByLabelText("Mật khẩu hiện tại");
    const submit = screen.getByRole("button", { name: "Lưu mật khẩu mới" });
    expect(currentPassword).toHaveFocus();
    submit.focus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(currentPassword).toHaveFocus();
    fireEvent.keyDown(currentPassword, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();
    fireEvent.keyDown(submit, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Đổi mật khẩu" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("does not let Escape close the password dialog while submission is pending", async () => {
    let resolvePasswordChange!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: { ...baseUser, role: "VIEWER" } }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePasswordChange = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <AppShell>
          <div>Nội dung</div>
        </AppShell>
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Đổi mật khẩu" }));
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), {
      target: { value: "current-password" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
      target: { value: "replacement-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu mật khẩu mới" }));

    const dialog = screen.getByRole("dialog", { name: "Đổi mật khẩu" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();

    resolvePasswordChange(new Response(null, { status: 204 }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  });
});
