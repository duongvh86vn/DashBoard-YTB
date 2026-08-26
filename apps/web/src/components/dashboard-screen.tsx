"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  getAiReport,
  getDashboardTrends,
  getHealth,
  getVietnameseApiMessage,
  listChannels,
  listRecentVideos,
  listWeeklyVideoRanking,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";
import { AiReportContent } from "./ai-report-content";
import { DashboardTrendPanel } from "./dashboard-trend-panel";

const compactNumberFormatter = new Intl.NumberFormat("vi-VN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullNumberFormatter = new Intl.NumberFormat("vi-VN");
// Phase baseline contract: scheduling and report boundaries use this application timezone.
const APPLICATION_TIME_ZONE = "Asia/Bangkok";

function parseMetric(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !/^-?\d+$/u.test(value)) return null;
  return BigInt(value);
}

function formatNumber(value: bigint | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const metric = typeof value === "bigint" ? value : parseMetric(value);
  return metric === null ? "—" : fullNumberFormatter.format(metric);
}

function formatCompactNumber(value: bigint): string {
  return compactNumberFormatter.format(value);
}

function formatSignedNumber(value: bigint): string {
  return `${value > 0n ? "+" : ""}${formatNumber(value)}`;
}

function freshness(value: string | null | undefined): string {
  if (!value) return "Chưa có snapshot";
  return `Cập nhật ${new Date(value).toLocaleString("vi-VN")}`;
}

function calendarDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function sumMetrics(values: Array<string | null>): { total: bigint | null; known: number } {
  let total = 0n;
  let known = 0;
  for (const value of values) {
    const metric = parseMetric(value);
    if (metric === null) continue;
    total += metric;
    known += 1;
  }
  return { total: known > 0 || values.length === 0 ? total : null, known };
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function barWidth(value: bigint, maximum: bigint): number {
  const magnitude = absolute(value);
  if (magnitude === 0n || maximum === 0n) return 0;
  const percentage = Number((magnitude * 1_000n) / maximum) / 10;
  return Math.max(3, Math.min(100, percentage));
}

interface ChartItem {
  id: string;
  label: string;
  meta: string;
  value: bigint;
}

interface SnapshotBarChartProps {
  title: string;
  description: string;
  items: ChartItem[];
  emptyMessage: string;
  tone: "sky" | "violet" | "rose" | "emerald";
  loading?: boolean;
  signed?: boolean;
}

const barToneClasses = {
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
} as const;

function SnapshotBarChart({
  title,
  description,
  items,
  emptyMessage,
  tone,
  loading = false,
  signed = false,
}: SnapshotBarChartProps) {
  const maximum = items.reduce(
    (current, item) => (absolute(item.value) > current ? absolute(item.value) : current),
    0n,
  );

  return (
    <figure className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <figcaption>
        <h3 className="text-lg font-bold tracking-tight text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </figcaption>
      {loading ? (
        <div
          className="mt-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-8 text-center"
          role="status"
        >
          <p className="text-sm font-semibold text-sky-800">Đang tải dữ liệu biểu đồ…</p>
        </div>
      ) : items.length > 0 ? (
        <ol className="mt-6 space-y-5">
          {items.map((item) => (
            <li key={item.id}>
              <div className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800" title={item.label}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{item.meta}</p>
                </div>
                <p className="shrink-0 font-black tabular-nums text-slate-950">
                  {signed ? formatSignedNumber(item.value) : formatCompactNumber(item.value)}
                </p>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`${item.label}: ${signed ? formatSignedNumber(item.value) : formatNumber(item.value)}`}
              >
                <div
                  className={`h-full rounded-full ${item.value < 0n ? "bg-amber-500" : barToneClasses[tone]}`}
                  style={{ width: `${barWidth(item.value, maximum)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-600">{emptyMessage}</p>
          <p className="mt-1 text-xs text-slate-500">
            Biểu đồ sẽ tự xuất hiện khi có snapshot thật.
          </p>
        </div>
      )}
    </figure>
  );
}

function CoverageRow({ label, known, total }: { label: string; known: number; total: number }) {
  const percentage = total === 0 ? 0 : Math.round((known / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          {known}/{total} kênh
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={`Độ phủ ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export function DashboardScreen() {
  const auth = useAuth();
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listChannels>> | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof listRecentVideos>> | null>(null);
  const [weekly, setWeekly] = useState<Awaited<ReturnType<typeof listWeeklyVideoRanking>> | null>(
    null,
  );
  const [trends, setTrends] = useState<Awaited<ReturnType<typeof getDashboardTrends>> | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [reports, setReports] = useState<Awaited<ReturnType<typeof getAiReport>>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [recentFailed, setRecentFailed] = useState(false);
  const [weeklyFailed, setWeeklyFailed] = useState(false);
  const [trendsFailed, setTrendsFailed] = useState(false);
  const [healthUnavailable, setHealthUnavailable] = useState(false);
  const [reportsUnavailable, setReportsUnavailable] = useState(false);
  const [supplementalLoading, setSupplementalLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    if (auth.state.status !== "authenticated") return;

    const controller = new AbortController();
    mounted.current = true;
    setLoading(true);
    setError(null);
    setChannelsFailed(false);
    setRecentFailed(false);
    setWeeklyFailed(false);
    setTrendsFailed(false);
    setHealthUnavailable(false);
    setReportsUnavailable(false);
    setSupplementalLoading(true);
    const isAdminUser = auth.state.user.role === "ADMIN";
    const reportDate = calendarDateInTimeZone(new Date(), APPLICATION_TIME_ZONE);
    const healthRequest = isAdminUser ? getHealth() : Promise.resolve(null);
    const dailyReportRequest = isAdminUser
      ? getAiReport("daily", reportDate)
      : Promise.resolve(null);
    const weeklyReportRequest = isAdminUser
      ? getAiReport("weekly", reportDate)
      : Promise.resolve(null);
    void Promise.allSettled([
      listChannels({ page: 1, pageSize: 100, signal: controller.signal }),
      listRecentVideos({ page: 1, pageSize: 6, signal: controller.signal }),
      listWeeklyVideoRanking({ page: 1, pageSize: 5, signal: controller.signal }),
      getDashboardTrends(28, controller.signal),
    ])
      .then(([channelResult, recentResult, weeklyResult, trendResult]) => {
        if (!mounted.current || controller.signal.aborted) return;

        const failures = [channelResult, recentResult, weeklyResult, trendResult].flatMap(
          (result) => (result.status === "rejected" ? [result.reason] : []),
        );
        if (failures.some((reason) => auth.handleApiError(reason))) return;

        setChannels(channelResult.status === "fulfilled" ? channelResult.value : null);
        setRecent(recentResult.status === "fulfilled" ? recentResult.value : null);
        setWeekly(weeklyResult.status === "fulfilled" ? weeklyResult.value : null);
        setTrends(trendResult.status === "fulfilled" ? trendResult.value : null);
        setChannelsFailed(channelResult.status === "rejected");
        setRecentFailed(recentResult.status === "rejected");
        setWeeklyFailed(weeklyResult.status === "rejected");
        setTrendsFailed(trendResult.status === "rejected");
        setError(failures.length > 0 ? getVietnameseApiMessage(failures[0]) : null);
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) setLoading(false);
      });

    const dashboardRefreshTimer = window.setInterval(() => {
      void Promise.allSettled([
        listChannels({ page: 1, pageSize: 100, signal: controller.signal }),
        listRecentVideos({ page: 1, pageSize: 6, signal: controller.signal }),
        listWeeklyVideoRanking({ page: 1, pageSize: 5, signal: controller.signal }),
        getDashboardTrends(28, controller.signal),
      ]).then(([channelResult, recentResult, weeklyResult, trendResult]) => {
        if (!mounted.current || controller.signal.aborted) return;
        const failures = [channelResult, recentResult, weeklyResult, trendResult].flatMap(
          (result) => (result.status === "rejected" ? [result.reason] : []),
        );
        if (failures.some((reason) => auth.handleApiError(reason))) return;

        if (channelResult.status === "fulfilled") {
          setChannels(channelResult.value);
          setChannelsFailed(false);
        }
        if (recentResult.status === "fulfilled") {
          setRecent(recentResult.value);
          setRecentFailed(false);
        }
        if (weeklyResult.status === "fulfilled") {
          setWeekly(weeklyResult.value);
          setWeeklyFailed(false);
        }
        if (trendResult.status === "fulfilled") {
          setTrends(trendResult.value);
          setTrendsFailed(false);
        }
      });
    }, 60_000);

    // A newly added channel is collected asynchronously by the worker. Poll only
    // the two snapshot-dependent endpoints more quickly during that bounded
    // warm-up window, then fall back to the regular one-minute dashboard refresh.
    let warmupAttempts = 0;
    const snapshotWarmupTimer = window.setInterval(() => {
      warmupAttempts += 1;
      void Promise.allSettled([
        listChannels({ page: 1, pageSize: 100, signal: controller.signal }),
        getDashboardTrends(28, controller.signal),
      ]).then(([channelResult, trendResult]) => {
        if (!mounted.current || controller.signal.aborted) return;
        const failures = [channelResult, trendResult].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.some((reason) => auth.handleApiError(reason))) return;

        if (channelResult.status === "fulfilled") {
          setChannels(channelResult.value);
          setChannelsFailed(false);
          const enabled = channelResult.value.items.filter((channel) => channel.isEnabled);
          if (
            enabled.length === 0 ||
            enabled.every((channel) => channel.lastChannelScanAt !== null) ||
            warmupAttempts >= 12
          ) {
            window.clearInterval(snapshotWarmupTimer);
          }
        } else if (warmupAttempts >= 12) {
          window.clearInterval(snapshotWarmupTimer);
        }
        if (trendResult.status === "fulfilled") {
          setTrends(trendResult.value);
          setTrendsFailed(false);
        }
      });
    }, 10_000);

    void Promise.allSettled([healthRequest, dailyReportRequest, weeklyReportRequest])
      .then(([healthResult, dailyResult, weeklyReportResult]) => {
        if (!mounted.current || controller.signal.aborted) return;
        const failures = [healthResult, dailyResult, weeklyReportResult].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.some((reason) => auth.handleApiError(reason))) return;

        setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
        setHealthUnavailable(healthResult.status === "rejected");
        setReports(
          [dailyResult, weeklyReportResult].flatMap((result) =>
            result.status === "fulfilled" && result.value !== null ? [result.value] : [],
          ),
        );
        setReportsUnavailable(
          isAdminUser &&
            (dailyResult.status === "rejected" || weeklyReportResult.status === "rejected"),
        );
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) setSupplementalLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      window.clearInterval(dashboardRefreshTimer);
      window.clearInterval(snapshotWarmupTimer);
    };
  }, [auth]);

  const channelItems = channels?.items ?? [];
  const hasCompleteChannelCoverage = channels ? channelItems.length >= channels.total : false;
  const enabledChannels = hasCompleteChannelCoverage
    ? channelItems.filter((channel) => channel.isEnabled).length
    : null;
  const activeChannels = hasCompleteChannelCoverage
    ? channelItems.filter((channel) => channel.availabilityStatus === "ACTIVE").length
    : null;
  const subscriberSummary = sumMetrics(channelItems.map((channel) => channel.subscriberCount));
  const lifetimeViewSummary = sumMetrics(channelItems.map((channel) => channel.lifetimeViewCount));
  const videoSummary = sumMetrics(channelItems.map((channel) => channel.videoCount));
  const subscriberCoverageComplete =
    hasCompleteChannelCoverage && subscriberSummary.known === channelItems.length;
  const displayedSubscriberTotal = hasCompleteChannelCoverage
    ? (subscriberSummary.total ?? 0n)
    : null;
  const totalLifetimeViews =
    hasCompleteChannelCoverage && lifetimeViewSummary.known === channelItems.length
      ? lifetimeViewSummary.total
      : null;
  const totalVideos =
    hasCompleteChannelCoverage && videoSummary.known === channelItems.length
      ? videoSummary.total
      : null;

  const channelSubscriberChart = channelItems
    .flatMap((channel) => {
      const value = parseMetric(channel.subscriberCount);
      return value === null
        ? []
        : [
            {
              id: channel.id,
              label: channel.title,
              meta: channel.handle ?? channel.youtubeChannelId,
              value,
            },
          ];
    })
    .sort((left, right) => (left.value === right.value ? 0 : left.value > right.value ? -1 : 1))
    .slice(0, 6);

  const channelViewChart = channelItems
    .flatMap((channel) => {
      const value = parseMetric(channel.lifetimeViewCount);
      return value === null
        ? []
        : [
            {
              id: channel.id,
              label: channel.title,
              meta: channel.handle ?? channel.youtubeChannelId,
              value,
            },
          ];
    })
    .sort((left, right) => (left.value === right.value ? 0 : left.value > right.value ? -1 : 1))
    .slice(0, 6);

  const recentViewChart = (recent?.items ?? [])
    .flatMap((video) => {
      const value = parseMetric(video.currentViews);
      return value === null
        ? []
        : [
            {
              id: video.id,
              label: video.title ?? video.youtubeVideoId,
              meta: video.channelTitle,
              value,
            },
          ];
    })
    .sort((left, right) => (left.value === right.value ? 0 : left.value > right.value ? -1 : 1));

  const weeklyGainChart = (weekly?.items ?? []).flatMap((video) => {
    const value = parseMetric(video.weeklyGain);
    return value === null
      ? []
      : [
          {
            id: video.id,
            label: video.title ?? video.youtubeVideoId,
            meta: `${video.channelTitle} · #${video.rank}`,
            value,
          },
        ];
  });

  const latestSnapshotAt = channelItems
    .flatMap((channel) => (channel.lastChannelScanAt ? [channel.lastChannelScanAt] : []))
    .sort((left, right) => right.localeCompare(left))[0];
  const isAdmin = auth.state.status === "authenticated" && auth.state.user.role === "ADMIN";

  return (
    <div className="mx-auto max-w-[92rem] space-y-7">
      <header className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-8 text-white shadow-xl shadow-slate-200 sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-300">
              YouTube operations center
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
              Tổng quan giám sát
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
              Theo dõi quy mô kênh, sức hút video và tình trạng thu thập trên một màn hình. Mọi con
              số đều lấy từ snapshot đã lưu, không nội suy dữ liệu còn thiếu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200">
              {loading
                ? "Đang tải snapshot kênh"
                : channelsFailed
                  ? "Không tải được snapshot kênh"
                  : freshness(latestSnapshotAt)}
            </span>
            <Link className="button-primary bg-sky-700 hover:bg-sky-800" href="/channels">
              Quản lý kênh
            </Link>
          </div>
        </div>
      </header>

      {error ? (
        <p className="alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p
          className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800"
          role="status"
          aria-live="polite"
        >
          Đang tải dashboard…
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4" aria-label="Chỉ số tổng quan">
        {[
          {
            label: "Kênh đang theo dõi",
            value: `${enabledChannels === null ? "—" : enabledChannels}/${channels?.total ?? "—"}`,
            hint:
              activeChannels === null
                ? "Cần tải đủ danh sách kênh"
                : `${activeChannels} kênh đang khả dụng`,
            accent: "bg-sky-500",
          },
          {
            label: subscriberCoverageComplete ? "Tổng người đăng ký" : "Người đăng ký đã ghi nhận",
            value:
              displayedSubscriberTotal === null
                ? "—"
                : subscriberCoverageComplete
                  ? formatNumber(displayedSubscriberTotal)
                  : `≥ ${formatNumber(displayedSubscriberTotal)}`,
            hint: subscriberCoverageComplete
              ? `${subscriberSummary.known}/${channelItems.length} kênh có số liệu`
              : `${subscriberSummary.known}/${channelItems.length} kênh có số liệu · ${Math.max(
                  0,
                  channelItems.length - subscriberSummary.known,
                )} chưa xác minh`,
            accent: "bg-violet-500",
          },
          {
            label: "Tổng lượt xem trọn đời",
            value: formatNumber(totalLifetimeViews),
            hint: `${lifetimeViewSummary.known}/${channelItems.length} kênh có snapshot`,
            accent: "bg-rose-500",
          },
          {
            label: "Video đã xuất bản",
            value: formatNumber(totalVideos),
            hint: `${videoSummary.known}/${channelItems.length} kênh có metadata`,
            accent: "bg-emerald-500",
          },
        ].map((metric) => (
          <article
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            key={metric.label}
          >
            <span className={`absolute inset-x-0 top-0 h-1 ${metric.accent}`} />
            <p className="text-sm font-bold text-slate-500">{metric.label}</p>
            <p className="mt-3 break-words text-3xl font-black tracking-tight text-slate-950">
              {metric.value}
            </p>
            <p className="mt-2 text-xs font-medium text-slate-500">{metric.hint}</p>
          </article>
        ))}
      </section>

      <section
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Nguồn và độ chính xác dữ liệu"
      >
        {[
          ["Công khai hiện tại", "Views và số video tại lần thu thập gần nhất.", "bg-emerald-500"],
          ["Công khai làm tròn", "Subscriber có thể được YouTube làm tròn.", "bg-violet-500"],
          ["Snapshot suy ra", "Tăng trưởng chỉ tính khi có đủ baseline thật.", "bg-sky-500"],
          ["AI diễn giải", "AI giải thích dữ liệu; không tạo hoặc sửa metric.", "bg-amber-500"],
        ].map(([label, description, tone]) => (
          <div className="flex gap-3 rounded-xl bg-slate-50 p-3" key={label}>
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-700">{label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
            </div>
          </div>
        ))}
      </section>

      <DashboardTrendPanel data={trends} loading={loading} failed={trendsFailed} />

      <section aria-labelledby="channel-insights-title">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Quy mô danh mục</p>
            <h2 id="channel-insights-title" className="mt-1 text-2xl font-black text-slate-950">
              So sánh các kênh
            </h2>
          </div>
          <p className="text-sm text-slate-500">
            Snapshot hiện tại · tối đa 6 kênh trong trang đã tải
          </p>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <SnapshotBarChart
            title="Người đăng ký theo kênh"
            description="Quy mô audience công khai tại lần thu thập gần nhất."
            items={channelSubscriberChart}
            emptyMessage={
              channelsFailed ? "Không thể tải snapshot kênh." : "Chưa có snapshot người đăng ký."
            }
            tone="violet"
            loading={loading}
          />
          <SnapshotBarChart
            title="Lượt xem trọn đời theo kênh"
            description="Tổng lượt xem công khai, không phải tăng trưởng theo thời gian."
            items={channelViewChart}
            emptyMessage={
              channelsFailed ? "Không thể tải snapshot kênh." : "Chưa có snapshot lượt xem kênh."
            }
            tone="rose"
            loading={loading}
          />
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-black text-slate-950">Bảng chỉ số kênh</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Subscriber là số công khai có thể bị làm tròn; video chỉ tính nội dung đang công
                khai.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-500">{channelItems.length} kênh</span>
          </div>
          {channelItems.length > 0 ? (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-black" scope="col">
                      Kênh
                    </th>
                    <th className="px-4 py-3 text-right font-black" scope="col">
                      Subscriber
                    </th>
                    <th className="px-4 py-3 text-right font-black" scope="col">
                      Lifetime views
                    </th>
                    <th className="px-4 py-3 text-right font-black" scope="col">
                      Video công khai
                    </th>
                    <th className="px-4 py-3 font-black" scope="col">
                      Snapshot
                    </th>
                    <th className="px-5 py-3 text-right font-black" scope="col">
                      Chi tiết
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {channelItems.map((channel) => (
                    <tr className="text-slate-700" key={channel.id}>
                      <td className="px-5 py-4">
                        <p
                          className="max-w-xs truncate font-bold text-slate-950"
                          title={channel.title}
                        >
                          {channel.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {channel.handle ?? channel.youtubeChannelId}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right font-black tabular-nums">
                        {channel.subscriberCount === null ? (
                          <span
                            className="inline-flex flex-col items-end"
                            title="Chưa đọc được số người đăng ký công khai; 0 là giá trị hiển thị tạm, không phải dữ liệu đã xác minh."
                          >
                            <span>0*</span>
                            <span className="text-[10px] font-medium text-amber-700">
                              chưa xác minh
                            </span>
                          </span>
                        ) : (
                          formatNumber(channel.subscriberCount)
                        )}
                      </td>
                      <td className="px-4 py-4 text-right font-black tabular-nums">
                        {formatNumber(channel.lifetimeViewCount)}
                      </td>
                      <td className="px-4 py-4 text-right font-black tabular-nums">
                        {formatNumber(channel.videoCount)}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500">
                        {freshness(channel.lastChannelScanAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          className="font-bold text-sky-700 underline"
                          href={`/channels/${channel.id}`}
                        >
                          Phân tích 30 ngày
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Chưa có kênh để tạo bảng chỉ số.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="video-insights-title">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Video pulse</p>
            <h2 id="video-insights-title" className="mt-1 text-2xl font-black text-slate-950">
              Hiệu suất video
            </h2>
          </div>
          <Link className="text-sm font-bold text-sky-700 underline" href="/videos">
            Mở bảng rankings
          </Link>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <SnapshotBarChart
            title="Lượt xem của video mới"
            description="So sánh current views của 6 video được phát hiện gần nhất."
            items={recentViewChart}
            emptyMessage={
              recentFailed ? "Không thể tải snapshot video mới." : "Chưa có video snapshot thật."
            }
            tone="sky"
            loading={loading}
          />
          <SnapshotBarChart
            title="Tăng trưởng 7 ngày"
            description="Weekly gain từ baseline thật; giá trị âm được đánh dấu màu hổ phách."
            items={weeklyGainChart}
            emptyMessage={
              weeklyFailed
                ? "Không thể tải bảng tăng trưởng 7 ngày."
                : "Chưa đủ baseline 7 ngày để xếp hạng."
            }
            tone="emerald"
            loading={loading}
            signed
          />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="surface-card" aria-labelledby="coverage-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Data readiness</p>
              <h2 id="coverage-title" className="mt-1 text-xl font-black text-slate-950">
                Độ phủ dữ liệu
              </h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {channelsFailed ? "Không khả dụng" : `${channelItems.length} nguồn đã tải`}
            </span>
          </div>
          {loading ? (
            <p className="mt-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
              Đang tải độ phủ dữ liệu…
            </p>
          ) : channelsFailed ? (
            <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              Không thể tải độ phủ kênh. Các vùng dữ liệu khác vẫn hoạt động độc lập.
            </p>
          ) : (
            <div className="mt-6 space-y-5">
              <CoverageRow
                label="Người đăng ký"
                known={subscriberSummary.known}
                total={channelItems.length}
              />
              <CoverageRow
                label="Lượt xem trọn đời"
                known={lifetimeViewSummary.known}
                total={channelItems.length}
              />
              <CoverageRow
                label="Số lượng video"
                known={videoSummary.known}
                total={channelItems.length}
              />
            </div>
          )}
          {!hasCompleteChannelCoverage && channels ? (
            <p className="mt-5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Dashboard mới tải {channelItems.length}/{channels.total} kênh; các tổng KPI được ẩn để
              tránh gây hiểu nhầm.
            </p>
          ) : null}
        </article>

        <article className="surface-card" aria-labelledby="system-health-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Runtime</p>
              <h2 id="system-health-title" className="mt-1 text-xl font-black text-slate-950">
                Tình trạng hệ thống
              </h2>
            </div>
            {health ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                ADMIN live check
              </span>
            ) : null}
          </div>
          {health ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {Object.entries(health.checks).map(([name, check]) => (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={name}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-700">{name}</p>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${check.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}`}
                      aria-label={check.status === "ok" ? "Sẵn sàng" : "Cần chú ý"}
                    />
                  </div>
                  <p
                    className={`mt-2 text-sm font-black ${check.status === "ok" ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {check.status === "ok" ? "Sẵn sàng" : check.status}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{check.code ?? "Không có cảnh báo"}</p>
                </div>
              ))}
            </div>
          ) : supplementalLoading && isAdmin ? (
            <p
              className="mt-5 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800"
              role="status"
            >
              Đang kiểm tra tình trạng hệ thống…
            </p>
          ) : healthUnavailable && isAdmin ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm font-bold text-amber-900">
                Health check tạm thời không khả dụng
              </p>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                Metric kênh và video vẫn được giữ nguyên; hãy thử tải lại để kiểm tra hạ tầng.
              </p>
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <p className="text-sm font-bold text-slate-700">Health check dành cho ADMIN</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Tài khoản VIEWER vẫn xem được metric canonical nhưng không truy cập trạng thái hạ
                tầng.
              </p>
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="surface-card">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Discovery feed</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Video mới phát hiện</h2>
            </div>
            <Link className="text-sm font-bold text-sky-700 underline" href="/videos">
              Xem tất cả
            </Link>
          </div>
          {recent?.items.length ? (
            <ul className="mt-5 divide-y divide-slate-100">
              {recent.items.slice(0, 4).map((video) => (
                <li className="flex gap-4 py-4 first:pt-0 last:pb-0" key={video.id}>
                  {video.thumbnail ? (
                    <img
                      className="h-14 w-24 shrink-0 rounded-xl object-cover"
                      src={video.thumbnail}
                      alt=""
                    />
                  ) : (
                    <div className="grid h-14 w-24 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500">
                      YouTube
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      className="line-clamp-2 font-bold text-slate-900 hover:text-sky-700"
                      href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeVideoId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {video.title ?? video.youtubeVideoId}
                    </a>
                    <p className="mt-1 text-xs text-slate-500">
                      {video.channelTitle} · {freshness(video.publishedAt)}
                    </p>
                  </div>
                  <p className="hidden shrink-0 text-right text-sm font-black tabular-nums text-slate-700 sm:block">
                    {formatNumber(video.currentViews)}
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">views</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <p className="mt-5 text-sm font-semibold text-sky-800" role="status">
              Đang tải feed video mới…
            </p>
          ) : (
            <p className="mt-5 text-sm text-slate-500">
              {recentFailed
                ? "Không thể tải feed video mới; các metric khác vẫn được giữ nguyên."
                : "Chưa phát hiện video mới để tạo feed."}
            </p>
          )}
        </article>

        <article className="surface-card" aria-label="Báo cáo AI">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Analysis layer</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Báo cáo AI</h2>
            </div>
            <Link className="text-sm font-bold text-sky-700 underline" href="/settings/ai">
              Cài đặt
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {supplementalLoading ? (
              <p
                className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800"
                role="status"
              >
                Đang kiểm tra báo cáo AI…
              </p>
            ) : null}
            {reports.map((report) => (
              <article
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                key={report.kind}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-700">
                    {report.kind === "DAILY" ? "Báo cáo ngày" : "Báo cáo tuần"}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.available ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}
                  >
                    {report.available ? "Sẵn sàng" : "Chưa có"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">{report.reportDate}</p>
                {report.available ? (
                  <AiReportContent kind={report.kind} report={report.report} />
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-600">
                      Chưa có báo cáo an toàn cho kỳ này.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Worker sẽ tạo báo cáo sau khi metric có đủ nguồn và độ phủ.
                    </p>
                  </div>
                )}
              </article>
            ))}
            {reportsUnavailable ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Không tải được một phần báo cáo AI. Dữ liệu canonical không bị ảnh hưởng.
              </p>
            ) : null}
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            AI chỉ phân tích trên metric canonical và không thay thế dữ liệu gốc.
          </p>
        </article>
      </section>
    </div>
  );
}
