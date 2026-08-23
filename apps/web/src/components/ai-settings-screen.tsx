"use client";

import { useEffect, useState, type FormEvent } from "react";

import { getVietnameseApiMessage, getAiStatus, updateAiSettings } from "../lib/api-client";
import type { AiStatusResponse } from "@yt-monitor/shared/browser-auth";

export function AiSettingsScreen() {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPending(true);
    setError(null);
    try {
      const result = await getAiStatus();
      setStatus(result);
      const gemini = result.providers.find((provider) => provider.provider === "GEMINI");
      setEnabled(gemini?.enabled ?? true);
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await updateAiSettings({
        provider: "GEMINI",
        isEnabled: enabled,
        ...(apiKey ? { apiKey } : {}),
      });
      setStatus(result);
      setApiKey("");
      setMessage("Đã lưu cài đặt. Khóa API chỉ được lưu dạng mã hóa.");
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  const gemini = status?.providers.find((provider) => provider.provider === "GEMINI");
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="eyebrow">Phase 6 · Structured AI</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Cài đặt AI</h1>
        <p className="mt-3 text-slate-600">
          AI chỉ đọc aggregate JSON và không phải nguồn dữ liệu canonical.
        </p>
      </header>
      {pending ? (
        <p className="text-sm text-slate-600">Đang kiểm tra trạng thái nhà cung cấp…</p>
      ) : null}
      {error ? (
        <p className="alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="alert-success" role="status">
          {message}
        </p>
      ) : null}
      <section className="surface-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">Gemini</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Phân loại và báo cáo có cấu trúc
            </h2>
          </div>
          <span
            className={
              gemini?.status === "HEALTHY"
                ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700"
                : "rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700"
            }
          >
            {gemini?.status ?? "DISABLED"}
          </span>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          {gemini?.apiKeyMasked ? `Đã cấu hình ${gemini.apiKeyMasked}` : "Chưa cấu hình khóa API"}
        </p>
        <form className="mt-6 grid gap-5" onSubmit={(event) => void save(event)}>
          <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Cho phép AI analysis
          </label>
          <label className="field-label">
            Gemini API key (nhập mới để thay thế)
            <input
              className="field-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              placeholder="AIza…"
            />
          </label>
          <button className="button-primary justify-self-start" type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu cài đặt"}
          </button>
        </form>
      </section>
      <p className="text-sm leading-6 text-slate-500">
        Nếu Gemini lỗi hoặc bị giới hạn, dashboard dữ liệu, rankings và health vẫn tiếp tục hoạt
        động; chỉ phần phân tích hiển thị “AI analysis unavailable”.
      </p>
    </div>
  );
}
