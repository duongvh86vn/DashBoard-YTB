import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { IdentityUnitOfWork } from "./identity-unit-of-work.js";
import { LoginThrottleRepository } from "./login-throttle.repository.js";
import { SessionRepository } from "./session.repository.js";
import { UserRepository } from "./user.repository.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests");
}

const client = createPrismaClient(databaseUrl);
const users = new UserRepository(client);
const sessions = new SessionRepository(client);
const throttles = new LoginThrottleRepository(client);
const unitOfWork = new IdentityUnitOfWork(client);

async function createUser(
  email: string,
  role: "ADMIN" | "VIEWER" = "VIEWER",
  passwordHash = "password-hash",
) {
  return users.create({ email, passwordHash, role });
}

describe("identity persistence", () => {
  beforeEach(async () => {
    await client.auditLog.deleteMany();
    await client.loginThrottle.deleteMany();
    await client.session.deleteMany();
    await client.user.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("keeps pagination stable with createdAt DESC and id DESC ordering", async () => {
    const createdAt = new Date("2026-08-22T00:00:00.000Z");
    await client.user.createMany({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "first@example.com",
          passwordHash: "hash-1",
          role: "VIEWER",
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          email: "third@example.com",
          passwordHash: "hash-3",
          role: "VIEWER",
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          email: "second@example.com",
          passwordHash: "hash-2",
          role: "VIEWER",
          createdAt: new Date("2026-08-21T00:00:00.000Z"),
          updatedAt: createdAt,
        },
      ],
    });

    await expect(users.list({ page: 1, pageSize: 2 })).resolves.toMatchObject({
      total: 3,
      items: [
        { id: "00000000-0000-4000-8000-000000000003" },
        { id: "00000000-0000-4000-8000-000000000001" },
      ],
    });
    await expect(users.list({ page: 2, pageSize: 2 })).resolves.toMatchObject({
      total: 3,
      items: [{ id: "00000000-0000-4000-8000-000000000002" }],
    });
  });

  it("rejects duplicate canonical emails and missing user mutations with stable codes", async () => {
    const user = await createUser("viewer@example.com");

    await expect(users.findById(user.id)).resolves.toMatchObject({
      email: "viewer@example.com",
      role: "VIEWER",
    });
    await expect(users.findByCanonicalEmail("viewer@example.com")).resolves.toMatchObject({
      id: user.id,
    });
    await expect(users.countAll()).resolves.toBe(1);
    await expect(users.countByRole("VIEWER")).resolves.toBe(1);
    await expect(users.countByRole("ADMIN")).resolves.toBe(0);

    await users.updatePasswordHash(user.id, "replacement-password-hash");
    await expect(users.findById(user.id)).resolves.toMatchObject({
      passwordHash: "replacement-password-hash",
    });

    await expect(createUser("viewer@example.com")).rejects.toMatchObject({
      code: "USER_ALREADY_EXISTS",
    });
    const otherUser = await createUser("other-viewer@example.com");
    await expect(users.updateEmail(otherUser.id, "viewer@example.com")).rejects.toMatchObject({
      code: "USER_ALREADY_EXISTS",
    });
    await expect(
      users.updateEmail("00000000-0000-4000-8000-000000000099", "new@example.com"),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(users.setEnabled(user.id, false, new Date())).resolves.toMatchObject({
      isEnabled: false,
      disabledAt: expect.any(Date),
    });
    await expect(users.setEnabled(user.id, true, new Date())).resolves.toMatchObject({
      isEnabled: true,
      disabledAt: null,
    });
  });

  it("treats expiry boundaries, revoked sessions, and disabled-user sessions as unusable", async () => {
    const user = await createUser("viewer@example.com");
    const now = new Date("2026-08-22T01:00:00.000Z");
    const tokenHash = new Uint8Array([1, 2, 3, 4]);
    const session = await sessions.create({
      userId: user.id,
      tokenHash,
      now,
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-22T03:00:00.000Z"),
    });

    await expect(
      sessions.findUsableByHash(tokenHash, new Date("2026-08-22T02:00:00.000Z")),
    ).resolves.toBeNull();
    await expect(
      sessions.findUsableByHash(tokenHash, new Date("2026-08-22T01:59:59.999Z")),
    ).resolves.toMatchObject({ id: session.id, user: { role: "VIEWER", isEnabled: true } });

    await sessions.revokeById(session.id, now, "logout");
    await expect(sessions.findUsableByHash(tokenHash, now)).resolves.toBeNull();

    const otherTokenHash = new Uint8Array([5, 6, 7, 8]);
    await sessions.create({
      userId: user.id,
      tokenHash: otherTokenHash,
      now,
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-22T03:00:00.000Z"),
    });
    await users.setEnabled(user.id, false, now);
    await expect(sessions.findUsableByHash(otherTokenHash, now)).resolves.toBeNull();
  });

  it("caps touch at absolute expiry and revokes all active sessions idempotently", async () => {
    const user = await createUser("viewer@example.com");
    const now = new Date("2026-08-22T01:00:00.000Z");
    const absoluteExpiresAt = new Date("2026-08-22T03:00:00.000Z");
    const first = await sessions.create({
      userId: user.id,
      tokenHash: new Uint8Array([1]),
      now,
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt,
    });
    await sessions.create({
      userId: user.id,
      tokenHash: new Uint8Array([2]),
      now,
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt,
    });

    await expect(
      sessions.touch(first.id, now, new Date("2026-08-22T04:00:00.000Z")),
    ).resolves.toMatchObject({ idleExpiresAt: absoluteExpiresAt, lastSeenAt: now });
    await expect(sessions.revokeAllForUser(user.id, now, "password-changed")).resolves.toBe(2);
    await expect(sessions.revokeAllForUser(user.id, now, "password-changed")).resolves.toBe(0);
  });

  it("atomically blocks the fifth concurrent failure for one throttle key", async () => {
    const keyHash = new Uint8Array([9, 8, 7, 6]);
    const now = new Date("2026-08-22T01:00:00.000Z");
    const policy = { maxAttempts: 5, windowMinutes: 15, lockMinutes: 30 };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        throttles.registerFailure("IDENTIFIER", keyHash, now, policy),
      ),
    );

    await expect(throttles.get("IDENTIFIER", keyHash)).resolves.toEqual({
      attemptCount: 5,
      windowStartedAt: now,
      blockedUntil: new Date("2026-08-22T01:30:00.000Z"),
    });
    await expect(throttles.clear("IDENTIFIER", keyHash)).resolves.toBeUndefined();
    await expect(throttles.get("IDENTIFIER", keyHash)).resolves.toBeNull();
  });

  it("commits a security mutation and semantic audit together without credential markers", async () => {
    const plantedPassword = "planted-password-marker";
    const plantedToken = "planted-token-marker";

    const user = await unitOfWork.transaction(async (repositories) => {
      const created = await repositories.users.create({
        email: "audited@example.com",
        passwordHash: plantedPassword,
        role: "VIEWER",
      });
      await repositories.audit.append({
        actorUserId: null,
        targetUserId: created.id,
        action: "USER_CREATED",
        outcome: "SUCCESS",
        requestId: "request-1",
        metadata: { source: "admin" },
      });
      return created;
    });

    await expect(
      unitOfWork.transaction(async (repositories) => {
        await repositories.users.updateEmail(user.id, "rolled-back@example.com");
        await repositories.audit.append({
          actorUserId: user.id,
          targetUserId: user.id,
          action: "USER_EMAIL_CHANGED",
          outcome: "SUCCESS",
          requestId: "request-2",
          metadata: null,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await users.findById(user.id)).toMatchObject({ email: "audited@example.com" });
    const rows = await client.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(plantedPassword);
    expect(JSON.stringify(rows)).not.toContain(plantedToken);
  });
});
