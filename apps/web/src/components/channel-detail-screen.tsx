"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  classifyChannel,
  getChannel,
  getChannelPublicIntelligence,
  getVietnameseApiMessage,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";
import { ChannelClassificationCard } from "./channel-classification-card";
import { PublicIntelligencePanel } from "./public-intelligence-panel";

export function ChannelDetailScreen({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const [channel, setChannel] = useState<Awaited<ReturnType<typeof getChannel>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [classification, setClassification] = useState<unknown>(null);
  const [intelligence, setIntelligence] = useState<Awaited<
    ReturnType<typeof getChannelPublicIntelligence>
  > | null>(null);
  const [intelligenceFailed, setIntelligenceFailed] = useState(false);

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
    void getChannelPublicIntelligence(channelId, 30, controller.signal)
      .then((result) => setIntelligence(result))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        setIntelligenceFailed(true);
      });
    return () => controller.abort();
  }, [auth, channelId]);

  async function analyze() {
    setPending(true);
    setMessage(null);
    try {
      const result = await classifyChannel(channelId);
      setClassification(result);
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
      <section className="surface-card" aria-label="Thông tin kênh">
        <p className="text-sm font-semibold text-slate-500">Trạng thái hoạt động</p>
        <p className="mt-2 text-2xl font-black text-slate-950">{channel.activityStatus ?? "—"}</p>
      </section>
      {intelligence ? (
        <PublicIntelligencePanel data={intelligence} />
      ) : (
        <section className="surface-card" aria-labelledby="public-current-unavailable-title">
          <h2 id="public-current-unavailable-title" className="text-xl font-bold text-slate-950">
            Số liệu công khai hiện tại
          </h2>
          <p className="mt-3 text-sm leading-6 text-amber-800">
            {intelligenceFailed
              ? "Số liệu công khai hiện tại chưa khả dụng; không dùng bộ đếm cũ của hồ sơ kênh để thay thế."
              : "Đang tải số liệu công khai hiện tại có trạng thái và nguồn rõ ràng…"}
          </p>
        </section>
      )}
      {classification ? <ChannelClassificationCard result={classification} /> : null}
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
