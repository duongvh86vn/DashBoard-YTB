// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import DashboardPage from "./page.js";

afterEach(cleanup);

describe("Phase 1 dashboard", () => {
  it("states the delivered scope truthfully without raw health links or fabricated metrics", () => {
    const { container } = render(<DashboardPage />);

    expect(screen.getByRole("heading", { name: "Tổng quan" })).toBeInTheDocument();
    expect(screen.getByText(/đăng nhập và quản trị người dùng đã sẵn sàng/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dữ liệu giám sát thực" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mở video rankings/i })).toHaveAttribute(
      "href",
      "/videos",
    );
    expect(container.querySelector('a[href*="health"]')).toBeNull();
    expect(screen.queryByText(/lượt xem hôm nay|kênh đang theo dõi|video đang nóng/i)).toBeNull();
  });
});
