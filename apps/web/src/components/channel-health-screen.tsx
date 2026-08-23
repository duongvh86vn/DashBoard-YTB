"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  getChannelHealthHistory,
  getVietnameseApiMessage,
  requestChannelHealthCheck,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

interface ChannelHealthScreenProps {
  channelId: string;
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    ACTIVE: "Đang hoạt động",
    NOT_FOUND: "Không tìm thấy",
    DELETED_OR_TERMINATED: "Đã xoá/chấm dứt",
    UNKNOWN: "Chưa xác định",
    CHECK_FAILED: "Kiểm tra thất bại",
    TEMPORARILY_UNAVAILABLE: "Tạm thời không khả dụng",
    ARCHIVED: "Đã lưu trữ",
  };
  return labels[value] ?? value;
}

export function ChannelHealthScreen({ channelId }: ChannelHealthScreenProps) {
  const PAGE_SIZE = 20;
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof getChannelHealthHistory>
  > | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  async function refresh(signal?: AbortSignal) {
    try {
      const result = await getChannelHealthHistory({
        id: channelId,
        page,
        pageSize: PAGE_SIZE,
        ...(signal ? { signal } : {}),
      });
      if (mounted.current) {
        setHistory(result);
        setMessage(null);
      }
    } catch (reason) {
      if (signal?.aborted) return;
      if (auth.handleApiError(reason)) return;
      if (mounted.current) setMessage(getVietnameseApiMessage(reason, "channels"));
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
  }, [channelId, page]);

  async function requestCheck() {
    setPending(true);
    setMessage(null);
    try {
      await requestChannelHealthCheck(channelId);
      setMessage("Đã xếp hàng kiểm tra health. Worker sẽ ghi kết quả sau lượt chạy tiếp theo.");
    } catch (reason) {
      if (auth.handleApiError(reason)) return;
      setMessage(getVietnameseApiMessage(reason, "channels"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Phase 3 · An toàn health</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Lịch sử kiểm tra kênh
          </h1>
          <p className="mt-3 text-slate-600">
            Chỉ hiển thị evidence đã được làm sạch; không lưu HTML trang công khai.
          </p>
        </div>
        <div className="flex gap-3">
          <Link className="button-secondary" href="/channels">
            Quay lại
          </Link>
          {auth.state.status === "authenticated" && auth.state.user.role === "ADMIN" ? (
            <button
              className="button-primary"
              type="button"
              disabled={pending}
              onClick={() => void requestCheck()}
            >
              {pending ? "Đang xếp hàng…" : "Kiểm tra ngay"}
            </button>
          ) : null}
        </div>
      </div>
      {message ? (
        <p
          className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {!history ? <p className="text-slate-500">Đang tải lịch sử…</p> : null}
      {history?.items.length === 0 ? (
        <section className="surface-card text-slate-600">Chưa có lần kiểm tra nào.</section>
      ) : null}
      {history && history.items.length > 0 ? (
        <section className="surface-card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Thời điểm</th>
                <th className="px-3 py-3">Availability</th>
                <th className="px-3 py-3">Public</th>
                <th className="px-3 py-3">yt-dlp</th>
                <th className="px-3 py-3">RSS</th>
                <th className="px-3 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((check) => (
                <tr className="border-b border-slate-100 last:border-0" key={check.id}>
                  <td className="px-3 py-3 text-slate-600">
                    {new Date(check.checkedAt).toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-3 font-semibold text-slate-900">
                    {statusLabel(check.normalizedAvailability)}
                  </td>
                  <td className="px-3 py-3">{check.publicPageStatus}</td>
                  <td className="px-3 py-3">{check.ytdlpStatus}</td>
                  <td className="px-3 py-3">{check.rssStatus}</td>
                  <td className="max-w-xs px-3 py-3 text-slate-600">
                    {check.evidenceTextSafe ?? check.evidenceCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {history && history.total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between gap-4" aria-label="Phân trang health">
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value - 1)}
            disabled={page === 1 || pending}
          >
            Trang trước
          </button>
          <span className="text-sm text-slate-500">
            Trang {page} · {history.total} lần kiểm tra
          </span>
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={page * PAGE_SIZE >= history.total || pending}
          >
            Trang sau
          </button>
        </nav>
      ) : null}
    </div>
  );
}
