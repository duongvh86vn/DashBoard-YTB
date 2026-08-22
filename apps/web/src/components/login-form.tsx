"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { getVietnameseApiMessage } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

export function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const pendingRef = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await auth.login(email, password);
      setPassword("");
      router.replace("/");
    } catch (reason) {
      setError(getVietnameseApiMessage(reason, "login"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12">
      <div className="login-glow" aria-hidden="true" />
      <section className="relative w-full max-w-md rounded-3xl border border-white/80 bg-white/90 p-8 shadow-2xl shadow-slate-900/10 backdrop-blur">
        <div className="mb-8">
          <p className="eyebrow">YouTube Home Monitor</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Đăng nhập</h1>
          <p className="mt-3 leading-7 text-slate-600">
            Truy cập bảng điều khiển riêng tư bằng tài khoản do ADMIN cấp.
          </p>
        </div>

        <form className="space-y-5" onSubmit={submit}>
          <label className="field-label">
            <span>Email</span>
            <input
              className="field-input"
              type="text"
              inputMode="email"
              autoComplete="username"
              maxLength={320}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field-label">
            <span>Mật khẩu</span>
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? (
            <p className="alert-error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button className="button-primary w-full" type="submit" disabled={pending}>
            {pending ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          Hệ thống không hỗ trợ đăng ký công khai.
        </p>
      </section>
    </main>
  );
}
