"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { getVietnameseApiMessage } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";
import { AccessibleDialog } from "./accessible-dialog";
import { ChangePasswordForm } from "./change-password-form";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pendingRef = useRef(false);
  const passwordTriggerRef = useRef<HTMLButtonElement>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.state.status !== "authenticated") return null;
  const user = auth.state.user;

  async function signOut() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLogoutPending(true);
    setError(null);
    try {
      await auth.logout();
      router.replace("/login");
    } catch (reason) {
      if (auth.handleApiError(reason)) router.replace("/login");
      else setError(getVietnameseApiMessage(reason));
    } finally {
      pendingRef.current = false;
      setLogoutPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 bg-slate-950 px-5 py-6 text-white lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-500 font-black">
            YT
          </span>
          <div>
            <p className="font-bold tracking-tight">YouTube Monitor</p>
            <p className="text-xs text-slate-400">Không gian riêng tư</p>
          </div>
        </div>

        <nav className="mt-8 flex gap-2 lg:flex-col" aria-label="Điều hướng chính">
          <Link className={pathname === "/" ? "nav-link nav-link-active" : "nav-link"} href="/">
            Tổng quan
          </Link>
          {user.role === "ADMIN" ? (
            <Link
              className={pathname === "/users" ? "nav-link nav-link-active" : "nav-link"}
              href="/users"
            >
              Người dùng
            </Link>
          ) : null}
          <Link
            className={pathname.startsWith("/channels") ? "nav-link nav-link-active" : "nav-link"}
            href="/channels"
          >
            Kênh theo dõi
          </Link>
        </nav>

        <div className="mt-8 border-t border-slate-800 pt-5 lg:mt-auto">
          <p className="truncate text-sm font-medium">{user.email}</p>
          <p className="mt-1 text-xs text-slate-400">
            {user.role === "ADMIN" ? "Quản trị viên" : "Người xem"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              ref={passwordTriggerRef}
              className="button-dark-secondary"
              type="button"
              onClick={() => {
                setPasswordPending(false);
                setPasswordOpen(true);
              }}
            >
              Đổi mật khẩu
            </button>
            <button
              className="button-dark-secondary"
              type="button"
              onClick={() => void signOut()}
              disabled={logoutPending}
            >
              {logoutPending ? "Đang thoát…" : "Đăng xuất"}
            </button>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-rose-300" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>

      {passwordOpen ? (
        <AccessibleDialog
          labelledBy="change-password-title"
          closeDisabled={passwordPending}
          onClose={() => setPasswordOpen(false)}
          returnFocusRef={passwordTriggerRef}
        >
          <h2 id="change-password-title" className="text-xl font-bold text-slate-950">
            Đổi mật khẩu
          </h2>
          <div className="mt-4">
            <ChangePasswordForm
              onClose={() => setPasswordOpen(false)}
              onPendingChange={setPasswordPending}
            />
          </div>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
