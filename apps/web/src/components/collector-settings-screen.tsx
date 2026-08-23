"use client";

import { useEffect, useState } from "react";

import { getHealth, getVietnameseApiMessage } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

export function CollectorSettingsScreen() {
  const auth = useAuth();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getHealth()
      .then(setHealth)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (auth.handleApiError(reason)) return;
        setError(getVietnameseApiMessage(reason));
      });
    return () => controller.abort();
  }, [auth]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="eyebrow">J020 · Collector settings</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          Cài đặt collectors
        </h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          Collector chạy trong Worker và nhận cấu hình qua môi trường triển khai. Màn hình này hiển
          thị health/config boundary; không cho phép sửa trực tiếp secret hoặc topology từ trình
          duyệt.
        </p>
      </header>
      {error ? (
        <p className="alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="surface-card">
        <h2 className="text-xl font-bold text-slate-950">Runtime checks</h2>
        {!health ? <p className="mt-4 text-slate-500">Đang tải trạng thái…</p> : null}
        {health ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Object.entries(health.checks).map(([name, check]) => (
              <article className="rounded-xl border border-slate-200 p-4" key={name}>
                <h3 className="font-semibold text-slate-900">{name}</h3>
                <p className="mt-2 text-sm text-slate-600">{check.status}</p>
                <p className="mt-1 text-xs text-slate-500">{check.code ?? "Không có cảnh báo"}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <section className="surface-card text-sm leading-6 text-slate-600">
        <h2 className="text-xl font-bold text-slate-950">Các invariant vận hành</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          <li>RSS là nguồn phát hiện thường xuyên; yt-dlp chỉ chạy metadata/statistics.</li>
          <li>Playwright public health không lưu full HTML, cookie hoặc storage state.</li>
          <li>AI outage không dừng collector và không ghi metric raw.</li>
        </ul>
      </section>
    </div>
  );
}
