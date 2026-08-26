import type {
  AppendAuditLogInput,
  ChannelGroupAggregateRecord,
  ChannelRepositories,
} from "@yt-monitor/db";
import { ChannelGroupMembershipTargetError } from "@yt-monitor/db";
import { describe, expect, it, vi } from "vitest";

import { ChannelGroupsService } from "./channel-groups.service.js";

const GROUP_ID = "00000000-0000-4000-8000-000000000001";
const VIEWER_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN_ID = "00000000-0000-4000-8000-000000000003";
const CHANNEL_ID = "00000000-0000-4000-8000-000000000004";
const SECOND_CHANNEL_ID = "00000000-0000-4000-8000-000000000005";
const NEW_GROUP_ID = "00000000-0000-4000-8000-000000000006";
const EMPTY_GROUP_ID = "00000000-0000-4000-8000-000000000007";
const ARCHIVED_GROUP_ID = "00000000-0000-4000-8000-000000000008";
const MISSING_GROUP_ID = "00000000-0000-4000-8000-000000000009";
const ARCHIVED_CHANNEL_ID = "00000000-0000-4000-8000-000000000010";
const MISSING_CHANNEL_ID = "00000000-0000-4000-8000-000000000011";

function group(overrides: Partial<ChannelGroupAggregateRecord> = {}): ChannelGroupAggregateRecord {
  return {
    id: GROUP_ID,
    name: "Truyện audio",
    slug: "truyen-audio",
    description: null,
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    updatedAt: new Date("2026-08-26T00:00:00.000Z"),
    archivedAt: null,
    channelIds: [CHANNEL_ID],
    viewerIds: [VIEWER_ID],
    ...overrides,
  };
}

function serviceWith(
  channelGroups: Record<string, unknown>,
  channels: Record<string, unknown> = {},
) {
  return new ChannelGroupsService({
    unitOfWork: {
      transaction: async <T>(work: (repositories: ChannelRepositories) => Promise<T>) =>
        work({
          channelGroups,
          channels,
          audit: { append: async () => ({}) },
        } as unknown as ChannelRepositories),
    },
    now: () => new Date("2026-08-26T08:00:00.000Z"),
  });
}

function cloneGroup(record: ChannelGroupAggregateRecord): ChannelGroupAggregateRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    archivedAt: record.archivedAt === null ? null : new Date(record.archivedAt),
    channelIds: [...record.channelIds],
    viewerIds: [...record.viewerIds],
  };
}

function createTransactionalHarness(options: { rejectAudit?: boolean } = {}) {
  let storedGroups = [group()];
  let storedAudits: AppendAuditLogInput[] = [];

  const unitOfWork = {
    async transaction<T>(work: (repositories: ChannelRepositories) => Promise<T>): Promise<T> {
      let transactionGroups = storedGroups.map(cloneGroup);
      const transactionAudits = structuredClone(storedAudits) as AppendAuditLogInput[];
      const repositories = {
        channelGroups: {
          async create(input: { name: string; slug: string; description: string | null }) {
            const created = group({
              id: NEW_GROUP_ID,
              name: input.name,
              slug: input.slug,
              description: input.description,
              channelIds: [],
              viewerIds: [],
            });
            transactionGroups.push(created);
            return cloneGroup(created);
          },
          async update(
            id: string,
            input: { name?: string; slug?: string; description?: string | null },
          ) {
            const current = transactionGroups.find((record) => record.id === id)!;
            const updated = cloneGroup({
              ...current,
              ...input,
              updatedAt: new Date("2026-08-26T08:00:00.000Z"),
            });
            transactionGroups = transactionGroups.map((record) =>
              record.id === id ? updated : record,
            );
            return cloneGroup(updated);
          },
          async archive(id: string, archivedAt: Date) {
            transactionGroups = transactionGroups.map((record) =>
              record.id === id ? cloneGroup({ ...record, archivedAt }) : record,
            );
          },
          async replaceChannels(groupId: string, channelIds: readonly string[]) {
            transactionGroups = transactionGroups.map((record) =>
              record.id === groupId
                ? cloneGroup({ ...record, channelIds: [...channelIds] })
                : record,
            );
          },
          async findActiveById(id: string) {
            const found = transactionGroups.find(
              (record) => record.id === id && record.archivedAt === null,
            );
            return found ? cloneGroup(found) : null;
          },
          async replaceViewerGroups(input: {
            userId: string;
            groupIds: readonly string[];
            assignedByUserId: string;
          }) {
            transactionGroups = transactionGroups.map((record) => ({
              ...cloneGroup(record),
              viewerIds: record.viewerIds.filter((id) => id !== input.userId),
            }));
            transactionGroups = transactionGroups.map((record) =>
              input.groupIds.includes(record.id)
                ? cloneGroup({ ...record, viewerIds: [...record.viewerIds, input.userId] })
                : record,
            );
          },
        },
        audit: {
          async append(input: AppendAuditLogInput) {
            if (options.rejectAudit) throw new Error("forced audit failure");
            transactionAudits.push(structuredClone(input));
            return { id: "audit-id", createdAt: new Date(), ...input };
          },
        },
      } as unknown as ChannelRepositories;

      const result = await work(repositories);
      storedGroups = transactionGroups.map(cloneGroup);
      storedAudits = structuredClone(transactionAudits) as AppendAuditLogInput[];
      return result;
    },
  };

  return {
    service: new ChannelGroupsService({
      unitOfWork,
      now: () => new Date("2026-08-26T08:00:00.000Z"),
    }),
    get groups() {
      return storedGroups.map(cloneGroup);
    },
    get audits() {
      return structuredClone(storedAudits) as AppendAuditLogInput[];
    },
  };
}

