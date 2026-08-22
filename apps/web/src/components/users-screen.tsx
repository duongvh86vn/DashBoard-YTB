"use client";

import type { PublicUser, UsersPage } from "@yt-monitor/shared/browser-auth";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  createViewer,
  deleteViewer,
  disableViewer,
  enableViewer,
  getVietnameseApiMessage,
  listViewers,
  resetViewerPassword,
  revokeViewerSessions,
  updateViewerEmail,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";

const PAGE_SIZE = 20;

type DialogAction =
  | { kind: "edit"; user: PublicUser }
  | { kind: "reset"; user: PublicUser }
  | { kind: "revoke"; user: PublicUser }
  | { kind: "disable"; user: PublicUser }
  | { kind: "delete"; user: PublicUser };

const dialogCopy = {
  edit: {
    title: "Đổi email",
    confirmation: "Lưu email",
    description: "Email sẽ được chuẩn hóa và kiểm tra trùng trên máy chủ.",
  },
  reset: {
    title: "Đặt lại mật khẩu",
    confirmation: "Xác nhận đặt lại mật khẩu",
    description: "Mật khẩu mới sẽ thu hồi tất cả phiên đăng nhập hiện tại của VIEWER.",
  },
  revoke: {
    title: "Thu hồi phiên đăng nhập",
    confirmation: "Xác nhận thu hồi phiên",
    description: "Bạn có chắc muốn thu hồi tất cả phiên đăng nhập của VIEWER này?",
  },
  disable: {
    title: "Vô hiệu hóa VIEWER",
    confirmation: "Xác nhận vô hiệu hóa",
    description: "VIEWER sẽ không thể đăng nhập và mọi phiên hiện tại sẽ bị thu hồi.",
  },
  delete: {
    title: "Xóa theo nghiệp vụ",
    confirmation: "Xác nhận vô hiệu hóa",
    description: "Thao tác này không xóa dữ liệu; tài khoản sẽ được vô hiệu hóa an toàn.",
  },
} as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(value));
}

