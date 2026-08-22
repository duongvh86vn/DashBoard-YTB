// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { ChangePasswordForm } from "./change-password-form.js";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

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
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("ChangePasswordForm", () => {
  it("clears both password fields and returns to login after successful revocation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: viewer }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <ChangePasswordForm onClose={vi.fn()} />
      </AuthProvider>,
    );

    const current = await screen.findByLabelText("Mật khẩu hiện tại");
    const next = screen.getByLabelText("Mật khẩu mới");
    fireEvent.change(current, { target: { value: "current-planted" } });
    fireEvent.change(next, { target: { value: "replacement-planted" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu mật khẩu mới" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
    expect(current).toHaveValue("");
    expect(next).toHaveValue("");
  });

  it("clears password fields when cancelled without issuing a request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: viewer }));
    vi.stubGlobal("fetch", fetchMock);
    const close = vi.fn();
    render(
      <AuthProvider>
        <ChangePasswordForm onClose={close} />
      </AuthProvider>,
    );

    const current = await screen.findByLabelText("Mật khẩu hiện tại");
    const next = screen.getByLabelText("Mật khẩu mới");
    fireEvent.change(current, { target: { value: "current-planted" } });
    fireEvent.change(next, { target: { value: "replacement-planted" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));

    expect(current).toHaveValue("");
    expect(next).toHaveValue("");
    expect(close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses fixed copy for a wrong current password and retains the authenticated state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: viewer }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "AUTH_INVALID_CREDENTIALS", message: "planted detail" } },
          401,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <ChangePasswordForm onClose={vi.fn()} />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Mật khẩu hiện tại"), {
      target: { value: "wrong" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
      target: { value: "replacement-planted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu mật khẩu mới" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mật khẩu hiện tại không đúng.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
