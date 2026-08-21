// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page.js";

describe("Phase 0 home page", () => {
  it("describes the real foundation state in Vietnamese without fabricated metrics", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Giám sát YouTube" })).toBeInTheDocument();
    expect(screen.getByText(/Nền tảng hệ thống đang hoạt động\./)).toBeInTheDocument();
    expect(screen.queryByText(/lượt xem hôm nay/i)).not.toBeInTheDocument();
  });
});
