import type { DashboardRevenueChannel, DashboardRevenueResponse } from "@yt-monitor/shared";

type DashboardRevenuePoint = DashboardRevenueResponse["series"][number];

const USD_MICROS = 1_000_000n;
const REVENUE_CHART = {
  width: 900,
  height: 300,
  left: 64,
  right: 828,
  top: 24,
  bottom: 226,
} as const;

function formatUsd(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction] = match;
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${sign}${grouped}${fraction ? `,${fraction}` : ""} USD`;
}

function parseUsdMicros(value: string | null): bigint | null {
  if (value === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/u.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(match[2]!) * USD_MICROS + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function microsToUsd(micros: bigint): string {
  const negative = micros < 0n;
  const magnitude = negative ? -micros : micros;
  const integer = magnitude / USD_MICROS;
  const fraction = (magnitude % USD_MICROS).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}/${match[2]}` : value;
}

function channelRevenueLabel(channel: DashboardRevenueChannel): string {
  if (channel.status === "COMPLETE" && channel.totalEstimatedRevenueUsd !== null) {
    return formatUsd(channel.totalEstimatedRevenueUsd);
  }
  if (channel.status === "PARTIAL" && channel.observedEstimatedRevenueUsd !== null) {
    return `Quan sát ${formatUsd(channel.observedEstimatedRevenueUsd)}`;
  }
  return "0 USD";
}

function pointValue(point: DashboardRevenuePoint): string | null {
  if (point.status === "COMPLETE") return point.totalEstimatedRevenueUsd;
  if (point.status === "PARTIAL") return point.observedEstimatedRevenueUsd;
  return null;
}

interface RevenueChartPoint {
  date: string;
  value: bigint;
  rawValue: string | null;
  available: boolean;
  status: DashboardRevenuePoint["status"];
  coveredChannels: number;
  totalChannels: number;
  x: number;
  y: number;
}

