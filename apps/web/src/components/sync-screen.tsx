"use client";

import { useEffect, useState } from "react";

import { getVietnameseApiMessage, listSyncRuns } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

const PAGE_SIZE = 20;

export function SyncScreen() {
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof listSyncRuns>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listSyncRuns({ page, pageSize: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        setError(getVietnameseApiMessage(reason));
      });
    return () => controller.abort();
  }, [auth, page]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <p className="eyebrow">J017 · Sync center</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Lịch sử đồng bộ</h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          Theo dõi hàng đợi health và các lượt đồng bộ do Worker thực hiện. Lỗi upstream không được
          biến thành dữ liệu canonical giả.
        </p>
      </header>
      {error ? (
        <p className="alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className="text-slate-500">Đang tải lịch sử đồng bộ…</p> : null}
      {data?.items.length === 0 ? (
        <section className="surface-card text-slate-600">Chưa có sync run.</section>
      ) : null}
      {data && data.items.length > 0 ? (
        <section className="surface-card overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Thời điểm</th>
                <th className="px-3 py-3">Job</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Records</th>
                <th className="px-3 py-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((run) => (
                <tr className="border-b border-slate-100 last:border-0" key={run.id}>
                  <td className="px-3 py-3 text-slate-600">
                    {new Date(run.createdAt).toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-3 font-semibold">{run.jobType}</td>
                  <td className="px-3 py-3">
                    <span
                      className={run.status === "COMPLETED" ? "text-emerald-700" : "text-amber-700"}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">{run.recordsProcessed ?? "—"}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {run.errorMessageSafe ?? run.errorCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {data && data.total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between gap-4" aria-label="Phân trang sync runs">
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value - 1)}
            disabled={page === 1}
          >
            Trang trước
          </button>
          <span className="text-sm text-slate-500">
            Trang {page} · {data.total} lượt
          </span>
          <button
            className="button-secondary"
            type="button"
            onClick={() => setPage((value) => value + 1)}
            disabled={page * PAGE_SIZE >= data.total}
          >
            Trang sau
          </button>
        </nav>
      ) : null}
    </div>
  );
}
