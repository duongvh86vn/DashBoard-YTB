// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DailyVideoLeadersResponse } from "@yt-monitor/shared";
import { DailyVideoLeadersPanel } from "./daily-video-leaders-panel.js";

afterEach(cleanup);

const leaders: DailyVideoLeadersResponse = {
  date: "2026-08-27",
  previousDate: "2026-08-26",
  timeZone: "Asia/Bangkok",
  source: "YTDLP_CATALOG_SNAPSHOTS",
  coverageStatus: "COMPLETE",
  totalChannels: 1,
  channelsWithDailyGain: 1,
  channelsWithComparableCatalog: 1,
  warnings: [],
  items: [
    {
      rank: 1,
      channelId: "00000000-0000-4000-8000-000000000010",
      channelTitle: "Miu Miu mê truyện",
      videoId: "00000000-0000-4000-8000-000000000020",
      youtubeVideoId: "abc123",
      title: "Truyện hay nhất hôm nay",
      thumbnail: null,
      channelViewDelta: "10000",
      videoViewDelta: "6000",
      contributionPercent: 60,
      baselineAt: "2026-08-26T00:30:00.000Z",
      capturedAt: "2026-08-27T00:30:00.000Z",
      status: "COMPLETE",
    },
  ],
};

describe("DailyVideoLeadersPanel", () => {
  it("shows the highest measured daily video gain per channel, not new-video discovery", () => {
    render(<DailyVideoLeadersPanel data={leaders} loading={false} failed={false} />);

    expect(
      screen.getByRole("heading", { name: "Video dẫn đầu tăng view trong ngày" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Video mới phát hiện")).not.toBeInTheDocument();
    const row = screen.getByText("Truyện hay nhất hôm nay").closest("li");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("+6.000 view/ngày")).toBeInTheDocument();
    expect(row).toHaveTextContent("Miu Miu mê truyện · Kênh +10.000 · đóng góp 60%");
    expect(within(row!).queryByText("Dữ liệu một phần")).not.toBeInTheDocument();
  });

  it("does not label a partial catalog result as a daily video leader", () => {
    render(
      <DailyVideoLeadersPanel
        data={{
          ...leaders,
          coverageStatus: "PARTIAL",
          channelsWithDailyGain: 0,
          channelsWithComparableCatalog: 0,
          warnings: ["CATALOG_COVERAGE_PARTIAL"],
          items: [],
        }}
        loading={false}
        failed={false}
      />,
    );

    expect(screen.queryByRole("heading", { name: /Video dẫn đầu/u })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "So sánh tăng view video theo ngày" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/video dẫn đầu/iu)).not.toBeInTheDocument();
  });

  it("describes missing channel deltas as unknown instead of no positive gain", () => {
    render(
      <DailyVideoLeadersPanel
        data={{
          ...leaders,
          coverageStatus: "PARTIAL",
          channelsWithDailyGain: 0,
          channelsWithComparableCatalog: 1,
          warnings: ["CHANNEL_DAILY_VIEWS_UNAVAILABLE", "NO_POSITIVE_DAILY_GAIN"],
          items: [],
        }}
        loading={false}
        failed={false}
      />,
    );

    expect(screen.getByText(/chưa có dữ liệu lượt xem ngày đáng tin cậy/iu)).toBeInTheDocument();
    expect(screen.queryByText(/chưa có kênh tăng view dương/iu)).not.toBeInTheDocument();
  });

  it("renders missing and signed channel corrections without fabricating a positive delta", () => {
    const { rerender } = render(
      <DailyVideoLeadersPanel
        data={{
          ...leaders,
          items: [
            {
              ...leaders.items[0]!,
              channelViewDelta: null,
              contributionPercent: null,
            },
          ],
        }}
        loading={false}
        failed={false}
      />,
    );

    expect(screen.getByText(/Kênh chưa xác định · đóng góp chưa xác định/u)).toBeInTheDocument();
    expect(screen.queryByText(/Kênh \+0/u)).not.toBeInTheDocument();

    rerender(
      <DailyVideoLeadersPanel
        data={{
          ...leaders,
          items: [
            {
              ...leaders.items[0]!,
              channelViewDelta: "-250",
              contributionPercent: null,
            },
          ],
        }}
        loading={false}
        failed={false}
      />,
    );
    expect(screen.getByText(/Kênh -250 · đóng góp chưa xác định/u)).toBeInTheDocument();
    expect(screen.queryByText(/Kênh \+-250/u)).not.toBeInTheDocument();
  });

  it("explains that two real catalog scans are required during warm-up", () => {
    render(
      <DailyVideoLeadersPanel
        data={{
          ...leaders,
          coverageStatus: "WARMING_UP",
          channelsWithDailyGain: 0,
          channelsWithComparableCatalog: 0,
          warnings: ["CATALOG_BASELINE_REQUIRED"],
          items: [],
        }}
        loading={false}
        failed={false}
      />,
    );

    expect(screen.getByText(/Cần hai lần quét catalog thật/u)).toBeInTheDocument();
  });
});
