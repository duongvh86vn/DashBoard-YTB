"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  archiveChannel,
  createChannel,
  getVietnameseApiMessage,
  listChannels,
  updateChannelMonetization,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

function subscriberLabel(channel: {
  subscriberCount: string | null;
  lastChannelScanAt: string | null;
}): string {
  if (channel.subscriberCount !== null) return channel.subscriberCount;
  return "0";
}

function subscriberTitle(channel: {
  subscriberCount: string | null;
  lastChannelScanAt: string | null;
}): string | undefined {
  if (channel.subscriberCount !== null) return undefined;
  return channel.lastChannelScanAt === null
    ? "Số người đăng ký chưa được thu thập; 0 là giá trị hiển thị tạm."
    : "Số người đăng ký không đọc được công khai; 0 là giá trị hiển thị tạm.";
}

type ChannelItem = Awaited<ReturnType<typeof listChannels>>["items"][number];

function monetizationLabel(channel: ChannelItem): string {
  switch (channel.monetization?.status) {
    case "ENABLED":
      return "Đã bật kiếm tiền";
    case "DISABLED":
      return "Chưa bật kiếm tiền";
    default:
      return "Chưa cấu hình kiếm tiền";
  }
}

function todayInApplicationTimeZone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ChannelMonetization({
  channel,
  isAdmin,
  onSaved,
  onError,
}: {
  channel: ChannelItem;
  isAdmin: boolean;
  onSaved: (channel: ChannelItem) => void;
  onError: (error: unknown) => void;
}) {
  const today = todayInApplicationTimeZone();
  const [status, setStatus] = useState<"UNCONFIGURED" | "DISABLED" | "ENABLED">(
    channel.monetization?.status ?? "UNCONFIGURED",
  );
  const [rpmUsd, setRpmUsd] = useState(channel.monetization?.rpmUsd ?? "");
  // A review should create this week's effective-dated row by default instead
  // of silently overwriting the date of the previous review.
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "UNCONFIGURED") return;
    setPending(true);
    setSaved(false);
    try {
      const updated = await updateChannelMonetization(channel.id, {
        isMonetized: status === "ENABLED",
        rpmUsd: status === "ENABLED" ? rpmUsd : null,
        effectiveDate,
      });
      onSaved(updated);
      setStatus(updated.monetization?.status ?? "UNCONFIGURED");
      setRpmUsd(updated.monetization?.rpmUsd ?? "");
      setEffectiveDate(updated.monetization?.effectiveDate ?? effectiveDate);
      setSaved(true);
    } catch (reason) {
      onError(reason);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-800">{monetizationLabel(channel)}</p>
        {channel.monetization?.status === "ENABLED" ? (
          <p className="text-sm font-bold tabular-nums text-emerald-700">
            RPM hiện tại: {channel.monetization.rpmUsd} USD
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {channel.monetization?.effectiveDate
          ? `Hiệu lực từ ${channel.monetization.effectiveDate} · cập nhật thủ công`
          : "Chưa có quyết định quản lý; kênh này không xuất hiện trong bảng doanh thu."}
      </p>
      {isAdmin ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          <label className="text-xs font-bold text-slate-600">
            Trạng thái
            <select
              className="input mt-1"
              aria-label={`Trạng thái kiếm tiền của ${channel.title}`}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setSaved(false);
              }}
            >
              <option value="UNCONFIGURED" disabled>
                Chưa cấu hình
              </option>
              <option value="DISABLED">Chưa bật kiếm tiền</option>
              <option value="ENABLED">Đã bật kiếm tiền</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Ngày hiệu lực
            <input
              className="input mt-1"
              type="date"
              max={today}
              value={effectiveDate}
              onChange={(event) => {
                setEffectiveDate(event.target.value);
                setSaved(false);
              }}
              required
            />
          </label>
          {status === "ENABLED" ? (
            <label className="text-xs font-bold text-slate-600 sm:col-span-2">
              RPM USD
              <input
                className="input mt-1"
                type="number"
                min="0"
                step="0.000001"
                value={rpmUsd}
                onChange={(event) => {
                  setRpmUsd(event.target.value);
                  setSaved(false);
                }}
                required
              />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              className="button-primary"
              type="submit"
              disabled={
                pending ||
                status === "UNCONFIGURED" ||
                effectiveDate === "" ||
                (status === "ENABLED" && rpmUsd === "")
              }
            >
              {pending ? "Đang lưu…" : "Lưu kiếm tiền"}
            </button>
            {saved ? (
              <span className="text-xs font-bold text-emerald-700" role="status">
                Đã cập nhật RPM thủ công.
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
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

  function updateSavedChannel(channel: ChannelItem) {
    setItems((current) => current.map((item) => (item.id === channel.id ? channel : item)));
    setError(null);
  }

  function handleMonetizationError(reason: unknown) {
    if (auth.handleApiError(reason)) return;
    setError(getVietnameseApiMessage(reason, "channels"));
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
                <dd
                  className="mt-1 break-words font-semibold text-slate-900"
                  title={subscriberTitle(channel)}
                >
                  {subscriberLabel(channel)}
                  {channel.subscriberCount === null ? (
                    <span className="mt-1 block text-[10px] font-medium text-amber-700">
                      chưa có dữ liệu
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Video</dt>
                <dd
                  className="mt-1 font-semibold text-slate-900"
                  title={
                    channel.videoCount === null
                      ? "Số video chưa có dữ liệu; 0 là giá trị hiển thị tạm."
                      : undefined
                  }
                >
                  {channel.videoCount ?? "0"}
                  {channel.videoCount === null ? (
                    <span className="mt-1 block text-[10px] font-medium text-amber-700">
                      chưa có dữ liệu
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Hoạt động</dt>
                <dd className="mt-1 font-semibold text-slate-900">{channel.activityStatus}</dd>
              </div>
            </dl>
            <ChannelMonetization
              channel={channel}
              isAdmin={auth.state.status === "authenticated" && auth.state.user.role === "ADMIN"}
              onSaved={updateSavedChannel}
              onError={handleMonetizationError}
            />
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
        Chỉ số thiếu được hiển thị 0 để dễ đọc; dữ liệu gốc vẫn là NULL và không có backfill giả.
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
