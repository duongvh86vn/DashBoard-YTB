// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DashboardRevenueResponse } from "@yt-monitor/shared";
import { DashboardRevenuePanel } from "./dashboard-revenue-panel.js";

afterEach(cleanup);

function revenueFixture(): DashboardRevenueResponse {
  return {
    period: {
      startDate: "2026-08-20",
      endDate: "2026-08-26",
      days: 7,
      timeZone: "Asia/Bangkok",
    },
    currency: "USD",
    method: "PUBLIC_VIEW_DELTA_X_MANUAL_RPM",
    metric: {
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: "15.625",
      status: "PARTIAL",
      coveredChannelDays: 8,
      totalChannelDays: 14,
    },
    configuredChannels: 1,
    monetizedChannels: 1,
    totalChannels: 2,
    series: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(20 + index).padStart(2, "0")}`,
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: index === 6 ? "3.125" : null,
      status: index === 6 ? ("PARTIAL" as const) : ("UNAVAILABLE" as const),
      coveredChannels: index === 6 ? 1 : 0,
      totalChannels: 2,
    })),
    channels: [
      {
        channelId: "00000000-0000-4000-8000-000000000010",
        channelTitle: "Kênh có RPM",
        monetizationStatus: "ENABLED",
        effectiveDate: "2026-08-20",
        rpmUsd: "1.25",
        lastReviewedAt: "2026-08-20T03:00:00.000Z",
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: "15.625",
        status: "PARTIAL",
        coveredDays: 6,
        totalDays: 7,
      },
      {
        channelId: "00000000-0000-4000-8000-000000000011",
        channelTitle: "Kênh chưa cấu hình",
        monetizationStatus: "UNCONFIGURED",
        effectiveDate: null,
        rpmUsd: null,
        lastReviewedAt: null,
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: null,
        status: "UNAVAILABLE",
        coveredDays: 0,
        totalDays: 7,
      },
    ],
  };
}

describe("DashboardRevenuePanel", () => {
  it("labels partial manual-RPM revenue as observed evidence, never as an actual total", () => {
    render(<DashboardRevenuePanel data={revenueFixture()} loading={false} failed={false} />);

    expect(
      screen.getByRole("heading", { name: "Doanh thu ước tính từ RPM thủ công" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Phần đã quan sát: 15,625 USD")).toBeInTheDocument();
    expect(screen.getByText(/Không phải doanh thu thực tế từ YouTube/u)).toBeInTheDocument();

    const configured = screen.getByText("Kênh có RPM").closest("tr");
    expect(configured).not.toBeNull();
    expect(within(configured!).getByText("1,25 USD")).toBeInTheDocument();
    expect(within(configured!).getByText("Quan sát 15,625 USD")).toBeInTheDocument();

    const unknown = screen.getByText("Kênh chưa cấu hình").closest("tr");
    expect(unknown).not.toBeNull();
    expect(within(unknown!).getByText("Chưa cấu hình")).toBeInTheDocument();
    expect(within(unknown!).getByText("Chưa biết")).toBeInTheDocument();
  });

  it("keeps unavailable revenue blank instead of fabricating zero", () => {
    const data = revenueFixture();
    data.metric = {
      totalEstimatedRevenueUsd: null,
      observedEstimatedRevenueUsd: null,
      status: "UNAVAILABLE",
      coveredChannelDays: 0,
      totalChannelDays: 14,
    };
    render(<DashboardRevenuePanel data={data} loading={false} failed={false} />);

    expect(screen.getByText("Chưa đủ dữ liệu để ước tính")).toBeInTheDocument();
    expect(screen.queryByText("0 USD")).not.toBeInTheDocument();
  });

  it("renders every daily revenue point with exact signed values and coverage", () => {
    const data = revenueFixture();
    data.series = [
      {
        date: "2026-08-20",
        totalEstimatedRevenueUsd: "4.500",
        observedEstimatedRevenueUsd: "4.500",
        status: "COMPLETE",
        coveredChannels: 2,
        totalChannels: 2,
      },
      ...data.series.slice(1),
      {
        date: "2026-08-27",
        totalEstimatedRevenueUsd: null,
        observedEstimatedRevenueUsd: "-0.0015",
        status: "PARTIAL",
        coveredChannels: 1,
        totalChannels: 2,
      },
    ];

    render(<DashboardRevenuePanel data={data} loading={false} failed={false} />);

    const timeline = screen.getByRole("list", {
      name: "Dòng thời gian doanh thu ước tính theo ngày",
    });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(data.series.length);
    expect(within(timeline).getByText("2026-08-20")).toBeInTheDocument();
    expect(within(timeline).getByText("2026-08-27")).toBeInTheDocument();
    expect(within(timeline).getByText("Phần đã quan sát: -0,0015 USD")).toBeInTheDocument();
    expect(within(timeline).getAllByText("PARTIAL · 1/2 kênh có dữ liệu")).toHaveLength(2);
    expect(within(timeline).getAllByText("UNAVAILABLE · 0/2 kênh có dữ liệu")).toHaveLength(5);
    expect(within(timeline).getByText("Tổng: 4,500 USD")).toBeInTheDocument();
  });
});
