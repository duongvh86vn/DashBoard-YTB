// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PublicIntelligenceMetric, PublicIntelligenceResponse } from "@yt-monitor/shared";

import { PublicIntelligencePanel } from "./public-intelligence-panel.js";

afterEach(cleanup);

function metric(
  value: string | null,
  overrides: Partial<PublicIntelligenceMetric> = {},
): PublicIntelligenceMetric {
  return {
    value,
    status: value === null ? "WARMING_UP" : "READY",
    metricClass: "LOCAL_SNAPSHOT_DERIVED",
    precision: "DERIVED_FROM_EXACT_PUBLIC_COUNTERS",
    unit: "COUNT",
    reason: value === null ? "INSUFFICIENT_HISTORY" : null,
    provenance: {
      source: "CHANNEL_DAILY_STAT",
      capturedAt: "2026-08-26T00:10:00.000Z",
      baselineDate: "2026-07-27",
      method: "canonical-snapshot-delta",
      methodVersion: "v1",
    },
    ...overrides,
  };
}

function response(): PublicIntelligenceResponse {
  return {
    channelId: "00000000-0000-4000-8000-000000000010",
    asOf: "2026-08-26T00:10:00.000Z",
    period: {
      startDate: "2026-07-28",
      endDate: "2026-08-26",
      days: 30,
      timeZone: "Asia/Bangkok",
    },
    metrics: {
      lifetimeViews: metric("144693948", { metricClass: "PUBLIC_CURRENT" }),
      subscribers: metric("406000", {
        metricClass: "PUBLIC_CURRENT",
        precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
      }),
      publicVideos: metric("183", { metricClass: "PUBLIC_CURRENT" }),
      viewsGained: metric("4151847"),
      subscribersGained: metric(null, {
        precision: "DERIVED_FROM_ROUNDED_PUBLIC_COUNTERS",
      }),
      publicInventoryDelta: metric("-4"),
      publishedVideos: metric("3", { metricClass: "DETERMINISTIC_PUBLIC_METADATA" }),
      averageVideoDurationSeconds: metric("4200", {
        metricClass: "DETERMINISTIC_PUBLIC_METADATA",
        precision: "SAMPLE_BASED",
        unit: "SECONDS",
      }),
      uploadFrequencyPerWeek: metric("0.7", {
        metricClass: "DETERMINISTIC_PUBLIC_METADATA",
        precision: "SAMPLE_BASED",
        unit: "UPLOADS_PER_WEEK",
      }),
    },
    coverage: {
      requestedDays: 30,
      completeDays: 12,
      partialDays: 1,
      coveragePercent: 40,
      hasCurrentSnapshot: true,
      hasBaseline: false,
      reportedPublicVideos: "183",
      knownPublicVideos: 50,
      durationKnownVideos: 48,
    },
    warnings: [
      "INCOMPLETE_DAILY_HISTORY",
      "SUBSCRIBER_COUNTS_ARE_ROUNDED",
      "INCOMPLETE_VIDEO_CATALOG",
    ],
  };
}

describe("PublicIntelligencePanel", () => {
  it("renders typed current totals with their quality and provenance details", () => {
    render(<PublicIntelligencePanel data={response()} />);

    const subscribers = screen.getByText("Người đăng ký hiện tại").closest("article");
    expect(subscribers).not.toBeNull();
    expect(within(subscribers!).getByText("406.000")).toBeInTheDocument();
    expect(within(subscribers!).getByText("Công khai hiện tại")).toBeInTheDocument();
    expect(within(subscribers!).getByText("READY")).toBeInTheDocument();
    expect(within(subscribers!).getByText(/ROUNDED_3_SIGNIFICANT_DIGITS/u)).toBeInTheDocument();
    expect(within(subscribers!).getByText(/2026-08-26T00:10:00.000Z/u)).toBeInTheDocument();
    expect(within(subscribers!).getByText(/CHANNEL_DAILY_STAT/u)).toBeInTheDocument();
    expect(within(subscribers!).getByText(/canonical-snapshot-delta/u)).toBeInTheDocument();
    expect(within(subscribers!).getByText(/Không có/u)).toBeInTheDocument();
  });

  it("separates actual publishing from public inventory corrections", () => {
    render(<PublicIntelligencePanel data={response()} />);

    expect(
      screen.getByRole("heading", { name: "Phân tích công khai 30 ngày" }),
    ).toBeInTheDocument();
    const published = screen.getByText("Video thực sự xuất bản").closest("article");
    const inventory = screen.getByText("Biến động kho video công khai").closest("article");
    expect(published).not.toBeNull();
    expect(inventory).not.toBeNull();
    expect(within(published!).getByText("3")).toBeInTheDocument();
    expect(within(inventory!).getByText("-4")).toBeInTheDocument();
  });

  it("shows a qualified zero placeholder while preserving warming status and provenance", () => {
    render(<PublicIntelligencePanel data={response()} />);

    const subscribers = screen.getByText("Người đăng ký tăng").closest("article");
    expect(subscribers).not.toBeNull();
    expect(within(subscribers!).getByText("0")).toBeInTheDocument();
    expect(within(subscribers!).getByText("hiển thị tạm")).toBeInTheDocument();
    expect(within(subscribers!).getByText("Đang tích lũy baseline")).toBeInTheDocument();
    expect(screen.getByText("Subscriber công khai đã bị làm tròn")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Độ phủ snapshot công khai" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
  });

  it("does not present known catalog rows as an impossible ratio over a missing total", () => {
    const data = response();
    data.coverage.reportedPublicVideos = null;
    render(<PublicIntelligencePanel data={data} />);

    expect(
      screen.getByText(/Catalog biết 50 video công khai; tổng công khai hiển thị tạm 0/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/50\/0 video/u)).not.toBeInTheDocument();
  });
});
