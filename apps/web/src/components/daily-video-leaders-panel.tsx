import type { DailyVideoLeadersResponse } from "@yt-monitor/shared";

const numberFormatter = new Intl.NumberFormat("vi-VN");

function formatInteger(value: string): string {
  return numberFormatter.format(BigInt(value));
}

function channelDeltaLabel(value: string | null): string {
  if (value === null) return "Kênh chưa xác định";
  return `Kênh ${BigInt(value) > 0n ? "+" : ""}${formatInteger(value)}`;
}

function emptyMessage(data: DailyVideoLeadersResponse | null, failed: boolean): string {
  if (failed) return "Không thể tải bảng tăng view theo ngày; các metric khác vẫn độc lập.";
  if (data?.coverageStatus === "WARMING_UP") {
    return "Cần hai lần quét catalog thật ở hai ngày liên tiếp trước khi so sánh.";
  }
  if (data?.warnings.includes("CHANNEL_DAILY_VIEWS_UNAVAILABLE")) {
    return "Chưa có dữ liệu lượt xem ngày đáng tin cậy cho toàn bộ phạm vi đã chọn.";
  }
  if (data?.warnings.includes("NO_POSITIVE_DAILY_GAIN")) {
    return "Chưa có kênh tăng view dương trong ngày đã đo.";
  }
  if (data?.coverageStatus === "PARTIAL") {
    return "Một số kênh chưa có catalog đủ để xác định mức tăng view video.";
  }
  return "Chưa có video đủ hai snapshot catalog để so sánh.";
}

export function DailyVideoLeadersPanel({
  data,
  loading,
  failed,
}: {
  data: DailyVideoLeadersResponse | null;
  loading: boolean;
  failed: boolean;
}) {
  const heading =
    data?.coverageStatus === "COMPLETE"
      ? "Video dẫn đầu tăng view trong ngày"
      : "So sánh tăng view video theo ngày";

  return (
    <article className="surface-card" aria-labelledby="daily-video-leaders-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="eyebrow">Daily contribution feed</p>
          <h2 id="daily-video-leaders-title" className="mt-1 text-xl font-black text-slate-950">
            {heading}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Mỗi kênh chỉ hiện video có mức tăng view công khai cao nhất giữa hai catalog hằng ngày;
            đây không phải danh sách video mới đăng.
          </p>
        </div>
        {data ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {data.channelsWithComparableCatalog}/{data.totalChannels} kênh so sánh được
          </span>
        ) : null}
      </div>

      {data?.items.length ? (
        <ul className="mt-5 divide-y divide-slate-100">
          {data.items.map((item) => (
            <li className="flex gap-4 py-4 first:pt-0 last:pb-0" key={item.videoId}>
              {item.thumbnail ? (
                <img
                  className="h-16 w-28 shrink-0 rounded-xl object-cover"
                  src={item.thumbnail}
                  alt=""
                />
              ) : (
                <div className="grid h-16 w-28 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500">
                  YouTube
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">
                    #{item.rank}
                  </span>
                </div>
                <a
                  className="mt-2 line-clamp-2 block font-bold text-slate-900 hover:text-sky-700"
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.youtubeVideoId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title ?? item.youtubeVideoId}
                </a>
                <p className="mt-1 text-xs text-slate-500">
                  {item.channelTitle} · {channelDeltaLabel(item.channelViewDelta)} · đóng góp{" "}
                  {item.contributionPercent === null
                    ? "chưa xác định"
                    : `${item.contributionPercent}%`}
                </p>
              </div>
              <p className="shrink-0 text-right text-sm font-black tabular-nums text-emerald-700">
                +{formatInteger(item.videoViewDelta)} view/ngày
              </p>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p className="mt-5 text-sm font-semibold text-sky-800" role="status">
          Đang so sánh catalog video hằng ngày…
        </p>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          {emptyMessage(data, failed)}
        </p>
      )}
    </article>
  );
}
