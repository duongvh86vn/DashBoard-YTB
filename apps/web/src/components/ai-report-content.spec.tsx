// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AiReportContent, buildAiReportView } from "./ai-report-content.js";

afterEach(cleanup);

describe("AiReportContent", () => {
  it("renders evidence-grounded claims and caveats from a persisted report record", () => {
    render(
      <AiReportContent
        kind="DAILY"
        report={{
          provider: "GEMINI",
          modelId: "gemini-2.5-flash",
          result: {
            summary: "Tăng trưởng được tập trung ở hai video mới.",
            claims: [
              {
                narrative: "Hai video đóng góp phần lớn lượt xem tăng thêm.",
                evidenceMetricIds: ["video:a:view-delta:7d", "video:b:view-delta:7d"],
                confidence: 0.82,
                caveats: ["Subscriber công khai đã được làm tròn."],
              },
            ],
            keyFindings: ["Video A đang dẫn đầu."],
          },
        }}
      />,
    );

    expect(screen.getByText("Tăng trưởng được tập trung ở hai video mới.")).toBeInTheDocument();
    expect(screen.getByText("Hai video đóng góp phần lớn lượt xem tăng thêm.")).toBeInTheDocument();
    expect(screen.getByText("82% tin cậy")).toBeInTheDocument();
    expect(screen.getByText("video:a:view-delta:7d")).toBeInTheDocument();
    expect(screen.getByText(/Subscriber công khai đã được làm tròn/)).toBeInTheDocument();
    expect(screen.getByText("Video A đang dẫn đầu.")).toBeInTheDocument();
    expect(screen.getByText("AI: Gemini · gemini-2.5-flash")).toBeInTheDocument();
  });

  it("renders an explicit warming state instead of inventing a report", () => {
    render(
      <AiReportContent
        kind="WEEKLY"
        report={{ result: { status: "INSUFFICIENT_DATA", reason: "Thiếu baseline 7 ngày." } }}
      />,
    );

    expect(screen.getByText("Đang tích lũy dữ liệu")).toBeInTheDocument();
    expect(screen.getByText("Thiếu baseline 7 ngày.")).toBeInTheDocument();
  });

  it("keeps the legacy weekly shape readable", () => {
    const view = buildAiReportView("WEEKLY", {
      result: {
        executiveSummary: "Tổng kết tuần.",
        winners: [{ videoId: "video-1", reason: "VPH cao hơn trung vị." }],
        recommendations: ["Theo dõi thêm trong 24 giờ."],
      },
    });

    expect(view).toMatchObject({
      heading: "Tổng kết tuần.",
      insufficientReason: null,
      sections: [
        { title: "Video nổi bật", items: ["video-1: VPH cao hơn trung vị."] },
        { title: "Đề xuất", items: ["Theo dõi thêm trong 24 giờ."] },
      ],
    });
  });

  it("resolves canonical evidence ids into auditable metric details", () => {
    render(
      <AiReportContent
        kind="DAILY"
        report={{
          result: {
            schemaVersion: "grounded-report-v1",
            report: {
              summary: {
                text: "Kênh tăng 1.000 lượt xem trong kỳ.",
                evidenceIds: ["channel:abc:view_delta:7d"],
              },
              keyFindings: [],
              risks: [],
              opportunities: [],
              limitations: [],
              channelsToInspect: [],
              videosToInspect: [],
            },
            grounding: {
              coverage: {
                status: "COMPLETE",
                expectedChannelDays: 7,
                observedChannelDays: 7,
                completeChannelDays: 7,
                reason: null,
              },
              evidence: [
                {
                  id: "channel:abc:view_delta:7d",
                  entityType: "CHANNEL",
                  entityId: "abc",
                  metric: "view_delta",
                  value: "1000",
                  unit: "views",
                  observedAt: "2026-08-25T08:30:00.000Z",
                  source: "CHANNEL_DAILY_STAT",
                  coverage: "COMPLETE",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Kênh tăng 1.000 lượt xem trong kỳ.")).toBeInTheDocument();
    expect(screen.getByText(/Kênh:/u)).toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("channel:abc:view_delta:7d")).toBeInTheDocument();
    expect(screen.getByText("Thay đổi lượt xem")).toBeInTheDocument();
    expect(screen.getByText("1.000 lượt xem")).toBeInTheDocument();
    expect(screen.getByText("Snapshot ngày của kênh")).toBeInTheDocument();
    expect(screen.getByText("25/08/2026, 08:30 UTC")).toBeInTheDocument();
    expect(screen.getByText("Đầy đủ")).toBeInTheDocument();
  });

  it("shows precision and status when evidence does not use coverage", () => {
    render(
      <AiReportContent
        kind="DAILY"
        report={{
          result: {
            schemaVersion: "grounded-report-v1",
            report: {
              summary: {
                text: "Kênh hiện có 406000 người đăng ký công khai.",
                evidenceIds: ["channel:abc:subscriber_count"],
              },
            },
            grounding: {
              coverage: { status: "COMPLETE" },
              evidence: [
                {
                  id: "channel:abc:subscriber_count",
                  metric: "subscriber_count",
                  value: "406000",
                  unit: "subscribers",
                  observedAt: "2026-08-25",
                  source: "YOUTUBE_PUBLIC_PAGE",
                  precision: "ROUNDED_3_SIGNIFICANT_DIGITS",
                  status: "READY",
                  reason: "ROUNDED_PUBLIC_SOURCE",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByText("406.000 người đăng ký")).toBeInTheDocument();
    expect(screen.getByText("Trang YouTube công khai")).toBeInTheDocument();
    expect(screen.getByText("Làm tròn 3 chữ số có nghĩa")).toBeInTheDocument();
    expect(screen.getByText("Sẵn sàng")).toBeInTheDocument();
    expect(screen.getByText("Nguồn công khai có thể đã được YouTube làm tròn")).toBeInTheDocument();
  });

  it("marks a cited id as unresolved instead of presenting it as valid evidence", () => {
    render(
      <AiReportContent
        kind="DAILY"
        report={{
          result: {
            schemaVersion: "grounded-report-v1",
            report: {
              summary: { text: "Nhận định bị thiếu evidence.", evidenceIds: ["missing:evidence"] },
            },
            grounding: { coverage: { status: "COMPLETE" }, evidence: [] },
          },
        }}
      />,
    );

    expect(screen.getByText("missing:evidence")).toBeInTheDocument();
    expect(
      screen.getByText("Không tìm thấy chi tiết dẫn chứng trong báo cáo đã lưu."),
    ).toBeInTheDocument();
  });

  it("turns insufficient canonical coverage into a clear warm-up state", () => {
    render(
      <AiReportContent
        kind="WEEKLY"
        report={{
          result: {
            schemaVersion: "grounded-report-v1",
            report: {},
            grounding: {
              coverage: { status: "INSUFFICIENT", reason: "INSUFFICIENT_HISTORY" },
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Chưa đủ lịch sử snapshot cho kỳ báo cáo.")).toBeInTheDocument();
  });

  it("always shows a deterministic PARTIAL coverage banner for legacy stored reports", () => {
    render(
      <AiReportContent
        kind="DAILY"
        report={{
          result: {
            summary: "Nhận định cũ không tự nêu giới hạn độ phủ.",
            coverage: {
              status: "PARTIAL",
              reason: "INCOMPLETE_CHANNEL_DAY_COVERAGE",
            },
          },
        }}
      />,
    );

    expect(screen.getByText("Độ phủ dữ liệu một phần")).toBeInTheDocument();
    expect(
      screen.getByText("Kỳ báo cáo thiếu một phần snapshot; dữ liệu thiếu không được xem là 0."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nhận định cũ không tự nêu giới hạn độ phủ.")).toBeInTheDocument();
  });
});