function splitAvailableSegments(points: RevenueChartPoint[]): RevenueChartPoint[][] {
  const segments: RevenueChartPoint[][] = [];
  let current: RevenueChartPoint[] = [];
  for (const point of points) {
    if (!point.available) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function RevenueTimeline({ data }: { data: DashboardRevenueResponse }) {
  if (data.series.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Chưa có điểm dữ liệu theo ngày trong kỳ đang chọn.
      </p>
    );
  }

  const raw = data.series.map((point) => {
    const rawValue = pointValue(point);
    return {
      ...point,
      rawValue,
      value: parseUsdMicros(rawValue) ?? 0n,
      available: rawValue !== null && point.status !== "UNAVAILABLE",
    };
  });
  const minimum = raw.reduce((result, point) => (point.value < result ? point.value : result), 0n);
  let maximum = raw.reduce((result, point) => (point.value > result ? point.value : result), 0n);
  if (minimum === maximum) maximum = minimum + USD_MICROS;
  const range = maximum - minimum;
  const lastIndex = Math.max(1, raw.length - 1);
  const points: RevenueChartPoint[] = raw.map((point, index) => ({
    ...point,
    x: REVENUE_CHART.left + (index / lastIndex) * (REVENUE_CHART.right - REVENUE_CHART.left),
    y:
      REVENUE_CHART.top +
      (Number(((maximum - point.value) * 1_000n) / range) / 1_000) *
        (REVENUE_CHART.bottom - REVENUE_CHART.top),
  }));
  const segments = splitAvailableSegments(points);
  const grid = [0, 1, 2, 3].map((step) => ({
    y: REVENUE_CHART.top + (step / 3) * (REVENUE_CHART.bottom - REVENUE_CHART.top),
    value: maximum - (range * BigInt(step)) / 3n,
  }));
  const firstDate = data.series[0]?.date ?? data.period.startDate;
  const middleDate = data.series[Math.floor(data.series.length / 2)]?.date ?? data.period.startDate;
  const lastDate = data.series.at(-1)?.date ?? data.period.endDate;
  const ariaSummary = `Doanh thu ước tính theo ngày từ ${formatCalendarDate(
    firstDate,
  )} đến ${formatCalendarDate(lastDate)}`;

  return (
    <div className="overflow-x-auto rounded-2xl bg-slate-950 px-3 py-4 text-white sm:px-5">
      <svg
        className="h-72 min-w-[42rem] w-full"
        viewBox={`0 0 ${REVENUE_CHART.width} ${REVENUE_CHART.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaSummary}
      >
        <title>{ariaSummary}</title>
        <desc>
          Đường chỉ nối ngày có dữ liệu doanh thu. Điểm tròn rỗng tại 0 là ngày thiếu dữ liệu, không
          phải doanh thu đã xác nhận bằng 0.
        </desc>
        <defs>
          <linearGradient id="dashboard-revenue-trend" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((line) => (
          <g key={line.y}>
            <line
              x1={REVENUE_CHART.left}
              x2={REVENUE_CHART.right}
              y1={line.y}
              y2={line.y}
              stroke="#334155"
              strokeWidth="1"
            />
            <text
              x="884"
              y={line.y + 5}
              textAnchor="end"
              fill="#94a3b8"
              fontSize="12"
              aria-hidden="true"
            >
              {formatUsd(microsToUsd(line.value))}
            </text>
          </g>
        ))}
        {segments.map((segment, index) => {
          const coordinates = segment.map((point) => `${point.x},${point.y}`).join(" ");
          const area = `${segment[0]?.x},${REVENUE_CHART.bottom} ${coordinates} ${segment.at(-1)?.x},${REVENUE_CHART.bottom}`;
          return (
            <g key={`${segment[0]?.date ?? index}-${index}`}>
              {segment.length > 1 ? (
                <polygon points={area} fill="url(#dashboard-revenue-trend)" />
              ) : null}
              {segment.slice(1).map((point, pointIndex) => {
                const previous = segment[pointIndex]!;
                const partialEdge = previous.status === "PARTIAL" || point.status === "PARTIAL";
                return (
                  <line
                    key={`edge-${previous.date}-${point.date}`}
                    data-revenue-edge={`${previous.date}:${point.date}`}
                    x1={previous.x}
                    y1={previous.y}
                    x2={point.x}
                    y2={point.y}
                    stroke="#34d399"
                    strokeWidth="3"
                    strokeDasharray={partialEdge ? "7 5" : undefined}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {segment.map((point) => (
                <circle
                  key={point.date}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill="#34d399"
                  stroke={point.status === "PARTIAL" ? "#fbbf24" : "none"}
                  strokeWidth={point.status === "PARTIAL" ? "3" : "0"}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${formatCalendarDate(point.date)}: ${formatUsd(
                    point.rawValue!,
                  )} · ${point.coveredChannels}/${point.totalChannels} kênh có dữ liệu`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {points
          .filter((point) => !point.available)
          .map((point) => (
            <circle
              key={`missing-${point.date}`}
              cx={point.x}
              cy={point.y}
              r="4.5"
              fill="#0f172a"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${formatCalendarDate(point.date)}: 0 USD hiển thị tạm · thiếu dữ liệu`}</title>
            </circle>
          ))}
        <line
          x1={REVENUE_CHART.left}
          x2={REVENUE_CHART.right}
          y1={REVENUE_CHART.bottom}
          y2={REVENUE_CHART.bottom}
          stroke="#64748b"
          strokeWidth="1.25"
        />
        {[
          { x: REVENUE_CHART.left, anchor: "start" as const, value: firstDate },
          {
            x: (REVENUE_CHART.left + REVENUE_CHART.right) / 2,
            anchor: "middle" as const,
            value: middleDate,
          },
          { x: REVENUE_CHART.right, anchor: "end" as const, value: lastDate },
        ].map((date) => (
          <text
            key={`${date.x}-${date.value}`}
            x={date.x}
            y="264"
            textAnchor={date.anchor}
            fill="#94a3b8"
            fontSize="13"
            aria-hidden="true"
          >
            {formatCalendarDate(date.value)}
          </text>
        ))}
      </svg>
      <div className="sr-only">
        <table>
          <caption>{ariaSummary}. Chi tiết doanh thu ước tính theo ngày</caption>
          <thead>
            <tr>
              <th scope="col">Ngày</th>
              <th scope="col">Doanh thu</th>
              <th scope="col">Độ phủ</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatCalendarDate(point.date)}</th>
                <td>{point.available ? formatUsd(point.rawValue!) : "0 USD (thiếu dữ liệu)"}</td>
                <td>
                  {point.status} · {point.coveredChannels}/{point.totalChannels} kênh có dữ liệu
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DashboardRevenuePanel({
  data,
  loading,
  failed,
}: {
  data: DashboardRevenueResponse | null;
  loading: boolean;
  failed: boolean;
}) {
  const metricLabel =
    data?.metric.status === "COMPLETE" && data.metric.totalEstimatedRevenueUsd !== null
      ? formatUsd(data.metric.totalEstimatedRevenueUsd)
      : data?.metric.status === "PARTIAL" && data.metric.observedEstimatedRevenueUsd !== null
        ? `Phần đã quan sát: ${formatUsd(data.metric.observedEstimatedRevenueUsd)}`
        : "0 USD";
  const monetizedChannels =
    data?.channels.filter((channel) => channel.monetizationStatus === "ENABLED") ?? [];

  return (
    <section
      className="overflow-hidden rounded-2xl border border-emerald-200 bg-white"
      aria-labelledby="estimated-revenue-title"
    >
      <div className="bg-gradient-to-r from-emerald-950 to-slate-950 px-5 py-6 text-white sm:px-7">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
          RPM do quản trị viên nhập
        </p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 id="estimated-revenue-title" className="text-2xl font-black">
              Doanh thu ước tính từ RPM thủ công
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Lượt xem tăng công khai × RPM có hiệu lực. Không phải doanh thu thực tế từ YouTube
              Analytics.
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-2xl font-black tabular-nums">
              {loading ? "Đang tải…" : metricLabel}
            </p>
            {data ? (
              <p className="mt-1 text-xs text-slate-300">
                {data.metric.coveredChannelDays}/{data.metric.totalChannelDays} kênh-ngày có đủ dữ
                liệu
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {failed ? (
        <p className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          Không thể tải ước tính doanh thu. Vui lòng kiểm tra lại kết nối dịch vụ.
        </p>
      ) : monetizedChannels.length ? (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-black" scope="col">
                  Kênh
                </th>
                <th className="px-4 py-3 font-black" scope="col">
                  Kiếm tiền
                </th>
                <th className="px-4 py-3 text-right font-black" scope="col">
                  RPM thủ công
                </th>
                <th className="px-5 py-3 text-right font-black" scope="col">
                  Ước tính kỳ này
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monetizedChannels.map((channel) => (
                <tr key={channel.channelId}>
                  <td className="px-5 py-4 font-bold text-slate-950">{channel.channelTitle}</td>
                  <td className="px-4 py-4 text-slate-600">Đã bật kiếm tiền</td>
                  <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">
                    {channel.rpmUsd === null ? "0 USD" : formatUsd(channel.rpmUsd)}
                  </td>
                  <td className="px-5 py-4 text-right font-black tabular-nums text-slate-950">
                    {channelRevenueLabel(channel)}
                    {channel.status === "UNAVAILABLE" ? (
                      <span className="mt-1 block text-[10px] font-medium text-amber-700">
                        chưa có dữ liệu kỳ này
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loading ? null : (
        <p className="px-5 py-6 text-sm text-slate-500">
          Chưa có kênh đã bật kiếm tiền trong phạm vi đang chọn.
        </p>
      )}

      {data ? (
        <div className="border-t border-slate-100 px-5 py-6 sm:px-7">
          <div className="mb-4">
            <h3 className="text-lg font-black text-slate-950">Diễn biến doanh thu theo ngày</h3>
            <p className="mt-1 text-sm text-slate-500">
              Số 0 chỉ là giá trị hiển thị cho ngày chưa có dữ liệu. Database vẫn giữ NULL và biểu
              đồ không nối các điểm thiếu thành lịch sử giả.
            </p>
          </div>
          <RevenueTimeline data={data} />
        </div>
      ) : null}
    </section>
  );
}