export function UsersScreen() {
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<UsersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void listViewers({ page, pageSize: PAGE_SIZE, signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const offset = (page - 1) * PAGE_SIZE;
        if (page > 1 && response.items.length === 0 && response.total <= offset) {
          setPage(page - 1);
          return;
        }
        setData(response);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (!auth.handleApiError(reason)) setError(getVietnameseApiMessage(reason, "users"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [auth.handleApiError, page, refreshVersion]);

  function refresh() {
    setRefreshVersion((version) => version + 1);
  }

  function openDialog(next: DialogAction) {
    setError(null);
    setNotice(null);
    setDialogValue(next.kind === "edit" ? next.user.email : "");
    setDialog(next);
  }

  function closeDialog() {
    if (pendingRef.current) return;
    setDialogValue("");
    setDialog(null);
  }

  async function runMutation(
    work: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setDialogValue("");
      setDialog(null);
      setNotice(successMessage);
      refresh();
      return true;
    } catch (reason) {
      if (auth.handleApiError(reason)) {
        setDialogValue("");
        setDialog(null);
      } else {
        setError(getVietnameseApiMessage(reason, "users"));
      }
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await runMutation(
      () => createViewer({ email: createEmail, password: createPassword }),
      "Đã tạo tài khoản VIEWER.",
    );
    if (succeeded) {
      setCreateEmail("");
      setCreatePassword("");
    }
  }

  async function confirmDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    switch (dialog.kind) {
      case "edit":
        await runMutation(
          () => updateViewerEmail(dialog.user.id, dialogValue),
          "Đã cập nhật email VIEWER.",
        );
        return;
      case "reset":
        await runMutation(
          () => resetViewerPassword(dialog.user.id, dialogValue),
          "Đã đặt lại mật khẩu và thu hồi các phiên cũ.",
        );
        return;
      case "revoke":
        await runMutation(
          () => revokeViewerSessions(dialog.user.id),
          "Đã thu hồi tất cả phiên đăng nhập.",
        );
        return;
      case "disable":
        await runMutation(() => disableViewer(dialog.user.id), "Đã vô hiệu hóa tài khoản VIEWER.");
        return;
      case "delete":
        await runMutation(
          () => deleteViewer(dialog.user.id),
          "Đã vô hiệu hóa tài khoản qua thao tác xóa.",
        );
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Quản trị truy cập</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Người dùng</h1>
          <p className="mt-2 max-w-2xl leading-7 text-slate-600">
            Tạo và quản lý tài khoản VIEWER. Tài khoản ADMIN chỉ được khởi tạo qua môi trường.
          </p>
        </div>
        <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
          {data ? `${data.total} VIEWER` : "Đang tải"}
        </span>
      </header>

      <section className="surface-card">
        <h2 className="text-lg font-bold text-slate-950">Tạo VIEWER</h2>
        <form
          className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
          onSubmit={submitCreate}
        >
          <label className="field-label">
            <span>Email VIEWER mới</span>
            <input
              className="field-input"
              type="text"
              inputMode="email"
              autoComplete="off"
              maxLength={320}
              required
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
            />
          </label>
          <label className="field-label">
            <span>Mật khẩu VIEWER mới</span>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              required
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
          </label>
          <button className="button-primary" type="submit" disabled={pending}>
            {pending ? "Đang xử lý…" : "Tạo VIEWER"}
          </button>
        </form>
      </section>

      {error ? (
        <div
          className="alert-error flex flex-wrap items-center justify-between gap-3"
          role="alert"
          aria-live="assertive"
        >
          <span>{error}</span>
          <button className="button-secondary" type="button" onClick={refresh} disabled={pending}>
            Thử tải lại danh sách
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="alert-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <section className="surface-card" aria-busy={loading}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-950">Danh sách VIEWER</h2>
          {loading ? <span role="status">Đang tải danh sách…</span> : null}
        </div>

        {!loading && data?.items.length === 0 ? (
          <p className="mt-6 rounded-xl bg-slate-50 p-6 text-center text-slate-600">
            Chưa có tài khoản VIEWER.
          </p>
        ) : null}

        {data && data.items.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="table-cell">Email</th>
                  <th className="table-cell">Trạng thái</th>
                  <th className="table-cell">Ngày tạo</th>
                  <th className="table-cell">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100 align-top">
                    <td className="table-cell font-medium text-slate-950">{user.email}</td>
                    <td className="table-cell">
                      <span className={user.isEnabled ? "status-enabled" : "status-disabled"}>
                        {user.isEnabled ? "Đang hoạt động" : "Đã vô hiệu hóa"}
                      </span>
                    </td>
                    <td className="table-cell text-slate-600">{formatDate(user.createdAt)}</td>
                    <td className="table-cell">
                      <div className="flex min-w-[28rem] flex-wrap gap-2">
                        <button
                          className="button-table"
                          type="button"
                          onClick={() => openDialog({ kind: "edit", user })}
                          disabled={pending}
                        >
                          <span aria-hidden="true">Đổi email</span>
                          <span className="sr-only">Đổi email của {user.email}</span>
                        </button>
                        <button
                          className="button-table"
                          type="button"
                          onClick={() => openDialog({ kind: "reset", user })}
                          disabled={pending}
                          aria-label={`Đặt lại mật khẩu của ${user.email}`}
                        >
                          Đặt lại mật khẩu
                        </button>
                        <button
                          className="button-table"
                          type="button"
                          onClick={() => openDialog({ kind: "revoke", user })}
                          disabled={pending}
                          aria-label={`Thu hồi phiên của ${user.email}`}
                        >
                          Thu hồi phiên
                        </button>
                        {user.isEnabled ? (
                          <button
                            className="button-table-danger"
                            type="button"
                            onClick={() => openDialog({ kind: "disable", user })}
                            disabled={pending}
                            aria-label={`Vô hiệu hóa ${user.email}`}
                          >
                            Vô hiệu hóa
                          </button>
                        ) : (
                          <button
                            className="button-table"
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void runMutation(
                                () => enableViewer(user.id),
                                "Đã kích hoạt lại tài khoản VIEWER.",
                              )
                            }
                            aria-label={`Kích hoạt ${user.email}`}
                          >
                            Kích hoạt
                          </button>
                        )}
                        <button
                          className="button-table-danger"
                          type="button"
                          onClick={() => openDialog({ kind: "delete", user })}
                          disabled={pending}
                          aria-label={`Xóa (vô hiệu hóa) ${user.email}`}
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-100 pt-5">
          <button
            className="button-secondary"
            type="button"
            disabled={page <= 1 || pending}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Trang trước
          </button>
          <span className="text-sm font-medium text-slate-600">Trang {page}</span>
          <button
            className="button-secondary"
            type="button"
            disabled={!data || page * PAGE_SIZE >= data.total || pending}
            onClick={() => setPage((current) => current + 1)}
          >
            Trang sau
          </button>
        </div>
      </section>

      {dialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeDialog();
          }}
        >
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="viewer-dialog-title"
          >
            <h2 id="viewer-dialog-title" className="text-xl font-bold text-slate-950">
              {dialogCopy[dialog.kind].title}
            </h2>
            <p className="mt-3 text-sm font-medium text-slate-700">{dialog.user.email}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {dialogCopy[dialog.kind].description}
            </p>
            <form className="mt-5 space-y-4" onSubmit={confirmDialog}>
              {dialog.kind === "edit" ? (
                <label className="field-label">
                  <span>Email mới</span>
                  <input
                    className="field-input"
                    type="text"
                    maxLength={320}
                    required
                    autoFocus
                    value={dialogValue}
                    onChange={(event) => setDialogValue(event.target.value)}
                  />
                </label>
              ) : null}
              {dialog.kind === "reset" ? (
                <label className="field-label">
                  <span>Mật khẩu mới</span>
                  <input
                    className="field-input"
                    type="password"
                    autoComplete="new-password"
                    required
                    autoFocus
                    value={dialogValue}
                    onChange={(event) => setDialogValue(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  className="button-secondary"
                  type="button"
                  autoFocus={dialog.kind !== "edit" && dialog.kind !== "reset"}
                  onClick={closeDialog}
                  disabled={pending}
                >
                  Hủy
                </button>
                <button
                  className={
                    dialog.kind === "disable" || dialog.kind === "delete"
                      ? "button-danger"
                      : "button-primary"
                  }
                  type="submit"
                  disabled={pending}
                >
                  {pending ? "Đang xử lý…" : dialogCopy[dialog.kind].confirmation}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
