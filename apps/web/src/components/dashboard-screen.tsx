"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  getAiReport,
  getHealth,
  getVietnameseApiMessage,
  listChannels,
  listRecentVideos,
  listWeeklyVideoRanking,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

function formatNumber(value: string | null | undefined): string {
  if (!value) return "—";
  return Number(value).toLocaleString("vi-VN");
}

function freshness(value: string | null | undefined): string {
  if (!value) return "Chưa có snapshot";
  return `Cập nhật ${new Date(value).toLocaleString("vi-VN")}`;
}

export function DashboardScreen() {
  const auth = useAuth();
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listChannels>> | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof listRecentVideos>> | null>(null);
  const [weekly, setWeekly] = useState<Awaited<ReturnType<typeof listWeeklyVideoRanking>> | null>(
    null,
  );
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [reports, setReports] = useState<Awaited<ReturnType<typeof getAiReport>>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    const healthRequest =
      auth.state.status === "authenticated" && auth.state.user.role === "ADMIN"
        ? getHealth()
        : Promise.resolve(null);
    const reportDate = new Date().toISOString().slice(0, 10);
    void Promise.all([
      listChannels({ page: 1, pageSize: 100, signal: controller.signal }),
      listRecentVideos({ page: 1, pageSize: 6, signal: controller.signal }),
      listWeeklyVideoRanking({ page: 1, pageSize: 5, signal: controller.signal }),
      healthRequest,
      getAiReport("daily", reportDate),
      getAiReport("weekly", reportDate),
    ])
      .then(([channelPage, recentPage, weeklyPage, healthResult, dailyReport, weeklyReport]) => {
        if (!mounted.current) return;
        setChannels(channelPage);
        setRecent(recentPage);
        setWeekly(weeklyPage);
        setHealth(healthResult);
        setReports([dailyReport, weeklyReport]);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        if (mounted.current) setError(getVietnameseApiMessage(reason));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [auth]);

  const hasCompleteChannelCoverage = channels ? channels.items.length >= channels.total : false;
  const enabledChannels = hasCompleteChannelCoverage
    ? (channels?.items.filter((channel) => channel.isEnabled).length ?? 0)
    : null;
  const activeChannels = hasCompleteChannelCoverage
    ? (channels?.items.filter((channel) => channel.availabilityStatus === "ACTIVE").length ?? 0)
    : null;
  const videos = hasCompleteChannelCoverage
    ? (channels?.items.reduce((sum, channel) => sum + Number(channel.videoCount ?? 0), 0) ?? 0)
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Phase 8 · Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Tổng quan giám sát
          </h1>
          <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-600">
            Một màn hình cho độ phủ kênh, video mới, ranking và trạng thái dịch vụ. Số liệu thiếu
            vẫn hiển thị là thiếu, không được thay bằng dữ liệu giả.
          </p>
        </div>
        <Link className="button-secondary" href="/channels">
          Quản lý kênh
        </Link>
      </header>

      {error ? (
        <p className="alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-slate-500">Đang tải dashboard…</p> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tóm tắt">
        {[
          [
            "Kênh đang theo dõi",
            `${enabledChannels === null ? "—" : enabledChannels}/${channels?.total ?? "—"}`,
            hasCompleteChannelCoverage ? "Nguồn canonical" : "Cần phân trang đầy đủ",
          ],
          [
            "Kênh đang hoạt động",
            activeChannels === null ? "—" : String(activeChannels),
            "Availability hiện tại",
          ],
          ["Video đã biết", videos === null ? "—" : formatNumber(String(videos)), "Metadata thật"],
          ["Top tuần", String(weekly?.items.length ?? "—"), "Rolling 7 ngày"],
        ].map(([label, value, hint]) => (
          <article className="surface-card" key={label}>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
            <p className="mt-2 text-xs text-slate-500">{hint}</p>
          </article>
        ))}
      </section>

      {health ? (
        <section className="surface-card" aria-label="Trạng thái dịch vụ">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-950">Trạng thái dịch vụ</h2>
            <span className="badge-neutral">ADMIN</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(health.checks).map(([name, check]) => (
              <div className="rounded-xl border border-slate-200 p-3" key={name}>
                <p className="text-sm font-semibold text-slate-700">{name}</p>
                <p
                  className={
                    check.status === "ok" ? "mt-1 text-emerald-700" : "mt-1 text-amber-700"
                  }
                >
                  {check.status}
                </p>
                <p className="mt-1 text-xs text-slate-500">{check.code ?? "Sẵn sàng"}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-2">
        <section className="surface-card">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-950">Video mới phát hiện</h2>
            <Link className="text-sm text-sky-700 underline" href="/videos">
              Xem tất cả
            </Link>
          </div>
          {recent?.items.length ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {recent.items.map((video) => (
                <li className="flex gap-3 py-3 first:pt-0 last:pb-0" key={video.id}>
                  {video.thumbnail ? (
                    <img
                      className="h-12 w-20 rounded-lg object-cover"
                      src={video.thumbnail}
                      alt=""
                    />
                  ) : null}
                  <div className="min-w-0">
                    <a
                      className="line-clamp-2 font-semibold text-slate-900 hover:text-sky-700"
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
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Chưa có video snapshot thật.</p>
          )}
        </section>

        <section className="surface-card">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-950">Top 10 tuần</h2>
            <Link className="text-sm text-sky-700 underline" href="/videos">
              Ranking chi tiết
            </Link>
          </div>
          {weekly?.items.length ? (
            <ol className="mt-4 divide-y divide-slate-100">
              {weekly.items.map((video) => (
                <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0" key={video.id}>
                  <span className="w-6 text-lg font-black text-slate-300">{video.rank}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">
                    {video.title ?? video.youtubeVideoId}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {video.weeklyGain ?? "—"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Chưa đủ baseline 7 ngày để xếp hạng.</p>
          )}
        </section>
      </section>
      <section className="surface-card" aria-label="Báo cáo AI">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-950">Báo cáo AI</h2>
          <Link className="text-sm text-sky-700 underline" href="/settings/ai">
            Cài đặt provider
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {reports.map((report) => (
            <article className="rounded-xl border border-slate-200 p-4" key={report.kind}>
              <p className="text-sm font-semibold text-slate-700">
                {report.kind === "DAILY" ? "Daily report" : "Weekly report"}
              </p>
              <p className="mt-2 text-sm text-slate-600">{report.reportDate}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {report.available ? "Đã có report có cấu trúc" : "Chưa có report cho ngày này"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                AI là lớp phân tích; không thay thế metric canonical.
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
