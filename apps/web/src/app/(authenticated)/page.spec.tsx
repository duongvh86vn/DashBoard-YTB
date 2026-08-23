// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page.js";
import { AuthProvider } from "../../lib/auth-context.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Phase 8 dashboard", () => {
  it("renders real-data summary surfaces and empty states without fabrication", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
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
        )
        .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 100, total: 0 }))
        .mockResolvedValueOnce(
          jsonResponse({ items: [], page: 1, pageSize: 6, total: 0, warmingUpCount: 0 }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ items: [], page: 1, pageSize: 5, total: 0, warmingUpCount: 0 }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ kind: "DAILY", reportDate: "2026-08-23", available: false, report: null }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            kind: "WEEKLY",
            reportDate: "2026-08-23",
            available: false,
            report: null,
          }),
        ),
    );
    const { container } = render(
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Tổng quan giám sát" })).toBeInTheDocument();
    expect(screen.getByText("Chưa có video snapshot thật.")).toBeInTheDocument();
    expect(screen.getByText("Chưa đủ baseline 7 ngày để xếp hạng.")).toBeInTheDocument();
    expect(container.querySelector('a[href*="health"]')).toBeNull();
    expect(screen.getByText("Kênh đang theo dõi")).toBeInTheDocument();
  });
});
