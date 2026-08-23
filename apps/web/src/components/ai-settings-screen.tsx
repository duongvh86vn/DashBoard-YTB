"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { AiStatusResponse } from "@yt-monitor/shared/browser-auth";

import {
  discoverAiModels,
  getAiStatus,
  getVietnameseApiMessage,
  testAiProvider,
  updateAiSettings,
} from "../lib/api-client";

type Provider = "GEMINI" | "NVIDIA";

export function AiSettingsScreen() {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [provider, setProvider] = useState<Provider>("GEMINI");
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPending(true);
    setError(null);
    try {
      const result = await getAiStatus();
      setStatus(result);
      const current = result.providers.find((item) => item.provider === provider);
      setEnabled(current?.enabled ?? true);
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
        provider,
        isEnabled: enabled,
        ...(apiKey ? { apiKey } : {}),
        ...(modelId ? { configuredModels: { ANALYSIS: modelId } } : {}),
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

  async function testSelectedProvider() {
    setTesting(true);
    setError(null);
    try {
      const result = await testAiProvider(provider);
      setMessage(`${provider}: ${result.status}${result.code ? ` (${result.code})` : ""}`);
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setTesting(false);
    }
  }

  async function refreshModels() {
    setDiscovering(true);
    setError(null);
    try {
      const result = await discoverAiModels(provider);
      setModels(result.models.map((model) => model.id));
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setDiscovering(false);
    }
  }

  const selected = status?.providers.find((item) => item.provider === provider);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="eyebrow">Phase 7 · NVIDIA + AI Router</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Cài đặt AI</h1>
        <p className="mt-3 text-slate-600">
          Chọn provider, kiểm tra health và khám phá model. AI chỉ đọc aggregate JSON và không phải
          nguồn dữ liệu canonical.
        </p>
      </header>
      {pending ? <p className="text-sm text-slate-600">Đang kiểm tra provider…</p> : null}
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
            <div className="flex gap-2">
              {(["GEMINI", "NVIDIA"] as const).map((item) => (
                <button
                  className={
                    provider === item ? "button-table bg-slate-950 text-white" : "button-table"
                  }
                  key={item}
                  type="button"
                  onClick={() => {
                    setProvider(item);
                    const current = status?.providers.find(
                      (candidate) => candidate.provider === item,
                    );
                    setEnabled(current?.enabled ?? true);
                    setModels([]);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <h2 className="mt-3 text-xl font-bold text-slate-950">Structured analysis provider</h2>
          </div>
          <span
            className={
              selected?.status === "HEALTHY"
                ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700"
                : "rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700"
            }
          >
            {selected?.status ?? "DISABLED"}
          </span>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          {selected?.apiKeyMasked
            ? `Đã cấu hình ${selected.apiKeyMasked}`
            : "Chưa cấu hình khóa API"}
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
            {provider} API key (nhập mới để thay thế)
            <input
              className="field-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              placeholder="Nhập khóa mới, không hiển thị lại"
            />
          </label>
          <label className="field-label">
            Model ID (tùy chọn, lưu vào role ANALYSIS)
            <input
              className="field-input"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="provider/model-id"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? "Đang lưu…" : "Lưu cài đặt"}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void testSelectedProvider()}
              disabled={testing}
            >
              {testing ? "Đang kiểm tra…" : "Test provider"}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void refreshModels()}
              disabled={discovering}
            >
              {discovering ? "Đang tải…" : "Refresh available models"}
            </button>
          </div>
          {models.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-700">Model IDs được provider công bố</p>
              <ul className="mt-2 grid gap-1 text-slate-600">
                {models.map((item) => (
                  <li key={item}>
                    <button
                      className="text-left underline"
                      type="button"
                      onClick={() => setModelId(item)}
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </section>
      <p className="text-sm leading-6 text-slate-500">
        Nếu Gemini bị giới hạn, router thử NVIDIA fallback theo model role đã cấu hình. Nếu tất cả
        AI lỗi, dashboard dữ liệu, rankings và health vẫn tiếp tục hoạt động.
      </p>
    </div>
  );
}
