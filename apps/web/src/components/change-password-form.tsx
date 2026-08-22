"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { getVietnameseApiMessage } from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

export function ChangePasswordForm({ onClose }: Readonly<{ onClose(): void }>) {
  const auth = useAuth();
  const router = useRouter();
  const pendingRef = useRef(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearAndClose() {
    setCurrentPassword("");
    setNewPassword("");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      router.replace("/login");
    } catch (reason) {
      if (auth.handleApiError(reason)) {
        setCurrentPassword("");
        setNewPassword("");
        router.replace("/login");
      } else {
        setError(getVietnameseApiMessage(reason, "change-password"));
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm leading-6 text-slate-600">
        Sau khi đổi mật khẩu, tất cả phiên đăng nhập sẽ bị thu hồi.
      </p>
      <label className="field-label">
        <span>Mật khẩu hiện tại</span>
        <input
          className="field-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label className="field-label">
        <span>Mật khẩu mới</span>
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      {error ? (
        <p className="alert-error" role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          className="button-secondary"
          type="button"
          onClick={clearAndClose}
          disabled={pending}
        >
          Hủy
        </button>
        <button className="button-primary" type="submit" disabled={pending}>
          {pending ? "Đang lưu…" : "Lưu mật khẩu mới"}
        </button>
      </div>
    </form>
  );
}