describe("ChannelGroupsService", () => {
  it("keeps ADMIN unrestricted and resolves a VIEWER union on every request", async () => {
    const accessibleChannelIdsForUser = vi.fn(async () => [CHANNEL_ID]);
    const service = serviceWith({ accessibleChannelIdsForUser });

    await expect(
      service.resolveVisibleChannelIds({ id: ADMIN_ID, role: "ADMIN" }),
    ).resolves.toBeNull();
    await expect(
      service.resolveVisibleChannelIds({ id: VIEWER_ID, role: "VIEWER" }),
    ).resolves.toEqual([CHANNEL_ID]);
    expect(accessibleChannelIdsForUser).toHaveBeenCalledExactlyOnceWith(VIEWER_ID);
  });

  it("uses active assignments for accessible group summaries", async () => {
    const listAccessibleForUser = vi.fn(async () => [group()]);
    const service = serviceWith({ listAccessibleForUser });

    await expect(
      service.listAccessible({ subject: { id: VIEWER_ID, role: "VIEWER" } }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: GROUP_ID,
          channelCount: 1,
          viewerCount: 1,
        }),
      ],
    });
    expect(listAccessibleForUser).toHaveBeenCalledExactlyOnceWith(VIEWER_ID);
  });

  it.each([
    ["ADMIN no filter", { id: ADMIN_ID, role: "ADMIN" as const }, {}, null],
    [
      "VIEWER no filter",
      { id: VIEWER_ID, role: "VIEWER" as const },
      {},
      [CHANNEL_ID, SECOND_CHANNEL_ID],
    ],
    [
      "ADMIN active direct channel",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { channelId: CHANNEL_ID },
      [CHANNEL_ID],
    ],
    [
      "VIEWER active direct channel",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { channelId: CHANNEL_ID },
      [CHANNEL_ID],
    ],
    [
      "VIEWER assigned empty group",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { groupId: EMPTY_GROUP_ID },
      [],
    ],
    [
      "ADMIN active group",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { groupId: GROUP_ID },
      [CHANNEL_ID],
    ],
    [
      "VIEWER assigned group",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { groupId: GROUP_ID },
      [CHANNEL_ID],
    ],
    [
      "VIEWER matching group and channel",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { groupId: GROUP_ID, channelId: CHANNEL_ID },
      [CHANNEL_ID],
    ],
    [
      "missing group",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { groupId: MISSING_GROUP_ID },
      "NOT_FOUND",
    ],
    [
      "archived group",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { groupId: ARCHIVED_GROUP_ID },
      "NOT_FOUND",
    ],
    [
      "unassigned group",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { groupId: NEW_GROUP_ID },
      "NOT_FOUND",
    ],
    [
      "missing direct channel",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { channelId: MISSING_CHANNEL_ID },
      "NOT_FOUND",
    ],
    [
      "archived direct channel",
      { id: ADMIN_ID, role: "ADMIN" as const },
      { channelId: ARCHIVED_CHANNEL_ID },
      "NOT_FOUND",
    ],
    [
      "unauthorized direct channel",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { channelId: ARCHIVED_CHANNEL_ID },
      "NOT_FOUND",
    ],
    [
      "group and channel mismatch",
      { id: VIEWER_ID, role: "VIEWER" as const },
      { groupId: GROUP_ID, channelId: SECOND_CHANNEL_ID },
      "NOT_FOUND",
    ],
  ])("resolves the selection matrix for %s", async (_name, subject, selection, expected) => {
    const activeGroups = new Map([
      [GROUP_ID, group({ channelIds: [CHANNEL_ID] })],
      [EMPTY_GROUP_ID, group({ id: EMPTY_GROUP_ID, channelIds: [] })],
      [NEW_GROUP_ID, group({ id: NEW_GROUP_ID, channelIds: [SECOND_CHANNEL_ID], viewerIds: [] })],
    ]);
    const viewerGroups = [activeGroups.get(GROUP_ID)!, activeGroups.get(EMPTY_GROUP_ID)!];
    const service = serviceWith(
      {
        accessibleChannelIdsForUser: async () => [CHANNEL_ID, SECOND_CHANNEL_ID],
        listAccessibleForUser: async () => viewerGroups,
        findActiveById: async (id: string) => activeGroups.get(id) ?? null,
      },
      {
        findById: async (id: string) => {
          if (id === CHANNEL_ID || id === SECOND_CHANNEL_ID) return { id, archivedAt: null };
          if (id === ARCHIVED_CHANNEL_ID) return { id, archivedAt: new Date() };
          return null;
        },
      },
    );

    const resolution = service.resolveSelectedChannelIds(subject, selection);
    if (expected === "NOT_FOUND") {
      await expect(resolution).rejects.toMatchObject({
        status: 404,
        code: "CHANNEL_NOT_FOUND",
        body: { error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } },
      });
      return;
    }
    await expect(resolution).resolves.toEqual(expected);
  });

  it("replaces channel membership and reads the updated group in one transaction", async () => {
    const replaceChannels = vi.fn(async () => undefined);
    const findActiveById = vi.fn(async () => group({ channelIds: [] }));
    const service = serviceWith({ replaceChannels, findActiveById });

    await expect(
      service.replaceChannels({ actorUserId: ADMIN_ID, groupId: GROUP_ID, channelIds: [] }),
    ).resolves.toEqual({ group: expect.objectContaining({ channelIds: [], channelCount: 0 }) });
    expect(replaceChannels).toHaveBeenCalledExactlyOnceWith(GROUP_ID, []);
  });

  it("maps invalid membership targets to a stable application error", async () => {
    const service = serviceWith({
      replaceViewerGroups: vi.fn(async () => {
        throw new ChannelGroupMembershipTargetError("GROUP");
      }),
    });

    await expect(
      service.replaceViewerGroups({
        actorUserId: ADMIN_ID,
        userId: VIEWER_ID,
        groupIds: [GROUP_ID],
      }),
    ).rejects.toMatchObject({ status: 400, code: "CHANNEL_GROUP_MEMBERSHIP_INVALID" });
  });

  it("audits create with only the created group identifier", async () => {
    const harness = createTransactionalHarness();

    await harness.service.create({
      actorUserId: ADMIN_ID,
      name: "Tên nhóm không được ghi vào audit",
      description: "Nội dung nhạy cảm không được ghi vào audit",
    });

    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: null,
        action: "CHANNEL_GROUP_CREATED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { channelGroupId: NEW_GROUP_ID },
      },
    ]);
    expect(JSON.stringify(harness.audits)).not.toMatch(/Tên nhóm|Nội dung nhạy cảm/u);
  });

  it("audits update with changed-field flags rather than untrusted values", async () => {
    const harness = createTransactionalHarness();

    await harness.service.update({
      actorUserId: ADMIN_ID,
      id: GROUP_ID,
      name: "Tên mới không được ghi vào audit",
      description: "Mô tả mới không được ghi vào audit",
    });

    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: null,
        action: "CHANNEL_GROUP_UPDATED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: {
          channelGroupId: GROUP_ID,
          nameChanged: true,
          descriptionChanged: true,
        },
      },
    ]);
    expect(JSON.stringify(harness.audits)).not.toMatch(/Tên mới|Mô tả mới/u);
  });

  it("audits archive in the same mutation transaction", async () => {
    const harness = createTransactionalHarness();

    await harness.service.archive({ actorUserId: ADMIN_ID, id: GROUP_ID });

    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: null,
        action: "CHANNEL_GROUP_ARCHIVED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { channelGroupId: GROUP_ID },
      },
    ]);
  });

  it("audits channel replacement with a count and without the membership body", async () => {
    const harness = createTransactionalHarness();

    await harness.service.replaceChannels({
      actorUserId: ADMIN_ID,
      groupId: GROUP_ID,
      channelIds: [CHANNEL_ID, SECOND_CHANNEL_ID],
    });

    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: null,
        action: "CHANNEL_GROUP_CHANNELS_REPLACED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { channelGroupId: GROUP_ID, channelCount: 2 },
      },
    ]);
    expect(JSON.stringify(harness.audits)).not.toContain(SECOND_CHANNEL_ID);
  });

  it("audits VIEWER group replacement against the target user without group identifiers", async () => {
    const harness = createTransactionalHarness();

    await harness.service.replaceViewerGroups({
      actorUserId: ADMIN_ID,
      userId: VIEWER_ID,
      groupIds: [GROUP_ID],
    });

    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: VIEWER_ID,
        action: "VIEWER_CHANNEL_GROUPS_REPLACED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { groupCount: 1 },
      },
    ]);
    expect(JSON.stringify(harness.audits[0]?.metadata)).not.toContain(GROUP_ID);
  });

  it("rolls back a group mutation when its audit append fails", async () => {
    const harness = createTransactionalHarness({ rejectAudit: true });
    const before = harness.groups;

    await expect(
      harness.service.create({
        actorUserId: ADMIN_ID,
        name: "Nhóm phải rollback",
        description: null,
      }),
    ).rejects.toThrow("forced audit failure");

    expect(harness.groups).toEqual(before);
    expect(harness.audits).toEqual([]);
  });
});
