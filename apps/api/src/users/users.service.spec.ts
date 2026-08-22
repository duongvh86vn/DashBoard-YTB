import type { AppendAuditLogInput, UserRecord } from "@yt-monitor/db";
import { describe, expect, it, vi } from "vitest";

import { UsersService } from "./users.service.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const VIEWER_ID = "00000000-0000-4000-8000-000000000002";
const FIXED_NOW = new Date("2026-08-22T10:11:12.000Z");

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: VIEWER_ID,
    email: "viewer@example.com",
    passwordHash: "existing-password-hash",
    role: "VIEWER",
    isEnabled: true,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    disabledAt: null,
    ...overrides,
  };
}

interface FakeSession {
  userId: string;
  revokedAt: Date | null;
  revocationReason: string | null;
}

function cloneUser(record: UserRecord): UserRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    disabledAt: record.disabledAt === null ? null : new Date(record.disabledAt),
  };
}

function createHarness(
  options: {
    users?: UserRecord[];
    sessions?: FakeSession[];
    retryFirstTransaction?: boolean;
    rejectAudit?: boolean;
  } = {},
) {
  let storedUsers = new Map(
    (
      options.users ?? [user({ id: ADMIN_ID, email: "admin@example.com", role: "ADMIN" }), user()]
    ).map((record) => [record.id, cloneUser(record)]),
  );
  let storedSessions = structuredClone(
    options.sessions ?? [
      { userId: VIEWER_ID, revokedAt: null, revocationReason: null },
      { userId: VIEWER_ID, revokedAt: null, revocationReason: null },
    ],
  ) as FakeSession[];
  let storedAudits: AppendAuditLogInput[] = [];
  let transactionCalls = 0;
  let retried = false;
  let hashSequence = 0;
  const clock = { now: vi.fn(() => new Date(FIXED_NOW)) };
  const passwords = {
    hash: vi.fn(async (password: string) => {
      void password;
      return `new-password-hash-${++hashSequence}`;
    }),
    verify: vi.fn(async () => ({ valid: false, needsRehash: false })),
    rehash: vi.fn(async () => "unused"),
  };

  function repositories(
    transactionUsers: Map<string, UserRecord>,
    transactionSessions: FakeSession[],
    transactionAudits: AppendAuditLogInput[],
  ) {
    return {
      users: {
        async listViewers(input: { page: number; pageSize: number }) {
          const all = [...transactionUsers.values()]
            .filter((record) => record.role === "VIEWER")
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime() ||
                right.id.localeCompare(left.id),
            );
          const start = (input.page - 1) * input.pageSize;
          return { items: all.slice(start, start + input.pageSize), total: all.length };
        },
        async create(input: { email: string; passwordHash: string; role: "ADMIN" | "VIEWER" }) {
          if ([...transactionUsers.values()].some((record) => record.email === input.email)) {
            throw Object.assign(new Error("duplicate"), {
              name: "IdentityConflictError",
              code: "USER_ALREADY_EXISTS",
            });
          }
          const created = user({
            id: "00000000-0000-4000-8000-000000000099",
            email: input.email,
            passwordHash: input.passwordHash,
            role: input.role,
            createdAt: new Date("2026-08-22T12:00:00.000Z"),
            updatedAt: new Date("2026-08-22T12:00:00.000Z"),
          });
          transactionUsers.set(created.id, created);
          return created;
        },
        async findByIdForSecurityUpdate(id: string) {
          return transactionUsers.get(id) ?? null;
        },
        async updateEmail(id: string, email: string) {
          if (
            [...transactionUsers.values()].some(
              (record) => record.id !== id && record.email === email,
            )
          ) {
            throw Object.assign(new Error("duplicate"), {
              name: "IdentityConflictError",
              code: "USER_ALREADY_EXISTS",
            });
          }
          const current = transactionUsers.get(id)!;
          const updated = {
            ...current,
            email,
            updatedAt: new Date("2026-08-22T12:30:00.000Z"),
          };
          transactionUsers.set(id, updated);
          return updated;
        },
        async updatePasswordHash(id: string, passwordHash: string) {
          const current = transactionUsers.get(id)!;
          const updated = { ...current, passwordHash, updatedAt: new Date(FIXED_NOW) };
          transactionUsers.set(id, updated);
          return updated;
        },
        async setEnabled(id: string, enabled: boolean, now: Date) {
          const current = transactionUsers.get(id)!;
          const updated = {
            ...current,
            isEnabled: enabled,
            disabledAt: enabled ? null : new Date(now),
            updatedAt: new Date(now),
          };
          transactionUsers.set(id, updated);
          return updated;
        },
      },
      sessions: {
        async revokeAllForUser(userId: string, now: Date, reason: string) {
          let count = 0;
          for (const session of transactionSessions) {
            if (session.userId === userId && session.revokedAt === null) {
              session.revokedAt = new Date(now);
              session.revocationReason = reason;
              count += 1;
            }
          }
          return count;
        },
      },
      audit: {
        async append(input: AppendAuditLogInput) {
          if (options.rejectAudit) {
            throw new Error("forced audit failure");
          }
          transactionAudits.push(structuredClone(input));
          return { id: "audit-id", createdAt: new Date(FIXED_NOW), ...input };
        },
      },
      throttles: {},
    };
  }

  const unitOfWork = {
    async transaction<T>(work: (repositories: never) => Promise<T>): Promise<T> {
      transactionCalls += 1;

      for (;;) {
        const transactionUsers = new Map(
          [...storedUsers].map(([id, record]) => [id, cloneUser(record)]),
        );
        const transactionSessions = structuredClone(storedSessions) as FakeSession[];
        const transactionAudits = structuredClone(storedAudits) as AppendAuditLogInput[];

        const result = await work(
          repositories(transactionUsers, transactionSessions, transactionAudits) as never,
        );
        if (options.retryFirstTransaction && !retried) {
          retried = true;
          continue;
        }
        storedUsers = transactionUsers;
        storedSessions = transactionSessions;
        storedAudits = transactionAudits;
        return result;
      }
    },
  };

  const service = new UsersService({ unitOfWork, clock, passwords });

  return {
    service,
    clock,
    passwords,
    get users() {
      return [...storedUsers.values()].map(cloneUser);
    },
    get sessions() {
      return structuredClone(storedSessions) as FakeSession[];
    },
    get audits() {
      return structuredClone(storedAudits) as AppendAuditLogInput[];
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

async function expectApplicationError(
  operation: Promise<unknown>,
  expected: { status: number; code: string; message: string },
): Promise<void> {
  await expect(operation).rejects.toMatchObject(expected);
}

describe("UsersService", () => {
  it("returns a VIEWER-only snapshot page serialized without identity secrets", async () => {
    const newest = user({
      id: "00000000-0000-4000-8000-000000000003",
      email: "disabled@example.com",
      isEnabled: false,
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
      updatedAt: new Date("2026-08-21T01:00:00.000Z"),
      disabledAt: new Date("2026-08-21T01:00:00.000Z"),
    });
    const harness = createHarness({
      users: [user({ id: ADMIN_ID, role: "ADMIN", email: "admin@example.com" }), user(), newest],
    });

    const result = await harness.service.list({ page: 1, pageSize: 20 });

    expect(result).toEqual({
      items: [
        {
          id: newest.id,
          email: newest.email,
          role: "VIEWER",
          isEnabled: false,
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T01:00:00.000Z",
          disabledAt: "2026-08-21T01:00:00.000Z",
        },
        {
          id: VIEWER_ID,
          email: "viewer@example.com",
          role: "VIEWER",
          isEnabled: true,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
          disabledAt: null,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(JSON.stringify(result)).not.toMatch(/password|hash|session/i);
    expect(harness.clock.now).not.toHaveBeenCalled();
  });

  it("validates before the transaction and hashes a canonical create password once across retry", async () => {
    const harness = createHarness({ retryFirstTransaction: true });

    const created = await harness.service.create({
      actorUserId: ADMIN_ID,
      email: "  NEW@Example.COM  ",
      password: "planted password!",
    });

    expect(created).toMatchObject({ email: "new@example.com", role: "VIEWER", isEnabled: true });
    expect(harness.passwords.hash).toHaveBeenCalledOnce();
    expect(harness.transactionCalls).toBe(1);
    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: created.id,
        action: "USER_CREATED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: null,
      },
    ]);
    expect(JSON.stringify({ created, audits: harness.audits })).not.toContain("planted password!");
    expect(harness.clock.now).not.toHaveBeenCalled();

    const invalid = createHarness();
    await expectApplicationError(
      invalid.service.create({
        actorUserId: ADMIN_ID,
        email: "not-an-email",
        password: "planted password!",
      }),
      { status: 400, code: "VALIDATION_ERROR", message: "Invalid request" },
    );
    expect(invalid.passwords.hash).not.toHaveBeenCalled();
    expect(invalid.transactionCalls).toBe(0);
  });

  it("maps a canonical duplicate create to 409 without committing an audit", async () => {
    const harness = createHarness();

    await expectApplicationError(
      harness.service.create({
        actorUserId: ADMIN_ID,
        email: " VIEWER@EXAMPLE.COM ",
        password: "replacement password",
      }),
      {
        status: 409,
        code: "USER_ALREADY_EXISTS",
        message: "A user with that email already exists",
      },
    );
    expect(harness.audits).toEqual([]);
  });

  it("keeps same-canonical email updates state-idempotent and audits changed false", async () => {
    const harness = createHarness();
    const before = harness.users.find((record) => record.id === VIEWER_ID)!;

    const result = await harness.service.updateEmail({
      actorUserId: ADMIN_ID,
      targetUserId: VIEWER_ID,
      email: " VIEWER@EXAMPLE.COM ",
    });

    expect(result.updatedAt).toBe(before.updatedAt.toISOString());
    expect(harness.users.find((record) => record.id === VIEWER_ID)?.updatedAt).toEqual(
      before.updatedAt,
    );
    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: VIEWER_ID,
        action: "USER_EMAIL_CHANGED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { changed: false },
      },
    ]);
    expect(harness.clock.now).not.toHaveBeenCalled();
  });

  it("resets a password on every success, revokes all sessions, and captures time/hash once", async () => {
    const harness = createHarness({ retryFirstTransaction: true });

    await harness.service.resetPassword({
      actorUserId: ADMIN_ID,
      targetUserId: VIEWER_ID,
      password: "planted reset password",
    });

    expect(harness.clock.now).toHaveBeenCalledOnce();
    expect(harness.passwords.hash).toHaveBeenCalledOnce();
    expect(harness.sessions).toEqual([
      { userId: VIEWER_ID, revokedAt: FIXED_NOW, revocationReason: "admin-password-reset" },
      { userId: VIEWER_ID, revokedAt: FIXED_NOW, revocationReason: "admin-password-reset" },
    ]);
    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: VIEWER_ID,
        action: "USER_PASSWORD_RESET",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { revokedSessionCount: 2 },
      },
    ]);
    expect(JSON.stringify(harness.audits)).not.toContain("planted reset password");
  });

  it("revokes sessions idempotently with the exact reason and count metadata", async () => {
    const harness = createHarness();

    await harness.service.revokeSessions({ actorUserId: ADMIN_ID, targetUserId: VIEWER_ID });
    await harness.service.revokeSessions({ actorUserId: ADMIN_ID, targetUserId: VIEWER_ID });

    expect(harness.clock.now).toHaveBeenCalledTimes(2);
    expect(
      harness.sessions.every((session) => session.revocationReason === "admin-sessions-revoked"),
    ).toBe(true);
    expect(harness.audits.map((audit) => audit.metadata)).toEqual([
      { revokedSessionCount: 2 },
      { revokedSessionCount: 0 },
    ]);
  });

  it("makes disable/delete idempotent aliases that always ensure session revocation", async () => {
    const harness = createHarness();

    await harness.service.disable({
      actorUserId: ADMIN_ID,
      targetUserId: VIEWER_ID,
      via: "DISABLE_ENDPOINT",
    });
    await harness.service.disable({
      actorUserId: ADMIN_ID,
      targetUserId: VIEWER_ID,
      via: "DELETE_ALIAS",
    });

    expect(harness.users.find((record) => record.id === VIEWER_ID)).toMatchObject({
      isEnabled: false,
      disabledAt: FIXED_NOW,
    });
    expect(
      harness.sessions.every((session) => session.revocationReason === "admin-user-disabled"),
    ).toBe(true);
    expect(harness.audits.map((audit) => audit.metadata)).toEqual([
      { changed: true, revokedSessionCount: 2, via: "DISABLE_ENDPOINT" },
      { changed: false, revokedSessionCount: 0, via: "DELETE_ALIAS" },
    ]);
  });

  it("enables idempotently without restoring a revoked session", async () => {
    const harness = createHarness({
      users: [
        user({ id: ADMIN_ID, email: "admin@example.com", role: "ADMIN" }),
        user({ isEnabled: false, disabledAt: new Date("2026-08-21T03:00:00.000Z") }),
      ],
      sessions: [
        {
          userId: VIEWER_ID,
          revokedAt: new Date("2026-08-21T03:00:00.000Z"),
          revocationReason: "admin-user-disabled",
        },
      ],
    });

    await harness.service.enable({ actorUserId: ADMIN_ID, targetUserId: VIEWER_ID });
    await harness.service.enable({ actorUserId: ADMIN_ID, targetUserId: VIEWER_ID });

    expect(harness.users.find((record) => record.id === VIEWER_ID)).toMatchObject({
      isEnabled: true,
      disabledAt: null,
    });
    expect(harness.sessions[0]).toMatchObject({
      revokedAt: new Date("2026-08-21T03:00:00.000Z"),
      revocationReason: "admin-user-disabled",
    });
    expect(harness.audits.map((audit) => audit.metadata)).toEqual([
      { changed: true },
      { changed: false },
    ]);
  });

  it.each([
    ["updateEmail", "UPDATE_EMAIL"],
    ["resetPassword", "RESET_PASSWORD"],
    ["revokeSessions", "REVOKE_SESSIONS"],
    ["disable", "DISABLE"],
    ["enable", "ENABLE"],
    ["deleteAlias", "DELETE_ALIAS"],
  ] as const)("commits a protected ADMIN-target denial audit for %s", async (operation, name) => {
    const harness = createHarness();
    let request: Promise<unknown>;
    if (operation === "updateEmail") {
      request = harness.service.updateEmail({
        actorUserId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        email: "other@example.com",
      });
    } else if (operation === "resetPassword") {
      request = harness.service.resetPassword({
        actorUserId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        password: "replacement password",
      });
    } else if (operation === "revokeSessions") {
      request = harness.service.revokeSessions({ actorUserId: ADMIN_ID, targetUserId: ADMIN_ID });
    } else if (operation === "disable" || operation === "deleteAlias") {
      request = harness.service.disable({
        actorUserId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        via: operation === "disable" ? "DISABLE_ENDPOINT" : "DELETE_ALIAS",
      });
    } else {
      request = harness.service.enable({ actorUserId: ADMIN_ID, targetUserId: ADMIN_ID });
    }

    await expectApplicationError(request, {
      status: 403,
      code: "AUTH_FORBIDDEN",
      message: "Forbidden",
    });
    expect(harness.audits).toEqual([
      {
        actorUserId: ADMIN_ID,
        targetUserId: ADMIN_ID,
        action: "AUTHORIZATION_DENIED",
        outcome: "FAILURE",
        requestId: null,
        metadata: { operation: name, reason: "ADMIN_TARGET_PROTECTED" },
      },
    ]);
    expect(harness.users.find((record) => record.id === ADMIN_ID)).toMatchObject({
      email: "admin@example.com",
      role: "ADMIN",
      isEnabled: true,
    });
  });

  it("returns USER_NOT_FOUND without semantic audit and rolls back a mutation when audit fails", async () => {
    const missing = createHarness();
    await expectApplicationError(
      missing.service.revokeSessions({
        actorUserId: ADMIN_ID,
        targetUserId: "00000000-0000-4000-8000-000000000099",
      }),
      { status: 404, code: "USER_NOT_FOUND", message: "User not found" },
    );
    expect(missing.audits).toEqual([]);

    const rollback = createHarness({ rejectAudit: true });
    await expect(
      rollback.service.disable({
        actorUserId: ADMIN_ID,
        targetUserId: VIEWER_ID,
        via: "DISABLE_ENDPOINT",
      }),
    ).rejects.toThrow("forced audit failure");
    expect(rollback.users.find((record) => record.id === VIEWER_ID)).toMatchObject({
      isEnabled: true,
      disabledAt: null,
    });
    expect(rollback.sessions.every((session) => session.revokedAt === null)).toBe(true);
  });
});
