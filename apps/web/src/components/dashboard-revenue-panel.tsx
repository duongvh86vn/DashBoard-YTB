import type { DashboardRevenueChannel, DashboardRevenueResponse } from "@yt-monitor/shared";

type DashboardRevenuePoint = DashboardRevenueResponse["series"][number];

function formatUsd(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction] = match;
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${sign}${grouped}${fraction ? `,${fraction}` : ""} USD`;
}

function channelMonetizationLabel(channel: DashboardRevenueChannel): string {
  if (channel.monetizationStatus === "ENABLED") return "Đã bật kiếm tiền";
  if (channel.monetizationStatus === "DISABLED") return "Chưa bật kiếm tiền";
  return "Chưa cấu hình";
}

function channelRevenueLabel(channel: DashboardRevenueChannel): string {
  if (channel.status === "COMPLETE" && channel.totalEstimatedRevenueUsd !== null) {
    return formatUsd(channel.totalEstimatedRevenueUsd);
  }
  if (channel.status === "PARTIAL" && channel.observedEstimatedRevenueUsd !== null) {
    return `Quan sát ${formatUsd(channel.observedEstimatedRevenueUsd)}`;
  }
  return "Chưa biết";
}

function pointRevenueLabel(point: DashboardRevenuePoint): string {
  if (point.status === "COMPLETE" && point.totalEstimatedRevenueUsd !== null) {
    return `Tổng: ${formatUsd(point.totalEstimatedRevenueUsd)}`;
  }
  if (point.status === "PARTIAL" && point.observedEstimatedRevenueUsd !== null) {
    return `Phần đã quan sát: ${formatUsd(point.observedEstimatedRevenueUsd)}`;
  }
  return "Chưa biết (khoảng trống dữ liệu)";
}

function pointCoverageLabel(point: DashboardRevenuePoint): string {
  return `${point.status} · ${point.coveredChannels}/${point.totalChannels} kênh có dữ liệu`;
}

function pointMagnitude(point: DashboardRevenuePoint): number {
  const value =
    point.status === "COMPLETE"
      ? point.totalEstimatedRevenueUsd
      : point.status === "PARTIAL"
        ? point.observedEstimatedRevenueUsd
        : null;
  if (value === null) return 0;
  const magnitude = Math.abs(Number(value));
  return Number.isFinite(magnitude) ? magnitude : 0;
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
        : "Chưa đủ dữ liệu để ước tính";
  const maximumMagnitude = data ? Math.max(...data.series.map(pointMagnitude), 0) : 0;

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
          Không thể tải ước tính doanh thu; hệ thống không thay số thiếu bằng 0.
        </p>
      ) : data?.channels.length ? (
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
              {data.channels.map((channel) => (
                <tr key={channel.channelId}>
                  <td className="px-5 py-4 font-bold text-slate-950">{channel.channelTitle}</td>
                  <td className="px-4 py-4 text-slate-600">{channelMonetizationLabel(channel)}</td>
                  <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-700">
                    {channel.rpmUsd === null ? "—" : formatUsd(channel.rpmUsd)}
                  </td>
                  <td className="px-5 py-4 text-right font-black tabular-nums text-slate-950">
                    {channelRevenueLabel(channel)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loading ? null : (
        <p className="px-5 py-6 text-sm text-slate-500">
          Chưa có kênh trong phạm vi đang chọn để tính doanh thu.
        </p>
      )}

      {data ? (
        <div className="border-t border-slate-100 px-5 py-6 sm:px-7">
          <div className="mb-4">
            <h3 className="text-lg font-black text-slate-950">Diễn biến doanh thu theo ngày</h3>
            <p className="mt-1 text-sm text-slate-500">
              Mỗi ngày giữ nguyên trạng thái dữ liệu và giá trị ước tính từ RPM thủ công.
            </p>
          </div>
          {data.series.length ? (
            <ol aria-label="Dòng thời gian doanh thu ước tính theo ngày" className="space-y-3">
              {data.series.map((point, index) => {
                const magnitude = pointMagnitude(point);
                const width =
                  maximumMagnitude === 0
                    ? 0
                    : Math.max(4, Math.round((magnitude / maximumMagnitude) * 100));
                const value =
                  point.status === "COMPLETE"
                    ? point.totalEstimatedRevenueUsd
                    : point.status === "PARTIAL"
                      ? point.observedEstimatedRevenueUsd
                      : null;
                const isNegative = value?.startsWith("-") ?? false;

                return (
                  <li
                    key={`${point.date}-${index}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <time
                          className="font-bold tabular-nums text-slate-950"
                          dateTime={point.date}
                        >
                          {point.date}
                        </time>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {pointCoverageLabel(point)}
                        </p>
                      </div>
                      <p className="font-black tabular-nums text-slate-950">
                        {pointRevenueLabel(point)}
                      </p>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
                    >
                      <div
                        className={`h-full rounded-full ${
                          isNegative ? "bg-rose-500" : "bg-emerald-500"
                        }`}
                        style={{
                          marginLeft: isNegative ? `${100 - width}%` : undefined,
                          width: `${width}%`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Chưa có điểm dữ liệu theo ngày trong kỳ đang chọn.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
