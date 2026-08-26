interface EvidenceClaim {
  narrative: string;
  evidenceMetricIds: string[];
  evidence: EvidenceReference[];
  confidence: number | null;
  caveats: string[];
}

interface EvidenceDetail {
  id: string;
  entityType: string | null;
  entityId: string | null;
  metric: string | null;
  value: string | null;
  unit: string | null;
  observedAt: string | null;
  source: string | null;
  coverage: string | null;
  precision: string | null;
  status: string | null;
  reason: string | null;
}

interface EvidenceReference {
  id: string;
  detail: EvidenceDetail | null;
}

interface ReportView {
  heading: string | null;
  provider: string | null;
  modelId: string | null;
  claims: EvidenceClaim[];
  sections: Array<{ title: string; items: string[] }>;
  insufficientReason: string | null;
  partialCoverageReason: string | null;
}

interface ReportPayload {
  result: Record<string, unknown>;
  provider: string | null;
  modelId: string | null;
  coverage: Record<string, unknown> | null;
  evidence: EvidenceDetail[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (text(item) ? [text(item)!] : [])) : [];
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value.trim() : null;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function evidenceDetail(value: unknown): EvidenceDetail | null {
  const candidate = record(value);
  const id = text(candidate?.id);
  if (!candidate || !id) return null;
  return {
    id,
    entityType: text(candidate.entityType),
    entityId: text(candidate.entityId),
    metric: text(candidate.metric),
    value: scalarText(candidate.value),
    unit: text(candidate.unit),
    observedAt: text(candidate.observedAt),
    source: text(candidate.source),
    coverage: text(candidate.coverage),
    precision: text(candidate.precision),
    status: text(candidate.status),
    reason: text(candidate.reason),
  };
}

function evidenceDetails(value: unknown): EvidenceDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const detail = evidenceDetail(candidate);
    return detail ? [detail] : [];
  });
}

function reportPayload(value: unknown): ReportPayload | null {
  const outer = record(value);
  if (!outer) return null;
  const persistedResult = record(outer.result) ?? outer;
  const grounding = record(persistedResult.grounding);
  return {
    result: record(persistedResult.report) ?? persistedResult,
    provider: text(outer.provider) ?? text(persistedResult.provider),
    modelId: text(outer.modelId) ?? text(persistedResult.modelId),
    coverage:
      record(grounding?.coverage) ?? record(persistedResult.coverage) ?? record(outer.coverage),
    evidence: evidenceDetails(grounding?.evidence),
  };
}

function evidenceClaim(value: unknown): EvidenceClaim | null {
  const claim = record(value);
  const narrative = text(claim?.narrative) ?? text(claim?.claim) ?? text(claim?.text);
  if (!claim || !narrative) return null;
  const confidenceValue = claim.confidence;
  const primaryEvidence = textList(claim.evidenceMetricIds);
  return {
    narrative,
    evidenceMetricIds: primaryEvidence.length > 0 ? primaryEvidence : textList(claim.evidenceIds),
    evidence: [],
    confidence:
      typeof confidenceValue === "number" &&
      Number.isFinite(confidenceValue) &&
      confidenceValue >= 0 &&
      confidenceValue <= 1
        ? confidenceValue
        : null,
    caveats: textList(claim.caveats),
  };
}

function evidenceClaims(value: unknown): EvidenceClaim[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const claim = evidenceClaim(candidate);
    return claim ? [claim] : [];
  });
}

function winnerList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const winner = record(candidate);
    const videoId = text(winner?.videoId);
    const reason = text(winner?.reason);
    if (!videoId || !reason) return [];
    return [`${videoId}: ${reason}`];
  });
}

