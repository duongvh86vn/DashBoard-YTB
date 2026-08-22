// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-client.js";
import { AuthProvider, useAuth } from "./auth-context.js";

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

function Probe() {
  const auth = useAuth();

  return (
    <div>
      <output data-testid="state">{auth.state.status}</output>
      {auth.state.status === "authenticated" ? <span>{auth.state.user.email}</span> : null}
      <button type="button" onClick={auth.retryBootstrap}>
        Thử lại
      </button>
      <button
        type="button"
        onClick={() => auth.handleApiError(new ApiError(401, "AUTH_UNAUTHENTICATED"))}
      >
        Mất phiên
      </button>
      <button
        type="button"
        onClick={() => auth.handleApiError(new ApiError(401, "AUTH_INVALID_CREDENTIALS"))}
      >
        Sai mật khẩu
      </button>
    </div>
  );
}

function StorageProbe() {
  const auth = useAuth();
  return (
    <div>
      <output data-testid="storage-state">{auth.state.status}</output>
      <button
        type="button"
        onClick={() => void auth.login("admin@example.com", "planted-login-password")}
      >
        Thực hiện đăng nhập
      </button>
      <button
        type="button"
        onClick={() => void auth.changePassword("planted-current-password", "planted-new-password")}
      >
        Thực hiện đổi mật khẩu
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("bootstraps the authenticated principal from exact GET /auth/me", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: admin }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(await screen.findByText(admin.email)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(calls[0]?.[0]).toBe("/api/v1/auth/me");
  });

  it("treats only exact 401/AUTH_UNAUTHENTICATED as anonymous", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" } },
        401,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("keeps network and 5xx failures in a retryable error state", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ user: admin }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("error"));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(admin.email)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not clear an authenticated principal for other known auth errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: admin })),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText(admin.email)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sai mật khẩu" }));
    expect(screen.getByTestId("state")).toHaveTextContent("authenticated");
    fireEvent.click(screen.getByRole("button", { name: "Mất phiên" }));
    expect(screen.getByTestId("state")).toHaveTextContent("anonymous");
  });

  it("never writes session or password material to localStorage or sessionStorage", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" } },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ user: admin }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <StorageProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("storage-state")).toHaveTextContent("anonymous"));
    fireEvent.click(screen.getByRole("button", { name: "Thực hiện đăng nhập" }));
    await waitFor(() =>
      expect(screen.getByTestId("storage-state")).toHaveTextContent("authenticated"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Thực hiện đổi mật khẩu" }));
    await waitFor(() => expect(screen.getByTestId("storage-state")).toHaveTextContent("anonymous"));

    expect(storageWrite).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });
});
