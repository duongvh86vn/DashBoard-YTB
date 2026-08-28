import type {
  PublicIntelligenceMetric,
  PublicIntelligenceResponse,
  PublicIntelligenceWarning,
} from "@yt-monitor/shared";

const integerFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

const metricClassLabels: Record<PublicIntelligenceMetric["metricClass"], string> = {
  PUBLIC_CURRENT: "Công khai hiện tại",
  LOCAL_SNAPSHOT_DERIVED: "Suy ra từ snapshot",
  DETERMINISTIC_PUBLIC_METADATA: "Tính từ metadata công khai",
};

const warningLabels: Record<PublicIntelligenceWarning, string> = {
  STALE_CURRENT_SNAPSHOT: "Snapshot hiện tại đã cũ",
  INCOMPLETE_DAILY_HISTORY: "Lịch sử ngày chưa đủ",
  SUBSCRIBER_COUNTS_ARE_ROUNDED: "Subscriber công khai đã bị làm tròn",
  INCOMPLETE_VIDEO_CATALOG: "Danh mục video đang được bổ sung",
  MISSING_VIDEO_DURATIONS: "Một số video thiếu thời lượng",
};

function numeric(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function durationLabel(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  if (minutes > 0) return `${minutes} phút ${remainingSeconds} giây`;
  return `${remainingSeconds} giây`;
}

function formatMetric(metric: PublicIntelligenceMetric, signed = false): string {
  if (metric.value === null) return "0";
  const value = numeric(metric.value);
  if (value === null) return "0";
  const formatted =
    metric.unit === "SECONDS"
      ? durationLabel(value)
      : metric.unit === "UPLOADS_PER_WEEK"
        ? `${decimalFormatter.format(value)} video/tuần`
        : integerFormatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function statusLabel(metric: PublicIntelligenceMetric): string {
  if (metric.status === "READY") return metricClassLabels[metric.metricClass];
  if (metric.status === "WARMING_UP") return "Đang tích lũy baseline";
  if (metric.status === "PARTIAL") return "Dữ liệu một phần";
  return "Không khả dụng công khai";
}

function statusClasses(status: PublicIntelligenceMetric["status"]): string {
  if (status === "READY") return "bg-emerald-50 text-emerald-700";
  if (status === "WARMING_UP") return "bg-sky-50 text-sky-700";
  if (status === "PARTIAL") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function MetricCard({
  label,
  metric,
  signed = false,
}: {
  label: string;
  metric: PublicIntelligenceMetric;
  signed?: boolean;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-bold text-slate-600">{label}</p>
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses(metric.status)}`}
        >
          {statusLabel(metric)}
        </span>
      </div>
      <p className="mt-3 text-2xl font-black tabular-nums text-slate-950">
        <span>{formatMetric(metric, signed)}</span>
        {metric.value === null ? (
          <span className="ml-2 text-[10px] font-semibold text-amber-700">hiển thị tạm</span>
        ) : null}
      </p>
      <dl className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
        <div>
          <dt className="inline font-semibold">Trạng thái: </dt>
          <dd className="inline">{metric.status}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Độ chính xác: </dt>
          <dd className="inline">{metric.precision}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Thu thập lúc: </dt>
          <dd className="inline">{metric.provenance.capturedAt ?? "Chưa có"}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Lý do: </dt>
          <dd className="inline">{metric.reason ?? "Không có"}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Nguồn: </dt>
          <dd className="inline">{metric.provenance.source}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Phương pháp: </dt>
          <dd className="inline">{metric.provenance.method}</dd>
        </div>
      </dl>
    </article>
  );
}

export function PublicIntelligencePanel({ data }: { data: PublicIntelligenceResponse }) {
  const { metrics, coverage } = data;
  return (
    <section className="surface-card" aria-labelledby="public-intelligence-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Public intelligence</p>
          <h2 id="public-intelligence-title" className="mt-1 text-xl font-black text-slate-950">
            Phân tích công khai {data.period.days} ngày
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Metric được tính bằng code từ snapshot và metadata thật; không dùng AI để tạo con số.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          {coverage.completeDays}/{coverage.requestedDays} ngày hoàn chỉnh
        </span>
      </div>

      <section className="mt-5" aria-labelledby="public-current-totals-title">
        <h3 id="public-current-totals-title" className="text-sm font-black text-slate-800">
          Số liệu công khai hiện tại
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Người đăng ký hiện tại" metric={metrics.subscribers} />
          <MetricCard label="Video công khai hiện tại" metric={metrics.publicVideos} />
          <MetricCard label="Lượt xem trọn đời hiện tại" metric={metrics.lifetimeViews} />
        </div>
      </section>

      <h3 className="mt-6 text-sm font-black text-slate-800">Biến động trong kỳ</h3>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Lượt xem tăng" metric={metrics.viewsGained} signed />
        <MetricCard label="Người đăng ký tăng" metric={metrics.subscribersGained} signed />
        <MetricCard label="Video thực sự xuất bản" metric={metrics.publishedVideos} />
        <MetricCard
          label="Biến động kho video công khai"
          metric={metrics.publicInventoryDelta}
          signed
        />
        <MetricCard label="Độ dài video trung bình" metric={metrics.averageVideoDurationSeconds} />
        <MetricCard label="Tần suất đăng" metric={metrics.uploadFrequencyPerWeek} />
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-bold text-slate-700">Độ phủ snapshot</span>
          <span className="font-black tabular-nums text-slate-950">
            {coverage.coveragePercent}%
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-label="Độ phủ snapshot công khai"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coverage.coveragePercent}
        >
          <div
            className="h-full rounded-full bg-sky-500"
            style={{ width: `${coverage.coveragePercent}%` }}
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {coverage.reportedPublicVideos === null ? (
            <>
              Catalog biết {coverage.knownPublicVideos} video công khai; tổng công khai hiển thị tạm
              0 vì chưa có dữ liệu; {coverage.durationKnownVideos} video có thời lượng.
            </>
          ) : (
            <>
              Catalog biết {coverage.knownPublicVideos}/{coverage.reportedPublicVideos} video công
              khai; {coverage.durationKnownVideos} video có thời lượng.
            </>
          )}
        </p>
      </div>

      {data.warnings.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Cảnh báo chất lượng dữ liệu">
          {data.warnings.map((warning) => (
            <span
              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
              key={warning}
            >
              {warningLabels[warning]}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
