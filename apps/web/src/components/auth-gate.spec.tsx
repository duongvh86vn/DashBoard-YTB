// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { AdminGate, AuthGate, LoginGate } from "./auth-gate.js";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  role: "ADMIN",
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
  vi.unstubAllGlobals();
});

describe("authentication and role gates", () => {
  it("never flashes protected children while bootstrap is loading", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <div>Nội dung riêng tư</div>
        </AuthGate>
      </AuthProvider>,
    );

    expect(screen.queryByText("Nội dung riêng tư")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra phiên đăng nhập");

    await act(async () => resolveFetch(jsonResponse({ user: admin })));
    expect(await screen.findByText("Nội dung riêng tư")).toBeInTheDocument();
  });

  it("redirects authoritative anonymous state to login without rendering children", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" } },
          401,
        ),
      ),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <div>Nội dung riêng tư</div>
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Nội dung riêng tư")).not.toBeInTheDocument();
  });

  it("shows a retry state for service failures instead of treating them as anonymous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "AUTH_FORBIDDEN", message: "Forbidden" } }, 500),
      ),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <div>Nội dung riêng tư</div>
        </AuthGate>
      </AuthProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không thể kiểm tra phiên đăng nhập",
    );
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("Nội dung riêng tư")).not.toBeInTheDocument();
  });

  it("redirects an authenticated visit away from login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: admin })),
    );

    render(
      <AuthProvider>
        <LoginGate>
          <div>Biểu mẫu đăng nhập</div>
        </LoginGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("Biểu mẫu đăng nhập")).not.toBeInTheDocument();
  });

  it("blocks VIEWER children before they mount", async () => {
    const viewer = { ...admin, id: "00000000-0000-4000-8000-000000000002", role: "VIEWER" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: viewer })),
    );
    const mounted = vi.fn();
    function AdminOnlyChild() {
      mounted();
      return <div>Quản trị người dùng</div>;
    }

    render(
      <AuthProvider>
        <AdminGate>
          <AdminOnlyChild />
        </AdminGate>
      </AuthProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
    expect(mounted).not.toHaveBeenCalled();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });
});
