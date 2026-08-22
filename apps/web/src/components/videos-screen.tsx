"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { getVietnameseApiMessage, listChannelVideos } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

export function VideosScreen({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const [items, setItems] = useState<Awaited<ReturnType<typeof listChannelVideos>>["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    void listChannelVideos({ channelId, page: 1, pageSize: 100, signal: controller.signal })
      .then((page) => {
        if (mounted.current) {
          setItems(page.items);
          setError(null);
        }
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
  }, [auth, channelId]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <Link className="text-sm text-sky-700 underline" href="/channels">
          ← Kênh theo dõi
        </Link>
        <p className="eyebrow mt-6">Phase 4 · Video discovery</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Video monitor</h1>
        <p className="mt-3 text-slate-600">
          Danh sách video phát hiện từ RSS/yt-dlp và các metric snapshot thực tế.
        </p>
      </header>
      {error ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-slate-500">Đang tải video…</p> : null}
      {!loading && items.length === 0 ? (
        <section className="surface-card">
          <h2 className="text-xl font-bold text-slate-950">Chưa có video</h2>
          <p className="mt-2 text-slate-600">
            Worker sẽ phát hiện video ở lần RSS/yt-dlp scan kế tiếp.
          </p>
        </section>
      ) : null}
      <section className="grid gap-5 md:grid-cols-2" aria-label="Danh sách video">
        {items.map((video) => (
          <article className="surface-card" key={video.id}>
            <div className="flex gap-4">
              {video.thumbnail ? (
                <img className="h-20 w-32 rounded-lg object-cover" src={video.thumbnail} alt="" />
              ) : null}
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-slate-950">{video.title ?? video.youtubeVideoId}</h2>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                  {video.monitorTier}
                </p>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Views</dt>
                <dd className="font-semibold">{video.currentViews ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Likes</dt>
                <dd className="font-semibold">{video.currentLikes ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Comments</dt>
                <dd className="font-semibold">{video.currentComments ?? "—"}</dd>
              </div>
            </dl>
            <a
              className="mt-4 inline-block text-sm text-sky-700 underline"
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeVideoId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Mở trên YouTube
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
