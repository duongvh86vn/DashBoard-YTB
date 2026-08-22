export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="eyebrow">Phase 1 · Truy cập an toàn</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Tổng quan
        </h1>
        <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-600">
          Đăng nhập và quản trị người dùng đã sẵn sàng cho ADMIN và VIEWER.
        </p>
      </header>

      <section className="grid gap-5 md:grid-cols-2">
        <article className="surface-card border-l-4 border-l-emerald-500">
          <p className="text-sm font-semibold text-emerald-700">Đã sẵn sàng</p>
          <h2 className="mt-2 text-xl font-bold text-slate-950">Xác thực và phân quyền</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Phiên đăng nhập được quản lý phía máy chủ. ADMIN có thể quản trị VIEWER; VIEWER chỉ có
            quyền đọc.
          </p>
        </article>
        <article className="surface-card border-l-4 border-l-sky-500">
          <p className="text-sm font-semibold text-sky-700">Sắp triển khai</p>
          <h2 className="mt-2 text-xl font-bold text-slate-950">Dữ liệu giám sát thực</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Thu thập kênh và video, snapshot lịch sử cùng các số liệu giám sát sẽ được triển khai
            trong các giai đoạn tiếp theo.
          </p>
        </article>
      </section>

      <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        Bảng này chưa hiển thị số liệu kênh hoặc video vì collector công khai chưa thuộc phạm vi
        Phase 1. Hệ thống sẽ chỉ hiển thị metric sau khi có snapshot thật từ máy chủ.
      </aside>
    </div>
  );
}
