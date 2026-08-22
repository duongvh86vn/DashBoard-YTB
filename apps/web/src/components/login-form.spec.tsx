// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../lib/auth-context.js";
import { LoginForm } from "./login-form.js";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

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

function anonymousResponse(): Response {
  return jsonResponse(
    { error: { code: "AUTH_UNAUTHENTICATED", message: "Authentication required" } },
    401,
  );
}

function renderAnonymousLogin(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
}

async function fillAndSubmit() {
  const email = await screen.findByRole("textbox", { name: "Email" });
  const password = screen.getByLabelText("Mật khẩu");
  fireEvent.change(email, { target: { value: "admin@example.com" } });
  fireEvent.change(password, { target: { value: "planted-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
  return { email, password };
}

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("renders an accessible Vietnamese login without a signup path", async () => {
    renderAnonymousLogin(vi.fn(async () => anonymousResponse()));

    expect(await screen.findByRole("heading", { name: "Đăng nhập" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("link", { name: /đăng ký/i })).not.toBeInTheDocument();
  });

  it("logs in, clears the password field, and replace-navigates to the dashboard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(anonymousResponse())
      .mockResolvedValueOnce(jsonResponse({ user: admin }));
    renderAnonymousLogin(fetchMock);

    const { password } = await fillAndSubmit();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
    expect(password).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "AUTH_INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng."],
    [429, "AUTH_RATE_LIMITED", "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại."],
    [403, "AUTH_CSRF_INVALID", "Yêu cầu bảo mật không hợp lệ. Hãy tải lại trang."],
    [500, "AUTH_FORBIDDEN", "Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại."],
  ])("maps %s/%s to fixed Vietnamese copy", async (status, code, expected) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(anonymousResponse())
      .mockResolvedValueOnce(
        jsonResponse({ error: { code, message: "planted arbitrary server message" } }, status),
      );
    renderAnonymousLogin(fetchMock);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("alert")).not.toHaveTextContent("planted arbitrary server message");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