export function buildAiReportView(kind: "DAILY" | "WEEKLY", value: unknown): ReportView | null {
  const payload = reportPayload(value);
  if (!payload) return null;
  const { result, coverage } = payload;
  const evidenceById = new Map(payload.evidence.map((item) => [item.id, item]));

  const status = text(result.status);
  const coverageStatus = text(coverage?.status);
  const coverageReason = text(coverage?.reason);
  const insufficientReason =
    status === "INSUFFICIENT_DATA" || coverageStatus === "INSUFFICIENT"
      ? (text(result.reason) ??
        (coverageReason === "NO_ENABLED_CHANNELS"
          ? "Chưa có kênh đang bật để phân tích."
          : coverageReason === "NO_CANONICAL_DAILY_STATS"
            ? "Chưa có snapshot ngày canonical."
            : coverageReason === "INSUFFICIENT_HISTORY"
              ? "Chưa đủ lịch sử snapshot cho kỳ báo cáo."
              : "Chưa đủ metric có nguồn để AI tạo nhận định an toàn."))
      : null;
  const partialCoverageReason =
    coverageStatus === "PARTIAL"
      ? coverageReason === "INSUFFICIENT_HISTORY"
        ? "Chưa đủ lịch sử snapshot cho toàn kỳ; dữ liệu thiếu không được xem là 0."
        : "Kỳ báo cáo thiếu một phần snapshot; dữ liệu thiếu không được xem là 0."
      : null;
  const summaryValue = kind === "DAILY" ? result.summary : result.executiveSummary;
  const summaryClaim = evidenceClaim(summaryValue);
  const groundedClaims = [
    ...(summaryClaim ? [summaryClaim] : []),
    ...evidenceClaims(result.keyFindings),
    ...evidenceClaims(result.risks),
    ...evidenceClaims(result.opportunities),
    ...evidenceClaims(result.limitations),
    ...evidenceClaims(result.emergingPatterns),
    ...evidenceClaims(result.decliningPatterns),
    ...evidenceClaims(result.recommendations),
    ...evidenceClaims(
      Array.isArray(result.channelsToInspect)
        ? result.channelsToInspect.map((item) => record(item)?.reason)
        : [],
    ),
    ...evidenceClaims(
      Array.isArray(result.videosToInspect)
        ? result.videosToInspect.map((item) => record(item)?.reason)
        : [],
    ),
    ...evidenceClaims(
      Array.isArray(result.winners) ? result.winners.map((item) => record(item)?.reason) : [],
    ),
  ];
  const claims = [...evidenceClaims(result.claims), ...groundedClaims].map((claim) => ({
    ...claim,
    evidence: claim.evidenceMetricIds.map((id) => ({ id, detail: evidenceById.get(id) ?? null })),
  }));
  const heading =
    kind === "DAILY"
      ? (text(result.summary) ?? text(result.executiveSummary))
      : (text(result.executiveSummary) ?? text(result.summary));
  const candidates: Array<[string, string[]]> =
    kind === "DAILY"
      ? [
          ["Phát hiện chính", textList(result.keyFindings)],
          ["Rủi ro", textList(result.risks)],
          ["Cơ hội", textList(result.opportunities)],
          ["Kênh cần kiểm tra", textList(result.channelsToInspect)],
          ["Video cần kiểm tra", textList(result.videosToInspect)],
        ]
      : [
          ["Video nổi bật", winnerList(result.winners)],
          ["Mẫu hình mới", textList(result.emergingPatterns)],
          ["Mẫu hình suy giảm", textList(result.decliningPatterns)],
          ["Đề xuất", textList(result.recommendations)],
        ];

  return {
    heading,
    provider: payload.provider,
    modelId: payload.modelId,
    claims,
    sections: candidates.flatMap(([title, items]) => (items.length > 0 ? [{ title, items }] : [])),
    insufficientReason,
    partialCoverageReason,
  };
}

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}% tin cậy`;
}

const metricLabels: Record<string, string> = {
  subscriber_count: "Người đăng ký",
  video_count: "Video công khai",
  lifetime_view_count: "Lượt xem trọn đời",
  subscriber_delta: "Thay đổi người đăng ký",
  video_delta: "Thay đổi số video",
  view_delta: "Thay đổi lượt xem",
  viewDelta: "Thay đổi lượt xem",
  views: "Lượt xem",
  likes: "Lượt thích",
  comments: "Bình luận",
  durationSeconds: "Thời lượng",
  publishedAt: "Ngày xuất bản",
  title: "Tiêu đề video",
  channelDayCoverage: "Độ phủ ngày-kênh",
};

const sourceLabels: Record<string, string> = {
  CHANNEL_DAILY_STAT: "Snapshot ngày của kênh",
  VIDEO_SNAPSHOT: "Snapshot video",
  DERIVED_CANONICAL_SNAPSHOTS: "Tính từ các snapshot chuẩn",
  PUBLIC_VIDEO_METADATA: "Metadata công khai YouTube",
  DERIVED_COVERAGE: "Tính từ độ phủ dữ liệu",
  YOUTUBE_PUBLIC_PAGE: "Trang YouTube công khai",
  YOUTUBE_PUBLIC_ABOUT_HTML: "Trang Giới thiệu YouTube công khai",
  YOUTUBE_PUBLIC_ABOUT_RENDER: "Bản hiển thị Giới thiệu YouTube công khai",
};

const stateLabels: Record<string, string> = {
  COMPLETE: "Đầy đủ",
  PARTIAL: "Một phần",
  READY: "Sẵn sàng",
  WARMING_UP: "Đang tích lũy",
  UNAVAILABLE: "Chưa khả dụng",
  EXACT: "Chính xác",
  EXACT_AS_PUBLISHED: "Chính xác như YouTube công bố",
  ROUNDED_3_SIGNIFICANT_DIGITS: "Làm tròn 3 chữ số có nghĩa",
  ROUNDED_PUBLIC_DISPLAY: "Làm tròn theo hiển thị công khai",
};

const unitLabels: Record<string, string> = {
  views: "lượt xem",
  subscribers: "người đăng ký",
  videos: "video",
  seconds: "giây",
  "channel-days": "ngày-kênh",
};

const providerLabels: Record<string, string> = {
  GEMINI: "Gemini",
  NVIDIA: "NVIDIA",
};

const entityLabels: Record<string, string> = {
  CHANNEL: "Kênh",
  VIDEO: "Video",
  PORTFOLIO: "Danh mục",
};

const reasonLabels: Record<string, string> = {
  LEGACY_BASELINE_PRECISION_UNKNOWN: "Baseline cũ không có metadata độ chính xác",
  ROUNDED_PUBLIC_SOURCE: "Nguồn công khai có thể đã được YouTube làm tròn",
  DERIVED_FROM_PUBLIC_SNAPSHOTS: "Được tính từ các snapshot công khai đã lưu",
};

function label(value: string | null, labels: Record<string, string>): string | null {
  return value ? (labels[value] ?? value) : null;
}

function formatInteger(value: string): string {
  const match = /^(-?)(\d+)$/u.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2]!.replace(/\B(?=(\d{3})+(?!\d))/gu, ".")}`;
}

