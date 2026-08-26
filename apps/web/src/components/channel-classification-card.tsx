interface ClassificationView {
  primaryNiche: string;
  subNiches: string[];
  language: string;
  contentFormat: string;
  confidence: number;
  cached: boolean;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseChannelClassification(value: unknown): ClassificationView | null {
  const response = object(value);
  const classification = object(response?.classification);
  const primaryNiche = nonEmpty(classification?.primaryNiche);
  const language = nonEmpty(classification?.language);
  const contentFormat = nonEmpty(classification?.contentFormat);
  const confidence = classification?.confidence;
  if (
    !response ||
    !classification ||
    !primaryNiche ||
    !language ||
    !contentFormat ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return null;
  }
  const subNiches = Array.isArray(classification.subNiches)
    ? classification.subNiches.flatMap((item) => {
        const niche = nonEmpty(item);
        return niche ? [niche] : [];
      })
    : [];
  return {
    primaryNiche,
    subNiches,
    language,
    contentFormat,
    confidence,
    cached: response.cached === true,
  };
}

export function ChannelClassificationCard({ result }: { result: unknown }) {
  const classification = parseChannelClassification(result);
  if (!classification) return null;
  return (
    <section className="surface-card" aria-labelledby="classification-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">AI interpretation</p>
          <h2 id="classification-title" className="mt-1 text-xl font-bold text-slate-950">
            Phân loại nội dung
          </h2>
        </div>
        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">
          {Math.round(classification.confidence * 100)}% tin cậy
          {classification.cached ? " · cache" : ""}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Ngách chính</dt>
          <dd className="mt-2 font-black text-slate-900">{classification.primaryNiche}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Ngôn ngữ</dt>
          <dd className="mt-2 font-black text-slate-900">{classification.language}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Định dạng</dt>
          <dd className="mt-2 font-black text-slate-900">{classification.contentFormat}</dd>
        </div>
      </dl>
      {classification.subNiches.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Các ngách phụ">
          {classification.subNiches.map((niche) => (
            <span
              className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700"
              key={niche}
            >
              {niche}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Đây là phân loại diễn giải từ metadata công khai, không phải metric canonical.
      </p>
    </section>
  );
}
