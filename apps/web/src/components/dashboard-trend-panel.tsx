"use client";

import { useMemo, useState } from "react";

import type { DashboardTrendPoint, DashboardTrendResponse } from "@yt-monitor/shared";

export type DashboardTrendData = DashboardTrendResponse;

type TrendMetric = "views" | "subscribers" | "videos";

const fullNumberFormatter = new Intl.NumberFormat("vi-VN");
const compactNumberFormatter = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function parseInteger(value: string | null): bigint | null {
  return value !== null && /^-?\d+$/u.test(value) ? BigInt(value) : null;
}

function formatExact(value: bigint): string {
  return fullNumberFormatter.format(value);
}

function formatSigned(value: bigint): string {
  return `${value > 0n ? "+" : ""}${formatExact(value)}`;
}

function formatCompact(value: bigint): string {
  return compactNumberFormatter.format(value);
}

function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}/${match[2]}` : value;
}

const metricDetails = {
  views: {
    label: "Lượt xem tăng",
    shortLabel: "lượt xem",
    tone: "text-sky-300",
    active: "border-sky-400 bg-sky-400/10",
    line: "#38bdf8",
    gradientId: "dashboard-view-trend",
  },
  subscribers: {
    label: "Người đăng ký thay đổi",
    shortLabel: "người đăng ký",
    tone: "text-violet-300",
    active: "border-violet-400 bg-violet-400/10",
    line: "#a78bfa",
    gradientId: "dashboard-subscriber-trend",
  },
  videos: {
    label: "Video mới đã phát hiện",
    shortLabel: "video đã phát hiện",
    tone: "text-emerald-300",
    active: "border-emerald-400 bg-emerald-400/10",
    line: "#34d399",
    gradientId: "dashboard-video-trend",
  },
} as const;

function metricTotal(data: DashboardTrendData, metric: TrendMetric): bigint | null {
  if (metric === "views") return parseInteger(data.totals.viewDelta);
  if (metric === "subscribers") return parseInteger(data.totals.subscriberDelta);
  return BigInt(data.totals.publishedVideos);
}

function pointValue(point: DashboardTrendPoint, metric: TrendMetric): bigint | null {
  if (metric === "views") return parseInteger(point.viewDelta);
  if (metric === "subscribers") return parseInteger(point.subscriberDelta);
  return BigInt(point.publishedVideos);
}

function metricValueLabel(value: bigint | null, metric: TrendMetric): string {
  if (value === null) return "Chưa đủ baseline";
  return metric === "videos" ? formatExact(value) : formatSigned(value);
}

function TrendMetricButton({
  metric,
  selected,
  value,
  onSelect,
}: {
  metric: TrendMetric;
  selected: boolean;
  value: bigint | null;
  onSelect: (metric: TrendMetric) => void;
}) {
  const detail = metricDetails[metric];
  return (
    <button
      type="button"
      className={`min-w-[13.5rem] flex-1 border-b-2 px-5 py-5 text-left transition sm:min-w-0 sm:border-b-0 sm:border-r-2 lg:px-7 ${
        selected ? detail.active : "border-slate-700 bg-slate-900/60 hover:bg-slate-800"
      }`}
      aria-pressed={selected}
      onClick={() => onSelect(metric)}
    >
      <span className="block text-xs font-semibold text-slate-400">{detail.label}</span>
      <span className={`mt-2 block text-2xl font-black tabular-nums ${detail.tone}`}>
        {metricValueLabel(value, metric)}
      </span>
      <span className="mt-1 block text-xs text-slate-500">
        {value === null ? "Đang chờ đủ hai mốc snapshot" : "Dữ liệu công khai đã lưu"}
      </span>
    </button>
  );
}

interface ChartPoint {
  date: string;
  value: bigint | null;
  x: number;
  y: number | null;
}

const CHART = {
  width: 900,
  height: 300,
  left: 60,
  right: 820,
  top: 24,
  bottom: 222,
} as const;

function splitKnownSegments(points: ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function DashboardTrendChart({ data, metric }: { data: DashboardTrendData; metric: TrendMetric }) {
  const detail = metricDetails[metric];
  const model = useMemo(() => {
    const raw = data.series.map((point) => ({
      date: point.date,
      value: pointValue(point, metric),
    }));
    const known = raw.flatMap((point) => (point.value === null ? [] : [point.value]));
    if (known.length === 0) return null;

    const minimum = known.reduce((result, value) => (value < result ? value : result), 0n);
    let maximum = known.reduce((result, value) => (value > result ? value : result), 0n);
    if (minimum === maximum) maximum = minimum + 1n;
    const range = maximum - minimum;
    const lastIndex = Math.max(1, raw.length - 1);
    const points: ChartPoint[] = raw.map((point, index) => ({
      ...point,
      x: CHART.left + (index / lastIndex) * (CHART.right - CHART.left),
      y:
        point.value === null
          ? null
          : CHART.top +
            (Number(((maximum - point.value) * 1_000n) / range) / 1_000) *
              (CHART.bottom - CHART.top),
    }));
    return {
      minimum,
      maximum,
      points,
      segments: splitKnownSegments(points),
      grid: [0, 1, 2, 3].map((step) => ({
        y: CHART.top + (step / 3) * (CHART.bottom - CHART.top),
        value: maximum - (range * BigInt(step)) / 3n,
      })),
    };
  }, [data.series, metric]);

  if (model === null) {
    return (
      <div
        className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-6 text-center"
        role="status"
      >
        <div>
          <p className="font-bold text-slate-200">Chưa đủ dữ liệu cho {detail.shortLabel}</p>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">
            Cần ít nhất hai snapshot thật để tính chênh lệch. Dashboard không điền số 0 vào ngày
            thiếu dữ liệu.
          </p>
        </div>
      </div>
    );
  }

  const firstDate = data.series[0]?.date ?? data.period.startDate;
  const middleDate = data.series[Math.floor(data.series.length / 2)]?.date ?? data.period.startDate;
  const lastDate = data.series.at(-1)?.date ?? data.period.endDate;
  const ariaSummary = `${detail.label} trong ${data.period.days} ngày; từ ${formatCalendarDate(
    firstDate,
  )} đến ${formatCalendarDate(lastDate)}.`;

  return (
    <div className="overflow-x-auto">
      <svg
        className="h-72 min-w-[42rem] w-full"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaSummary}
      >
        <title>{ariaSummary}</title>
        <desc>
          Đường biểu diễn chỉ nối các ngày có dữ liệu thật; khoảng trống là ngày thiếu snapshot.
        </desc>
        <defs>
          <linearGradient id={detail.gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={detail.line} stopOpacity="0.3" />
            <stop offset="100%" stopColor={detail.line} stopOpacity="0" />
          </linearGradient>
        </defs>
        {model.grid.map((line) => (
          <g key={line.y}>
            <line
              x1={CHART.left}
              x2={CHART.right}
              y1={line.y}
              y2={line.y}
              stroke="#334155"
              strokeWidth="1"
            />
            <text
              x="878"
              y={line.y + 5}
              textAnchor="end"
              fill="#94a3b8"
              fontSize="12"
              aria-hidden="true"
            >
              {formatCompact(line.value)}
            </text>
          </g>
        ))}
        {model.segments.map((segment, index) => {
          const coordinates = segment.map((point) => `${point.x},${point.y}`).join(" ");
          const area = `${segment[0]?.x},${CHART.bottom} ${coordinates} ${segment.at(-1)?.x},${CHART.bottom}`;
          return (
            <g key={`${segment[0]?.date ?? index}-${index}`}>
              {segment.length > 1 ? (
                <polygon points={area} fill={`url(#${detail.gradientId})`} />
              ) : null}
              {segment.length > 1 ? (
                <polyline
                  points={coordinates}
                  fill="none"
                  stroke={detail.line}
                  strokeWidth="3"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {segment.map((point) => (
                <circle
                  key={point.date}
                  cx={point.x}
                  cy={point.y ?? 0}
                  r="4"
                  fill={detail.line}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${formatCalendarDate(point.date)}: ${metricValueLabel(point.value, metric)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        <line
          x1={CHART.left}
          x2={CHART.right}
          y1={CHART.bottom}
          y2={CHART.bottom}
          stroke="#64748b"
          strokeWidth="1.25"
        />
        {[
          { x: CHART.left, anchor: "start" as const, value: firstDate },
          {
            x: (CHART.left + CHART.right) / 2,
            anchor: "middle" as const,
            value: middleDate,
          },
          { x: CHART.right, anchor: "end" as const, value: lastDate },
        ].map((date) => (
          <text
            key={`${date.x}-${date.value}`}
            x={date.x}
            y="260"
            textAnchor={date.anchor}
            fill="#94a3b8"
            fontSize="13"
            aria-hidden="true"
          >
            {formatCalendarDate(date.value)}
          </text>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{ariaSummary} Chi tiết theo ngày</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th>
            <th scope="col">{detail.label}</th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((point) => {
            const value = pointValue(point, metric);
            return (
              <tr key={point.date}>
                <th scope="row">{formatCalendarDate(point.date)}</th>
                <td>{value === null ? "Thiếu snapshot" : metricValueLabel(value, metric)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function headline(data: DashboardTrendData): string {
  const views = parseInteger(data.totals.viewDelta);
  if (views === null) return `Xu hướng công khai trong ${data.period.days} ngày qua`;
  if (views >= 0n) {
    return `Các kênh tăng ${formatExact(views)} lượt xem trong ${data.period.days} ngày qua`;
  }
  return `Lượt xem thay đổi ${formatSigned(views)} trong ${data.period.days} ngày qua`;
}

export function DashboardTrendPanel({
  data,
  loading = false,
  failed = false,
}: {
  data: DashboardTrendData | null;
  loading?: boolean;
  failed?: boolean;
}) {
  const [selectedMetric, setSelectedMetric] = useState<TrendMetric>("views");

  return (
    <section
      className="overflow-hidden rounded-[1.75rem] border border-slate-800 bg-[#101214] text-white shadow-xl shadow-slate-200"
      aria-labelledby="trend-panel-title"
    >
      <div className="px-5 pb-6 pt-7 text-center sm:px-8 sm:pt-9">
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-300">
            Hiệu suất 28 ngày
          </p>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300">
            Múi giờ {data?.period.timeZone ?? "Asia/Bangkok"}
          </span>
        </div>
        <h2 id="trend-panel-title" className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">
          {loading
            ? "Đang tải xu hướng 28 ngày…"
            : failed
              ? "Không thể tải xu hướng 28 ngày"
              : data
                ? headline(data)
                : "Xu hướng công khai trong 28 ngày qua"}
        </h2>
        <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Lượt xem và người đăng ký được tính từ chênh lệch snapshot thật; video mới là các video hệ
          thống đã phát hiện theo ngày xuất bản. Thời gian xem không có trong dữ liệu công khai nên
          không được ước đoán.
        </p>
      </div>

      {loading ? (
        <div className="mx-5 mb-7 grid min-h-80 place-items-center rounded-2xl border border-slate-800 bg-slate-950/50 sm:mx-8">
          <p className="font-semibold text-slate-300" role="status">
            Đang tải dữ liệu xu hướng…
          </p>
        </div>
      ) : failed ? (
        <div className="mx-5 mb-7 grid min-h-72 place-items-center rounded-2xl border border-rose-900/70 bg-rose-950/20 px-6 text-center sm:mx-8">
          <div>
            <p className="font-bold text-rose-200" role="alert">
              Dữ liệu xu hướng tạm thời không khả dụng.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Các KPI snapshot hiện tại phía trên vẫn hoạt động độc lập.
            </p>
          </div>
        </div>
      ) : data && data.coverage.totalChannels > 0 ? (
        <>
          <div className="flex overflow-x-auto border-y border-slate-800 sm:grid sm:grid-cols-3">
            {(["views", "subscribers", "videos"] as const).map((metric) => (
              <TrendMetricButton
                key={metric}
                metric={metric}
                selected={selectedMetric === metric}
                value={metricTotal(data, metric)}
                onSelect={setSelectedMetric}
              />
            ))}
          </div>
          <div className="px-4 py-5 sm:px-7 sm:py-7">
            <DashboardTrendChart data={data} metric={selectedMetric} />
            <div className="mt-4 flex flex-col justify-between gap-2 border-t border-slate-800 pt-4 text-xs text-slate-400 sm:flex-row sm:items-center">
              <p>
                {data.coverage.channelsWithBaseline}/{data.coverage.totalChannels} kênh đủ baseline
                · {data.coverage.channelsWithCurrentSnapshot}/{data.coverage.totalChannels} kênh có
                snapshot hiện tại
              </p>
              <p>
                {data.coverage.completeDays}/{data.coverage.requestedDays} ngày đủ dữ liệu
                {" · "}
                {fullNumberFormatter.format(data.coverage.coveragePercent)}% độ phủ
                {data.coverage.partialDays > 0
                  ? ` · ${data.coverage.partialDays} ngày một phần`
                  : ""}
              </p>
            </div>
            <p className="mt-2 text-right text-xs text-slate-500">
              {formatCalendarDate(data.period.startDate)}–{formatCalendarDate(data.period.endDate)}{" "}
              · không nội suy ngày thiếu
            </p>
          </div>
        </>
      ) : data ? (
        <div className="mx-5 mb-7 grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-6 text-center sm:mx-8">
          <div>
            <p className="font-bold text-slate-200">Chưa có kênh để phân tích</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Thêm ít nhất một kênh YouTube để bắt đầu thu thập snapshot và dựng biểu đồ 28 ngày.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-5 mb-7 grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-6 text-center sm:mx-8">
          <div>
            <p className="font-bold text-slate-200">Chưa có dữ liệu xu hướng</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Panel sẽ tự xuất hiện sau khi kênh có snapshot thật đầu tiên.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
