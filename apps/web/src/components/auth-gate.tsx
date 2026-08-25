"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { useAuth } from "../lib/auth-context";

function LoadingState() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <p role="status" className="text-sm font-medium text-slate-600">
        Đang kiểm tra phiên đăng nhập…
      </p>
    </main>
  );
}

function BootstrapError({ retry }: Readonly<{ retry(): void }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
        <p role="alert" className="font-semibold text-rose-800">
          Không thể kiểm tra phiên đăng nhập. Dịch vụ có thể đang tạm thời gián đoạn.
        </p>
        <button className="button-primary mt-4" type="button" onClick={retry}>
          Thử lại
        </button>
      </section>
    </main>
  );
}

export function AuthGate({ children }: Readonly<{ children: ReactNode }>) {
  const { state, retryBootstrap } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [router, state.status]);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <BootstrapError retry={retryBootstrap} />;
  if (state.status === "anonymous") {
    return <p role="status">Đang chuyển đến trang đăng nhập…</p>;
  }
  return children;
}

export function LoginGate({ children }: Readonly<{ children: ReactNode }>) {
  const { state, retryBootstrap } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "authenticated") router.replace("/");
  }, [router, state.status]);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <BootstrapError retry={retryBootstrap} />;
  if (state.status === "authenticated") return <p role="status">Đang mở bảng điều khiển…</p>;
  return children;
}

export function AdminGate({ children }: Readonly<{ children: ReactNode }>) {
  const { state, retryBootstrap } = useAuth();
  const router = useRouter();
  const destination =
    state.status === "anonymous"
      ? "/login"
      : state.status === "authenticated" && state.user.role !== "ADMIN"
        ? "/"
        : null;

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <BootstrapError retry={retryBootstrap} />;
  if (state.status === "anonymous") return <p role="status">Đang chuyển đến đăng nhập…</p>;
  if (state.user.role !== "ADMIN") {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6" role="alert">
        Bạn không có quyền truy cập khu vực quản trị này.
      </section>
    );
  }
  return children;
}
