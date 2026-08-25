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
type ModelOption = Awaited<ReturnType<typeof discoverAiModels>>["models"][number];

const CUSTOM_MODEL = "__CUSTOM__";

function chooseModel(models: ModelOption[], savedModel: string | null | undefined) {
  if (savedModel) {
    return models.some((model) => model.id === savedModel)
      ? { choice: savedModel, customId: "" }
      : { choice: CUSTOM_MODEL, customId: savedModel };
  }

  const preferred = models.find((model) => model.recommended) ?? models[0];
  return preferred
    ? { choice: preferred.id, customId: "" }
    : { choice: CUSTOM_MODEL, customId: "" };
}

function providerName(provider: Provider) {
  return provider === "GEMINI" ? "Google Gemini" : "NVIDIA NIM";
}

function statusLabel(status: AiStatusResponse["providers"][number]["status"] | undefined) {
  switch (status) {
    case "HEALTHY":
      return "Hoạt động tốt";
    case "DEGRADED":
      return "Cần kiểm tra";
    case "UNAVAILABLE":
      return "Không khả dụng";
    default:
      return "Chưa bật";
  }
}

export function AiSettingsScreen() {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [provider, setProvider] = useState<Provider>("GEMINI");
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setPending(true);
    setDiscovering(true);
    setModels([]);
    setModelChoice("");
    setCustomModelId("");
    setMessage(null);
    setError(null);

    void Promise.allSettled([getAiStatus(), discoverAiModels(provider)]).then(
      ([statusResult, modelsResult]) => {
        if (!active) return;

        let savedModel: string | null = null;
        let firstError: unknown = null;

        if (statusResult.status === "fulfilled") {
          setStatus(statusResult.value);
          const current = statusResult.value.providers.find((item) => item.provider === provider);
          setEnabled(current?.enabled ?? true);
          savedModel = current?.model ?? null;
        } else {
          firstError = statusResult.reason;
        }

        if (modelsResult.status === "fulfilled") {
          const nextModels = modelsResult.value.models;
          const selection = chooseModel(nextModels, savedModel);
          setModels(nextModels);
          setModelChoice(selection.choice);
          setCustomModelId(selection.customId);
        } else {
          firstError ??= modelsResult.reason;
          const selection = chooseModel([], savedModel);
          setModelChoice(selection.choice);
          setCustomModelId(selection.customId);
        }

        if (firstError) setError(getVietnameseApiMessage(firstError));
        setPending(false);
        setDiscovering(false);
      },
    );

    return () => {
      active = false;
    };
  }, [provider]);

  const selected = status?.providers.find((item) => item.provider === provider);
  const resolvedModelId = modelChoice === CUSTOM_MODEL ? customModelId.trim() : modelChoice.trim();
  const selectedModel = models.find((model) => model.id === resolvedModelId);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!resolvedModelId) {
      setError("Hãy chọn một model hoặc nhập Model ID tùy chỉnh.");
      return;
    }

    setSaving(true);
    try {
      const result = await updateAiSettings({
        provider,
        isEnabled: enabled,
        ...(apiKey ? { apiKey } : {}),
        configuredModels: { ANALYSIS: resolvedModelId },
      });
      setStatus(result);
      setApiKey("");
      setMessage(
        `Đã lưu ${providerName(provider)} với model ${selectedModel?.label ?? resolvedModelId}. Khóa API được mã hóa và không hiển thị lại.`,
      );
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function testSelectedProvider() {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await testAiProvider(provider);
      setMessage(
        result.status === "HEALTHY"
          ? `${providerName(provider)} hoạt động tốt${result.model ? ` với model ${result.model}` : ""}.`
          : `${providerName(provider)} chưa sẵn sàng${result.code ? ` (${result.code})` : ""}.`,
      );
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setTesting(false);
    }
  }

  async function refreshModels() {
    setDiscovering(true);
    setMessage(null);
    setError(null);
    try {
      const result = await discoverAiModels(provider);
      const currentModel = resolvedModelId;
      const selection = chooseModel(result.models, currentModel || selected?.model);
      setModels(result.models);
      setModelChoice(selection.choice);
      setCustomModelId(selection.customId);
      setMessage(`Đã cập nhật ${result.models.length} model cho ${providerName(provider)}.`);
    } catch (reason) {
      setError(getVietnameseApiMessage(reason));
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="eyebrow">AI provider và fallback router</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Cài đặt AI</h1>
        <p className="mt-3 text-slate-600">
          Chọn model bằng tên dễ hiểu. Model được đề xuất sẽ được chọn sẵn; Model ID thủ công chỉ
          nằm trong phần nâng cao.
        </p>
      </header>
      {pending ? <p className="text-sm text-slate-600">Đang tải cấu hình AI…</p> : null}
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
            <div className="flex gap-2" aria-label="Nhà cung cấp AI">
              {(["GEMINI", "NVIDIA"] as const).map((item) => (
                <button
                  className={
                    provider === item ? "button-table bg-slate-950 text-white" : "button-table"
                  }
                  key={item}
                  type="button"
                  aria-pressed={provider === item}
                  onClick={() => {
                    setApiKey("");
                    setProvider(item);
                  }}
                >
                  {providerName(item)}
                </button>
              ))}
            </div>
            <h2 className="mt-3 text-xl font-bold text-slate-950">Provider phân tích chính</h2>
          </div>
          <span
            className={
              selected?.status === "HEALTHY"
                ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700"
                : "rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700"
            }
          >
            {statusLabel(selected?.status)}
          </span>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          {selected?.apiKeyMasked
            ? `Đã cấu hình khóa ${selected.apiKeyMasked}`
            : "Chưa cấu hình khóa API"}
        </p>
        <form className="mt-6 grid gap-5" onSubmit={(event) => void save(event)}>
          <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Cho phép phân tích bằng AI
          </label>
          <label className="field-label">
            Khóa API {providerName(provider)} (chỉ nhập khi thêm mới hoặc thay thế)
            <input
              className="field-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="new-password"
              placeholder="Để trống nếu muốn giữ khóa hiện tại"
            />
          </label>
          <label className="field-label">
            Model phân tích
            <select
              className="field-input"
              value={modelChoice}
              onChange={(event) => {
                setModelChoice(event.target.value);
                if (event.target.value !== CUSTOM_MODEL) setCustomModelId("");
              }}
              disabled={discovering && models.length === 0}
            >
              {modelChoice === "" ? (
                <option value="" disabled>
                  Đang tải danh sách model…
                </option>
              ) : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {model.recommended ? " · Đề xuất" : ""}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Model khác (nâng cao)</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Model ID: <code>{resolvedModelId || "Chưa chọn"}</code>
            </span>
            {selectedModel?.description ? (
              <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                {selectedModel.description}
              </span>
            ) : null}
          </label>
          {modelChoice === CUSTOM_MODEL ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Cài đặt nâng cao
              </p>
              <label className="field-label mt-3">
                Model ID tùy chỉnh
                <input
                  className="field-input"
                  value={customModelId}
                  onChange={(event) => setCustomModelId(event.target.value)}
                  placeholder="Chỉ nhập khi model chưa có trong danh sách"
                  required
                />
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button className="button-primary" type="submit" disabled={saving || pending}>
              {saving ? "Đang lưu…" : "Lưu cài đặt"}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void testSelectedProvider()}
              disabled={testing}
            >
              {testing ? "Đang kiểm tra…" : "Kiểm tra provider"}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => void refreshModels()}
              disabled={discovering}
            >
              {discovering ? "Đang tải model…" : "Tải lại danh sách model"}
            </button>
          </div>
        </form>
      </section>
      <p className="text-sm leading-6 text-slate-500">
        Nếu Gemini bị giới hạn, router thử NVIDIA fallback theo model role đã cấu hình. Nếu tất cả
        AI lỗi, dashboard dữ liệu, rankings và health vẫn tiếp tục hoạt động.
      </p>
    </div>
  );
}
