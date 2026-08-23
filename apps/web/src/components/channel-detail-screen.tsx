"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { classifyChannel, getChannel, getVietnameseApiMessage } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

export function ChannelDetailScreen({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const [channel, setChannel] = useState<Awaited<ReturnType<typeof getChannel>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getChannel(channelId)
      .then((result) => setChannel(result))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        setMessage(getVietnameseApiMessage(reason, "channels"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [auth, channelId]);

  async function analyze() {
    setPending(true);
    setMessage(null);
    try {
      await classifyChannel(channelId);
      setMessage(
        "Đã hoàn tất phân tích có cấu trúc cho kênh; kết quả không thay đổi metric canonical.",
      );
    } catch (reason) {
      if (auth.handleApiError(reason)) return;
      setMessage(getVietnameseApiMessage(reason));
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-slate-500">Đang tải chi tiết kênh…</p>;
  if (!channel)
    return (
      <p className="alert-error" role="alert">
        {message ?? "Không tìm thấy kênh."}
      </p>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link className="text-sm text-sky-700 underline" href="/channels">
            ← Kênh theo dõi
          </Link>
          <p className="eyebrow mt-6">J005 · Channel detail</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{channel.title}</h1>
          <p className="mt-3 text-slate-600">
            {channel.handle ?? channel.youtubeChannelId} · {channel.availabilityStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="button-secondary" href={`/channels/${channel.id}/health`}>
            Health
          </Link>
          <Link className="button-secondary" href={`/channels/${channel.id}/videos`}>
            Videos
          </Link>
          {auth.state.status === "authenticated" && auth.state.user.role === "ADMIN" ? (
            <button
              className="button-primary"
              type="button"
              onClick={() => void analyze()}
              disabled={pending}
            >
              {pending ? "Đang phân tích…" : "Phân tích kênh"}
            </button>
          ) : null}
        </div>
      </header>
      {message ? (
        <p
          className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800"
          role="status"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Thông tin kênh">
        {[
          ["Subscribers", channel.subscriberCount],
          ["Videos", channel.videoCount],
          ["Lifetime views", channel.lifetimeViewCount],
          ["Hoạt động", channel.activityStatus],
        ].map(([label, value]) => (
          <article className="surface-card" key={label}>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{value ?? "—"}</p>
          </article>
        ))}
      </section>
      <section className="surface-card">
        <h2 className="text-xl font-bold text-slate-950">Freshness & provenance</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-slate-500">Last scan</dt>
            <dd className="mt-1 font-semibold">
              {channel.lastChannelScanAt
                ? new Date(channel.lastChannelScanAt).toLocaleString("vi-VN")
                : "Chưa có"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Last health</dt>
            <dd className="mt-1 font-semibold">
              {channel.lastHealthCheckAt
                ? new Date(channel.lastHealthCheckAt).toLocaleString("vi-VN")
                : "Chưa có"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Canonical URL</dt>
            <dd className="mt-1 truncate">
              <a
                className="text-sky-700 underline"
                href={channel.canonicalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Mở YouTube
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