function evidenceValue(detail: EvidenceDetail): string {
  if (detail.value === null) return "Chưa có giá trị";
  const formatted = formatInteger(detail.value);
  const unit = label(detail.unit, unitLabels);
  return unit ? `${formatted} ${unit}` : formatted;
}

function observedAtLabel(value: string): string {
  const date =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?/u.exec(
      value,
    );
  if (!date) return value;
  const day = `${date[3]}/${date[2]}/${date[1]}`;
  const timezone = date[6] === "Z" ? " UTC" : date[6] ? ` UTC${date[6]}` : "";
  return date[4] && date[5] ? `${day}, ${date[4]}:${date[5]}${timezone}` : day;
}

function EvidenceReferenceCard({ reference }: { reference: EvidenceReference }) {
  const detail = reference.detail;
  if (!detail) {
    return (
      <li className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-2.5">
        <code className="break-all text-[11px] font-semibold text-amber-900">{reference.id}</code>
        <p className="mt-1 text-xs leading-5 text-amber-800">
          Không tìm thấy chi tiết dẫn chứng trong báo cáo đã lưu.
        </p>
      </li>
    );
  }

  const coverage = label(detail.coverage, stateLabels);
  const precision = label(detail.precision, stateLabels);
  const status = label(detail.status, stateLabels);
  return (
    <li className="rounded-md border border-white bg-white/90 p-2.5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-bold text-slate-700">
          {label(detail.metric, metricLabels) ?? "Chỉ số dẫn chứng"}
        </span>
        <strong className="break-words text-sm text-sky-800">{evidenceValue(detail)}</strong>
      </div>
      <dl className="mt-2 grid gap-1 text-xs leading-5 text-slate-600 sm:grid-cols-2">
        {detail.entityType || detail.entityId ? (
          <div>
            <dt className="inline font-semibold text-slate-500">
              {detail.entityType
                ? (entityLabels[detail.entityType] ?? detail.entityType)
                : "Đối tượng"}
              {": "}
            </dt>
            <dd className="inline break-all">{detail.entityId ?? "Toàn danh mục"}</dd>
          </div>
        ) : null}
        {detail.source ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Nguồn: </dt>
            <dd className="inline">{label(detail.source, sourceLabels)}</dd>
          </div>
        ) : null}
        {detail.observedAt ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Quan sát lúc: </dt>
            <dd className="inline">
              <time dateTime={detail.observedAt}>{observedAtLabel(detail.observedAt)}</time>
            </dd>
          </div>
        ) : null}
        {coverage ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Độ phủ: </dt>
            <dd className="inline">{coverage}</dd>
          </div>
        ) : null}
        {precision ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Độ chính xác: </dt>
            <dd className="inline">{precision}</dd>
          </div>
        ) : null}
        {status ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Trạng thái: </dt>
            <dd className="inline">{status}</dd>
          </div>
        ) : null}
        {detail.reason ? (
          <div>
            <dt className="inline font-semibold text-slate-500">Ghi chú: </dt>
            <dd className="inline">{reasonLabels[detail.reason] ?? detail.reason}</dd>
          </div>
        ) : null}
      </dl>
      <code className="mt-2 block break-all text-[10px] text-slate-400">{detail.id}</code>
    </li>
  );
}

