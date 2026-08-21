export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Phase 0</p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
        Giám sát YouTube
      </h1>
      <p className="max-w-2xl text-lg leading-8 text-slate-700">
        Nền tảng hệ thống đang hoạt động. Dữ liệu kênh và video sẽ chỉ xuất hiện sau khi các
        collector công khai được triển khai và tạo snapshot thật.
      </p>
      <a
        className="w-fit rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        href="/api/v1/health"
      >
        Xem trạng thái hệ thống
      </a>
    </main>
  );
}
