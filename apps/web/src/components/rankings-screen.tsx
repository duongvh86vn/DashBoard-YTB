"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  getVietnameseApiMessage,
  listBreakoutVideoRanking,
  listHotVideoRanking,
  listWeeklyVideoRanking,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

type RankingPage = Awaited<ReturnType<typeof listWeeklyVideoRanking>>;

function RankingTable({
  title,
  items,
  metric,
}: {
  title: string;
  items: RankingPage["items"];
  metric: "weekly" | "hot" | "breakout";
}) {
  return (
    <section className="surface-card">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-950">{title}</h2>
        <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
          {items.length} kết quả
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">Chưa đủ snapshot thật để xếp hạng.</p>
      ) : (
        <ol className="mt-5 divide-y divide-slate-100">
          {items.map((item) => (
            <li className="flex gap-4 py-4 first:pt-0 last:pb-0" key={item.id}>
              <span className="w-7 pt-1 text-lg font-black text-slate-300">{item.rank}</span>
              {item.thumbnail ? (
                <img className="h-14 w-24 rounded-lg object-cover" src={item.thumbnail} alt="" />
              ) : null}
              <div className="min-w-0 flex-1">
                <a
                  className="font-semibold text-slate-950 hover:text-sky-700"
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.youtubeVideoId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title ?? item.youtubeVideoId}
                </a>
                <p className="mt-1 text-xs text-slate-500">{item.channelTitle}</p>
              </div>
              <div className="shrink-0 text-right text-sm">
                {metric === "weekly" ? (
                  <p className="font-bold text-slate-950">{item.weeklyGain ?? "—"} views</p>
                ) : null}
                {metric === "hot" ? (
                  <p className="font-bold text-slate-950">
                    {item.smoothedVph?.toFixed(0) ?? "—"} VPH
                  </p>
                ) : null}
                {metric === "breakout" ? (
                  <p className="font-bold text-slate-950">{item.breakout48h?.toFixed(2) ?? "—"}×</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">{item.currentViews ?? "—"} views</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RankingsScreen() {
  const auth = useAuth();
  const [weekly, setWeekly] = useState<RankingPage | null>(null);
  const [hot, setHot] = useState<RankingPage | null>(null);
  const [breakout, setBreakout] = useState<RankingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    void Promise.all([
      listWeeklyVideoRanking({ page: 1, pageSize: 10, signal: controller.signal }),
      listHotVideoRanking({ page: 1, pageSize: 10, signal: controller.signal }),
      listBreakoutVideoRanking({ page: 1, pageSize: 10, signal: controller.signal }),
    ])
      .then(([weeklyPage, hotPage, breakoutPage]) => {
        if (!mounted.current) return;
        setWeekly(weeklyPage);
        setHot(hotPage);
        setBreakout(breakoutPage);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        if (mounted.current) setError(getVietnameseApiMessage(reason, "channels"));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [auth]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Phase 5 · Deterministic analytics</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Video rankings
          </h1>
          <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-600">
            Ba bảng độc lập: views tăng trong 7 ngày, tốc độ hiện tại và breakout so với cùng kênh.
          </p>
        </div>
        <Link className="button-secondary" href="/channels">
          Kênh theo dõi
        </Link>
      </header>
      {error ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-slate-500">Đang tính ranking từ snapshot…</p> : null}
      {!loading && weekly?.warmingUpCount ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {weekly.warmingUpCount} video đang WARMING_UP vì chưa có baseline đủ 7 ngày.
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-3">
        <RankingTable title="Top 10 tuần" items={weekly?.items ?? []} metric="weekly" />
        <RankingTable title="Hot Now" items={hot?.items ?? []} metric="hot" />
        <RankingTable title="Breakout" items={breakout?.items ?? []} metric="breakout" />
      </section>
    </div>
  );
}
