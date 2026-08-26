"use client";

import type { ChannelGroupDetail, ChannelGroupSummary } from "@yt-monitor/shared";
import type { PublicChannel } from "@yt-monitor/shared/browser-auth";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  archiveChannelGroup,
  createChannelGroup,
  getChannelGroup,
  getVietnameseApiMessage,
  listChannelGroups,
  listChannels,
  replaceChannelGroupChannels,
  updateChannelGroup,
} from "../lib/api-client";
import { useAuth } from "../lib/auth-context";
import { AccessibleDialog } from "./accessible-dialog";

async function listAllChannels(signal: AbortSignal): Promise<PublicChannel[]> {
  const items: PublicChannel[] = [];
  let page = 1;
  while (true) {
    const response = await listChannels({ page, pageSize: 100, signal });
    items.push(...response.items);
    if (items.length >= response.total || response.items.length === 0) return items;
    page += 1;
  }
}

export function ChannelGroupsScreen() {
  const auth = useAuth();
  const [groups, setGroups] = useState<ChannelGroupSummary[]>([]);
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogTriggerRef = useRef<HTMLButtonElement>(null);
  const [managed, setManaged] = useState<ChannelGroupDetail | null>(null);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageName, setManageName] = useState("");
  const [manageDescription, setManageDescription] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ChannelGroupSummary | null>(null);

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([listChannelGroups(controller.signal), listAllChannels(controller.signal)])
      .then(([groupResponse, channelItems]) => {
        if (controller.signal.aborted) return;
        setGroups(groupResponse.items);
        setChannels(channelItems);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (!auth.handleApiError(reason)) setError(getVietnameseApiMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [auth.handleApiError, refreshVersion]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await createChannelGroup({ name, description: description.trim() || null });
      setName("");
      setDescription("");
      setNotice("Đã tạo nhóm kênh.");
      refresh();
    } catch (reason) {
      if (!auth.handleApiError(reason)) setError(getVietnameseApiMessage(reason));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function openManage(group: ChannelGroupSummary, trigger: HTMLButtonElement) {
    dialogTriggerRef.current = trigger;
    setManageLoading(true);
    setError(null);
    setDialogError(null);
    try {
      const detail = await getChannelGroup(group.id);
      setManaged(detail);
      setManageName(detail.name);
      setManageDescription(detail.description ?? "");
      setSelectedChannelIds(detail.channelIds);
    } catch (reason) {
      if (!auth.handleApiError(reason)) setError(getVietnameseApiMessage(reason));
    } finally {
      setManageLoading(false);
    }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managed || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    try {
      const updated = await updateChannelGroup(managed.id, {
        name: manageName,
        description: manageDescription.trim() || null,
      });
      setManaged(updated);
      setGroups((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("Đã cập nhật thông tin nhóm.");
    } catch (reason) {
      if (!auth.handleApiError(reason)) setDialogError(getVietnameseApiMessage(reason));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function saveChannels() {
    if (!managed || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    try {
      const updated = await replaceChannelGroupChannels(managed.id, selectedChannelIds);
      setManaged(updated);
      setGroups((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("Đã thay thế toàn bộ danh sách kênh của nhóm.");
    } catch (reason) {
      if (!auth.handleApiError(reason)) setDialogError(getVietnameseApiMessage(reason));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function confirmArchive() {
    if (!archiveTarget || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    try {
      await archiveChannelGroup(archiveTarget.id);
      setGroups((items) => items.filter((item) => item.id !== archiveTarget.id));
      setArchiveTarget(null);
      setNotice("Đã lưu trữ nhóm kênh.");
    } catch (reason) {
      if (!auth.handleApiError(reason)) setDialogError(getVietnameseApiMessage(reason));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header>
        <p className="eyebrow">Phân vùng truy cập</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Nhóm kênh</h1>
        <p className="mt-2 max-w-3xl leading-7 text-slate-600">
          Gom nhiều kênh thành nhóm và cấp một hoặc nhiều nhóm cho từng VIEWER.
        </p>
      </header>

      <section className="surface-card">
        <h2 className="text-lg font-bold text-slate-950">Tạo nhóm mới</h2>
        <form
          className="mt-4 grid gap-4 md:grid-cols-[1fr_1.5fr_auto] md:items-end"
          onSubmit={submitCreate}
        >
          <label className="field-label">
            <span>Tên nhóm mới</span>
            <input
              className="field-input"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field-label">
            <span>Mô tả</span>
            <input
              className="field-input"
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button className="button-primary" type="submit" disabled={pending}>
            Tạo nhóm
          </button>
        </form>
      </section>

      {error ? (
        <div className="alert-error flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button className="button-secondary" type="button" onClick={refresh} disabled={pending}>
            Thử tải lại
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="alert-success" role="status">
          {notice}
        </p>
      ) : null}

      <section className="surface-card" aria-busy={loading || manageLoading}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-950">Nhóm đang hoạt động</h2>
          {loading ? <span role="status">Đang tải nhóm kênh…</span> : null}
        </div>
        {!loading && groups.length === 0 ? (
          <p className="mt-5 rounded-xl bg-slate-50 p-6 text-center text-slate-600">
            Chưa có nhóm kênh.
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <article className="rounded-2xl border border-slate-200 p-5" key={group.id}>
              <h3 className="text-lg font-bold text-slate-950">{group.name}</h3>
              <p className="mt-2 min-h-12 text-sm text-slate-600">
                {group.description ?? "Không có mô tả."}
              </p>
              <p className="mt-3 text-sm font-medium text-slate-700">
                {group.channelCount} kênh · {group.viewerCount} VIEWER
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="button-table"
                  type="button"
                  disabled={pending || manageLoading}
                  onClick={(event) => void openManage(group, event.currentTarget)}
                >
                  Quản lý {group.name}
                </button>
                <button
                  className="button-table-danger"
                  type="button"
                  disabled={pending}
                  onClick={(event) => {
                    dialogTriggerRef.current = event.currentTarget;
                    setDialogError(null);
                    setArchiveTarget(group);
                  }}
                >
                  Lưu trữ {group.name}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {managed ? (
        <AccessibleDialog
          labelledBy="manage-group-title"
          closeDisabled={pending}
          onClose={() => setManaged(null)}
          returnFocusRef={dialogTriggerRef}
        >
          <h2 id="manage-group-title" className="text-xl font-bold text-slate-950">
            Quản lý nhóm {managed.name}
          </h2>
          <form className="mt-5 space-y-4" onSubmit={saveMetadata}>
            <label className="field-label">
              <span>Tên nhóm</span>
              <input
                className="field-input"
                required
                maxLength={120}
                value={manageName}
                onChange={(event) => setManageName(event.target.value)}
              />
            </label>
            <label className="field-label">
              <span>Mô tả</span>
              <textarea
                className="field-input min-h-24"
                maxLength={1000}
                value={manageDescription}
                onChange={(event) => setManageDescription(event.target.value)}
              />
            </label>
            <button className="button-primary" type="submit" disabled={pending}>
              Lưu thông tin
            </button>
          </form>
          <fieldset className="mt-6 border-t border-slate-200 pt-5">
            <legend className="font-bold text-slate-950">Kênh trong nhóm</legend>
            <p className="mt-1 text-sm text-slate-600">Bỏ chọn tất cả để tạo nhóm chưa có kênh.</p>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {channels.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  Chưa có kênh đang hoạt động để thêm vào nhóm.
                </p>
              ) : null}
              {channels.map((channel) => (
                <label
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"
                  key={channel.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedChannelIds.includes(channel.id)}
                    onChange={(event) =>
                      setSelectedChannelIds((ids) =>
                        event.target.checked
                          ? [...ids, channel.id]
                          : ids.filter((id) => id !== channel.id),
                      )
                    }
                  />
                  <span>{channel.title}</span>
                </label>
              ))}
            </div>
            <button
              className="button-primary mt-4"
              type="button"
              disabled={pending}
              onClick={() => void saveChannels()}
            >
              Lưu danh sách kênh
            </button>
          </fieldset>
          {dialogError ? (
            <p className="alert-error mt-4" role="alert">
              {dialogError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end">
            <button
              className="button-secondary"
              type="button"
              disabled={pending}
              onClick={() => setManaged(null)}
            >
              Đóng
            </button>
          </div>
        </AccessibleDialog>
      ) : null}

      {archiveTarget ? (
        <AccessibleDialog
          labelledBy="archive-group-title"
          closeDisabled={pending}
          onClose={() => setArchiveTarget(null)}
          returnFocusRef={dialogTriggerRef}
        >
          <h2 id="archive-group-title" className="text-xl font-bold text-slate-950">
            Lưu trữ nhóm kênh
          </h2>
          <p className="mt-3 text-slate-600">
            VIEWER sẽ mất quyền qua nhóm “{archiveTarget.name}”. Bạn có chắc muốn tiếp tục?
          </p>
          {dialogError ? (
            <p className="alert-error mt-4" role="alert">
              {dialogError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="button-secondary"
              type="button"
              disabled={pending}
              onClick={() => setArchiveTarget(null)}
            >
              Hủy
            </button>
            <button
              className="button-danger"
              type="button"
              disabled={pending}
              onClick={() => void confirmArchive()}
            >
              Xác nhận lưu trữ
            </button>
          </div>
        </AccessibleDialog>
      ) : null}
    </div>
  );
}
