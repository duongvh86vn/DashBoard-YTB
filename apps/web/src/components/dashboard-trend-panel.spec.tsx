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
  observedTotals: {
    viewDelta: { value: "320157", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
    subscriberDelta: { value: "399", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
  },
  coverage: {
    totalChannels: 2,
    channelsWithCurrentSnapshot: 2,
    channelsScanned: 2,
    channelsWithCompleteCurrentSnapshot: 2,
    channelsWithCurrentSubscribers: 2,
    channelsWithCurrentLifetimeViews: 2,
    channelsWithCurrentPublicVideos: 2,
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
      observed: {
        viewDelta: { value: "12000", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
        subscriberDelta: { value: "10", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
      },
      publishedVideos: 0,
      hasSnapshot: true,
    },
    {
      date: "2026-07-29",
      viewDelta: null,
      subscriberDelta: null,
      observed: {
        viewDelta: { value: null, coveredChannels: 0, totalChannels: 2, status: "UNAVAILABLE" },
        subscriberDelta: {
          value: null,
          coveredChannels: 0,
          totalChannels: 2,
          status: "UNAVAILABLE",
        },
      },
      publishedVideos: 1,
      hasSnapshot: false,
    },
    {
      date: "2026-07-30",
      viewDelta: "10500",
      subscriberDelta: "12",
      observed: {
        viewDelta: { value: "10500", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
        subscriberDelta: { value: "12", coveredChannels: 2, totalChannels: 2, status: "COMPLETE" },
      },
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
    expect(screen.getByText(/1\/2 kênh có baseline đủ 28 ngày/)).toBeInTheDocument();
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

  it("shows missing deltas as qualified zero placeholders while preserving baseline coverage", () => {
    const warming: DashboardTrendData = {
      ...populatedTrend,
      totals: { viewDelta: null, subscriberDelta: null, publishedVideos: 0 },
      observedTotals: {
        viewDelta: { value: null, coveredChannels: 0, totalChannels: 1, status: "UNAVAILABLE" },
        subscriberDelta: {
          value: null,
          coveredChannels: 0,
          totalChannels: 1,
          status: "UNAVAILABLE",
        },
      },
      coverage: {
        totalChannels: 1,
        channelsWithCurrentSnapshot: 1,
        channelsScanned: 1,
        channelsWithCompleteCurrentSnapshot: 1,
        channelsWithCurrentSubscribers: 1,
        channelsWithCurrentLifetimeViews: 1,
        channelsWithCurrentPublicVideos: 1,
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
        observed: {
          viewDelta: { value: null, coveredChannels: 0, totalChannels: 1, status: "UNAVAILABLE" },
          subscriberDelta: {
            value: null,
            coveredChannels: 0,
            totalChannels: 1,
            status: "UNAVAILABLE",
          },
        },
        publishedVideos: 0,
      })),
    };
    render(<DashboardTrendPanel data={warming} />);

    const viewButton = screen.getByRole("button", { name: /Lượt xem tăng/ });
    expect(within(viewButton).getByText("0")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Hiển thị 0 lượt xem — chưa đủ baseline trong 28 ngày qua",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Lượt xem tăng trong 28 ngày/ })).toBeInTheDocument();
    expect(screen.getByText(/0 chỉ là giá trị hiển thị/u)).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: /Chi tiết theo ngày/ })).getAllByText(
        "0 (thiếu snapshot)",
      ),
    ).toHaveLength(warming.series.length);

    fireEvent.click(screen.getByRole("button", { name: /Video đã xuất bản/ }));
    expect(
      screen.getByRole("img", { name: /Video đã xuất bản trong 28 ngày/ }),
    ).toBeInTheDocument();
  });

  it("renders honest partial aggregates instead of blanking all covered channels", () => {
    const partial: DashboardTrendData = {
      ...populatedTrend,
      totals: { ...populatedTrend.totals, viewDelta: null, subscriberDelta: null },
      observedTotals: {
        viewDelta: { value: "200", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
        subscriberDelta: { value: "-3", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" },
      },
      coverage: {
        ...populatedTrend.coverage,
        channelsWithBaseline: 1,
        channelsWithCompleteCurrentSnapshot: 1,
      },
      series: populatedTrend.series.map((point, index) => ({
        ...point,
        viewDelta: null,
        subscriberDelta: null,
        observed: {
          viewDelta:
            index === 0
              ? { value: "25", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" as const }
              : {
                  value: null,
                  coveredChannels: 0,
                  totalChannels: 2,
                  status: "UNAVAILABLE" as const,
                },
          subscriberDelta:
            index === 0
              ? { value: "-3", coveredChannels: 1, totalChannels: 2, status: "PARTIAL" as const }
              : {
                  value: null,
                  coveredChannels: 0,
                  totalChannels: 2,
                  status: "UNAVAILABLE" as const,
                },
        },
      })),
    };

    render(<DashboardTrendPanel data={partial} />);

    expect(screen.getByText("+200")).toBeInTheDocument();
    expect(screen.getAllByText(/1\/2 kênh có dữ liệu/).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Lượt xem tăng trong 28 ngày/ })).toBeInTheDocument();
    expect(screen.getByText(/baseline đủ 28 ngày/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Lượt xem tăng/ })).queryByText("0"),
    ).not.toBeInTheDocument();

    const subscriberButton = screen.getByRole("button", { name: /Người đăng ký thay đổi/ });
    fireEvent.click(subscriberButton);
    expect(subscriberButton).toHaveAttribute("aria-pressed", "true");
    expect(within(subscriberButton).getByText("-3")).toBeVisible();
    expect(
      within(screen.getByRole("table", { name: /Chi tiết theo ngày/ })).getByText("-3"),
    ).toBeInTheDocument();
  });

  it("shows a visible partial-day legend even when the selected aggregate is complete", () => {
    const dailyPartial: DashboardTrendData = {
      ...populatedTrend,
      series: populatedTrend.series.map((point, index) => {
        if (index !== 0 || !point.observed) return point;
        return {
          ...point,
          viewDelta: null,
          observed: {
            ...point.observed,
            viewDelta: {
              value: "12000",
              coveredChannels: 1,
              totalChannels: 2,
              status: "PARTIAL" as const,
            },
          },
        };
      }),
    };

    render(<DashboardTrendPanel data={dailyPartial} />);

    expect(screen.getByText(/Một số ngày chỉ có dữ liệu của một phần kênh/)).toBeVisible();
    expect(screen.getByText(/1\/2 kênh ở ngày có độ phủ thấp nhất/)).toBeVisible();
  });

  it("recomputes legacy chart coverage when total channel coverage changes", () => {
    const legacySeries = populatedTrend.series.map((point) => ({
      date: point.date,
      viewDelta: point.viewDelta,
      subscriberDelta: point.subscriberDelta,
      publishedVideos: point.publishedVideos,
      hasSnapshot: point.hasSnapshot,
    }));
    const legacy: DashboardTrendData = {
      ...populatedTrend,
      coverage: { ...populatedTrend.coverage, totalChannels: 2 },
      series: legacySeries,
    };
    const { container, rerender } = render(<DashboardTrendPanel data={legacy} />);

    expect(container.querySelector("circle title")?.textContent).toContain("2/2 kênh có dữ liệu");

    rerender(
      <DashboardTrendPanel
        data={{
          ...legacy,
          coverage: { ...legacy.coverage, totalChannels: 3 },
        }}
      />,
    );

    expect(container.querySelector("circle title")?.textContent).toContain("3/3 kênh có dữ liệu");
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
          observedTotals: {
            viewDelta: { value: null, coveredChannels: 0, totalChannels: 0, status: "UNAVAILABLE" },
            subscriberDelta: {
              value: null,
              coveredChannels: 0,
              totalChannels: 0,
              status: "UNAVAILABLE",
            },
          },
          coverage: {
            totalChannels: 0,
            channelsWithCurrentSnapshot: 0,
            channelsScanned: 0,
            channelsWithCompleteCurrentSnapshot: 0,
            channelsWithCurrentSubscribers: 0,
            channelsWithCurrentLifetimeViews: 0,
            channelsWithCurrentPublicVideos: 0,
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
    expect(screen.queryByRole("button", { name: /Video đã xuất bản/ })).not.toBeInTheDocument();
  });
});