export function AiReportContent({ kind, report }: { kind: "DAILY" | "WEEKLY"; report: unknown }) {
  const view = buildAiReportView(kind, report);
  if (!view) {
    return (
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Báo cáo chưa có nội dung hợp lệ để hiển thị.
      </p>
    );
  }

  if (view.insufficientReason) {
    return (
      <div className="mt-3 space-y-2">
        {view.provider || view.modelId ? (
          <p className="text-xs text-slate-500">
            AI:{" "}
            {view.provider
              ? (providerLabels[view.provider] ?? view.provider)
              : "Nhà cung cấp chưa rõ"}
            {view.modelId ? ` · ${view.modelId}` : ""}
          </p>
        ) : null}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-bold text-amber-900">Đang tích lũy dữ liệu</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">{view.insufficientReason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      {view.provider || view.modelId ? (
        <p className="text-xs text-slate-500">
          AI:{" "}
          {view.provider
            ? (providerLabels[view.provider] ?? view.provider)
            : "Nhà cung cấp chưa rõ"}
          {view.modelId ? ` · ${view.modelId}` : ""}
        </p>
      ) : null}
      {view.partialCoverageReason ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5" role="status">
          <p className="text-sm font-bold text-amber-900">Độ phủ dữ liệu một phần</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">{view.partialCoverageReason}</p>
        </div>
      ) : null}
      {view.heading ? <p className="text-sm leading-6 text-slate-700">{view.heading}</p> : null}
      {view.claims.length > 0 ? (
        <section aria-label="Nhận định có dẫn chứng">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
            Nhận định có dẫn chứng
          </h3>
          <ul className="mt-2 space-y-2">
            {view.claims.map((claim, index) => (
              <li
                className="rounded-lg border border-sky-100 bg-sky-50 p-3"
                key={`${index}-${claim.narrative}`}
              >
                <p className="text-sm font-semibold leading-6 text-slate-800">{claim.narrative}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {claim.confidence !== null ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-sky-700">
                      {confidenceLabel(claim.confidence)}
                    </span>
                  ) : null}
                </div>
                {claim.evidence.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[11px] font-black uppercase tracking-wider text-sky-800">
                      Dữ liệu được trích dẫn
                    </p>
                    <ul aria-label="Chi tiết dẫn chứng" className="mt-1.5 space-y-1.5">
                      {claim.evidence.map((reference) => (
                        <EvidenceReferenceCard key={reference.id} reference={reference} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {claim.caveats.length > 0 ? (
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    Lưu ý: {claim.caveats.join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {view.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
            {section.title}
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-700">
            {section.items.map((item, index) => (
              <li className="flex gap-2" key={`${section.title}-${index}-${item}`}>
                <span aria-hidden="true" className="text-sky-600">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
