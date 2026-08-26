"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  archiveChannel,
  createChannel,
  getVietnameseApiMessage,
  listChannels,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

function subscriberLabel(channel: {
  subscriberCount: string | null;
  lastChannelScanAt: string | null;
}): string {
  if (channel.subscriberCount !== null) return channel.subscriberCount;
  return channel.lastChannelScanAt === null ? "Chưa thu thập" : "Không đọc được công khai";
}

export function ChannelsScreen() {
  const PAGE_SIZE = 20;
  const auth = useAuth();
  const [items, setItems] = useState<Awaited<ReturnType<typeof listChannels>>["items"]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  async function refresh(signal?: AbortSignal) {
    try {
      const result = await listChannels({
        page,
        pageSize: PAGE_SIZE,
        ...(signal ? { signal } : {}),
      });
      if (mounted.current) {
        setItems(result.items);
        setTotal(result.total);
        setError(null);
      }
    } catch (reason) {
      if (signal?.aborted) return;
      if (auth.handleApiError(reason)) return;
      if (mounted.current) setError(getVietnameseApiMessage(reason, "channels"));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    mounted.current = true;
    void refresh(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [page]);

  async function archive(id: string) {
    setPending(true);
    setError(null);
    try {
      await archiveChannel(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (reason) {
      if (auth.handleApiError(reason)) return;
      setError(getVietnameseApiMessage(reason, "channels"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Phase 2 · Nguồn công khai</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Kênh theo dõi
          </h1>
          <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-600">
            Thêm kênh bằng URL hoặc @handle. Hệ thống chỉ lưu kênh sau khi xác minh được ID YouTube
            chuẩn.
          </p>
        </div>
        {auth.state.status === "authenticated" && auth.state.user.role === "ADMIN" ? (
          <Link className="button-primary" href="/channels/new">
            Thêm kênh
          </Link>
        ) : null}
      </header>

      {error ? (
        <p
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-slate-500">Đang tải danh sách kênh…</p> : null}
      {!loading && items.length === 0 ? (
        <section className="surface-card text-center">
          <h2 className="text-xl font-bold text-slate-950">Chưa có kênh nào</h2>
          <p className="mt-2 text-slate-600">
            ADMIN có thể thêm kênh đầu tiên để bắt đầu tạo lịch sử thật.
          </p>
        </section>
      ) : null}
      <section className="grid gap-5 md:grid-cols-2" aria-label="Danh sách kênh">
        {items.map((channel) => (
          <article className="surface-card" key={channel.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {channel.handle ?? channel.youtubeChannelId}
                </p>
                <h2 className="mt-2 truncate text-xl font-bold text-slate-950">{channel.title}</h2>
                <a
                  className="mt-2 block truncate text-sm text-sky-700 underline"
                  href={channel.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {channel.canonicalUrl}
                </a>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {channel.availabilityStatus}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Người đăng ký</dt>
                <dd className="mt-1 break-words font-semibold text-slate-900">
                  {subscriberLabel(channel)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Video</dt>
                <dd className="mt-1 font-semibold text-slate-900">{channel.videoCount ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Hoạt động</dt>
                <dd className="mt-1 font-semibold text-slate-900">{channel.activityStatus}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link className="button-secondary" href={`/channels/${channel.id}`}>
                Chi tiết
              </Link>
              <Link className="button-secondary" href={`/channels/${channel.id}/health`}>
                Lịch sử health
              </Link>
              <Link className="button-secondary" href={`/channels/${channel.id}/videos`}>
                Video monitor
              </Link>
              {auth.state.status === "authenticated" && auth.state.user.role === "ADMIN" ? (
                <button
                  className="button-danger"
                  type="button"
                  disabled={pending}
                  onClick={() => void archive(channel.id)}
                >
                  Lưu trữ kênh
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {!loading && total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between gap-4" aria-label="Phân trang kênh">
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value - 1)}
            disabled={page === 1 || pending}
          >
            Trang trước
          </button>
          <span className="text-sm text-slate-500">
            Trang {page} · {total} kênh
          </span>
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={page * PAGE_SIZE >= total || pending}
          >
            Trang sau
          </button>
        </nav>
      ) : null}
      <p className="text-sm text-slate-500">
        Số liệu chỉ hiển thị sau snapshot công khai thành công; không có backfill giả.
      </p>
    </div>
  );
}

export function AddChannelForm() {
  const [channelUrl, setChannelUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const auth = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCreated(null);
    try {
      const channel = await createChannel(channelUrl);
      setCreated(channel.title);
      setChannelUrl("");
    } catch (reason) {
      if (auth.handleApiError(reason)) return;
      setError(getVietnameseApiMessage(reason, "channels"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="surface-card mx-auto max-w-2xl space-y-5"
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <label className="label" htmlFor="channel-url">
          URL kênh hoặc @handle
        </label>
        <input
          className="input mt-2"
          id="channel-url"
          value={channelUrl}
          onChange={(event) => setChannelUrl(event.target.value)}
          placeholder="https://www.youtube.com/@tenkenh"
          autoComplete="off"
          required
        />
      </div>
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      {created ? (
        <p className="text-sm text-emerald-700" role="status">
          Đã thêm kênh: {created}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button className="button-primary" type="submit" disabled={pending}>
          {pending ? "Đang xác minh…" : "Xác minh và thêm kênh"}
        </button>
        <Link className="button-secondary" href="/channels">
          Hủy
        </Link>
      </div>
    </form>
  );
}
