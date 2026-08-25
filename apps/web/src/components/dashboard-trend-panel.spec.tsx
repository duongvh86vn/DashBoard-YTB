// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DashboardTrendPanel, type DashboardTrendData } from "./dashboard-trend-panel.js";

const populatedTrend: DashboardTrendData = {
  period: {
    startDate: "2026-07-28",
    endDate: "2026-08-24",
    days: 28,
    timeZone: "Asia/Bangkok",
  },
  totals: {
    viewDelta: "320157",
    subscriberDelta: "399",
    publishedVideos: 2,
  },
  coverage: {
    totalChannels: 2,
    channelsWithCurrentSnapshot: 2,
    channelsWithBaseline: 1,
    requestedDays: 28,
    completeDays: 20,
    partialDays: 3,
    coveragePercent: 71.4,
  },
  series: [
    {
      date: "2026-07-28",
      viewDelta: "12000",
      subscriberDelta: "10",
      publishedVideos: 0,
      hasSnapshot: true,
    },
    {
      date: "2026-07-29",
      viewDelta: null,
      subscriberDelta: null,
      publishedVideos: 1,
      hasSnapshot: false,
    },
    {
      date: "2026-07-30",
      viewDelta: "10500",
      subscriberDelta: "12",
      publishedVideos: 1,
      hasSnapshot: true,
    },
  ],
};

afterEach(cleanup);

describe("DashboardTrendPanel", () => {
  it("renders exact public totals and an accessible 28-day trend without watch-time or revenue", () => {
    render(<DashboardTrendPanel data={populatedTrend} />);

    expect(
      screen.getByRole("heading", {
        name: "Các kênh tăng 320.157 lượt xem trong 28 ngày qua",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lượt xem tăng/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("+320.157")).toBeInTheDocument();
    expect(screen.getByText("+399")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Lượt xem tăng trong 28 ngày/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Chi tiết theo ngày/ })).toBeInTheDocument();
    expect(screen.getByText(/1\/2 kênh đủ baseline/)).toBeInTheDocument();
    expect(screen.getByText(/20\/28 ngày đủ dữ liệu/)).toBeInTheDocument();
    expect(screen.queryByText(/doanh thu/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/thời gian xem \(giờ\)/i)).not.toBeInTheDocument();
  });

  it("lets keyboard-operable metric buttons change the real series", () => {
    render(<DashboardTrendPanel data={populatedTrend} />);
    const subscriberButton = screen.getByRole("button", { name: /Người đăng ký thay đổi/ });

    fireEvent.click(subscriberButton);

    expect(subscriberButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("img", { name: /Người đăng ký thay đổi trong 28 ngày/ }),
    ).toBeInTheDocument();
  });

  it("keeps missing deltas null and explains baseline warm-up instead of displaying zero", () => {
    const warming: DashboardTrendData = {
      ...populatedTrend,
      totals: { viewDelta: null, subscriberDelta: null, publishedVideos: 0 },
      coverage: {
        totalChannels: 1,
        channelsWithCurrentSnapshot: 1,
        channelsWithBaseline: 0,
        requestedDays: 28,
        completeDays: 0,
        partialDays: 1,
        coveragePercent: 0,
      },
      series: populatedTrend.series.map((point) => ({
        ...point,
        viewDelta: null,
        subscriberDelta: null,
        publishedVideos: 0,
      })),
    };
    render(<DashboardTrendPanel data={warming} />);

    const viewButton = screen.getByRole("button", { name: /Lượt xem tăng/ });
    expect(within(viewButton).getByText("Chưa đủ baseline")).toBeInTheDocument();
    expect(screen.getByText("Chưa đủ dữ liệu cho lượt xem")).toBeInTheDocument();
    expect(screen.getByText(/không điền số 0 vào ngày thiếu dữ liệu/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Video mới/ }));
    expect(
      screen.getByRole("img", { name: /Video mới đã phát hiện trong 28 ngày/ }),
    ).toBeInTheDocument();
  });

  it("keeps loading, failure, and no-data states explicit", () => {
    const { rerender } = render(<DashboardTrendPanel data={null} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải dữ liệu xu hướng");

    rerender(<DashboardTrendPanel data={null} failed />);
    expect(screen.getByRole("alert")).toHaveTextContent("tạm thời không khả dụng");

    rerender(<DashboardTrendPanel data={null} />);
    expect(screen.getByText("Chưa có dữ liệu xu hướng")).toBeInTheDocument();
  });

  it("shows a channel setup state instead of a zero-video chart for an empty portfolio", () => {
    render(
      <DashboardTrendPanel
        data={{
          ...populatedTrend,
          totals: { viewDelta: null, subscriberDelta: null, publishedVideos: 0 },
          coverage: {
            totalChannels: 0,
            channelsWithCurrentSnapshot: 0,
            channelsWithBaseline: 0,
            requestedDays: 28,
            completeDays: 0,
            partialDays: 0,
            coveragePercent: 0,
          },
          series: [],
        }}
      />,
    );

    expect(screen.getByText("Chưa có kênh để phân tích")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Video mới/ })).not.toBeInTheDocument();
  });
});
