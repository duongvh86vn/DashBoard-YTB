import type { PasswordVerification } from "@yt-monitor/auth";
import {
  createPrismaClient,
  IdentityUnitOfWork,
  SessionRepository,
  UserRepository,
  type IdentityRepositories,
} from "@yt-monitor/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { AuthService } from "../auth/auth.service.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { UsersService } from "./users.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for users integration tests");
}

const client = createPrismaClient(databaseUrl);
const users = new UserRepository(client);
const sessions = new SessionRepository(client);
const unitOfWork = new IdentityUnitOfWork(client);
const now = new Date("2026-08-22T10:11:12.000Z");
const ADMIN_IDENTITY = {
  email: "admin@example.com",
  passwordHash: "hash:admin password",
  role: "ADMIN" as const,
};

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const passwords = {
  async verify(hash: string, password: string): Promise<PasswordVerification> {
    return { valid: hash === `hash:${password}`, needsRehash: false };
  },
  async hash(password: string): Promise<string> {
    return `hash:${password}`;
  },
  async rehash(password: string): Promise<string> {
    return `hash:${password}`;
  },
};

function createUsersService(
  identityUnitOfWork: {
    transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T>;
  } = unitOfWork,
) {
  return new UsersService({
    unitOfWork: identityUnitOfWork,
    clock: { now: () => new Date(now) },
    passwords,
  });
}

function createAuthService(
  passwordPort: typeof passwords = passwords,
  identityUnitOfWork: {
    transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T>;
  } = unitOfWork,
) {
  return new AuthService({
    users,
    unitOfWork: identityUnitOfWork,
    throttle: new LoginThrottleService({
      sessionSecret: "s".repeat(32),
      maxAttempts: 5,
      lockMinutes: 15,
    }),
    clock: { now: () => new Date(now) },
    entropy: {
      bytes: (length: number) => Uint8Array.from({ length }, (_value, index) => (index + 41) % 256),
    },
    passwords: passwordPort,
    sessionSecret: "s".repeat(32),
    sessionIdleMinutes: 120,
    sessionAbsoluteHours: 24,
  });
}

function pauseAfterTargetLock(
  entered: ReturnType<typeof deferred>,
  release: ReturnType<typeof deferred>,
) {
  let paused = false;
  return {
    transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T> {
      return unitOfWork.transaction(async (repositories) => {
        const proxiedUsers = new Proxy(repositories.users, {
          get(target, property, receiver) {
            if (property !== "findByIdForSecurityUpdate") {
              return Reflect.get(target, property, receiver);
            }
            return async (id: string) => {
              const record = await target.findByIdForSecurityUpdate(id);
              if (!paused) {
                paused = true;
                entered.resolve();
                await release.promise;
              }
              return record;
            };
          },
        });
        return work({ ...repositories, users: proxiedUsers });
      });
    },
  };
}

function signalBeforeTargetLock(attempted: ReturnType<typeof deferred>) {
  let signaled = false;
  return {
    transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T> {
      return unitOfWork.transaction(async (repositories) => {
        const proxiedUsers = new Proxy(repositories.users, {
          get(target, property, receiver) {
            if (property !== "findByIdForSecurityUpdate") {
              return Reflect.get(target, property, receiver);
            }
            return async (id: string) => {
              if (!signaled) {
                signaled = true;
                attempted.resolve();
              }
              return target.findByIdForSecurityUpdate(id);
            };
          },
        });
        return work({ ...repositories, users: proxiedUsers });
      });
    },
  };
}

async function createAdmin() {
  return users.create(ADMIN_IDENTITY);
}

async function createViewer(email: string, password = "current password") {
  return users.create({ email, passwordHash: `hash:${password}`, role: "VIEWER" });
}

async function createActiveSession(userId: string, marker: number) {
  return sessions.create({
    userId,
    tokenHash: new Uint8Array([marker]),
    now,
    idleExpiresAt: new Date("2026-08-22T12:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-08-23T10:00:00.000Z"),
  });
}

async function expectInvalidLogin(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    status: 401,
    code: "AUTH_INVALID_CREDENTIALS",
  });
}

describe("real PostgreSQL ADMIN VIEWER management", () => {
  beforeEach(async () => {
    await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS "task6_reject_audit" ON "audit_logs"');
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS "task6_reject_audit"()');
    await client.auditLog.deleteMany();
    await client.loginThrottle.deleteMany();
    await client.session.deleteMany();
    await client.user.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("allows exactly one concurrent canonical create and commits exactly one audit", async () => {
    const admin = await createAdmin();
    const service = createUsersService();
    const plantedPassword = "concurrent planted password";

    const results = await Promise.allSettled([
      service.create({
        actorUserId: admin.id,
        email: " Concurrent@Example.COM ",
        password: plantedPassword,
      }),
      service.create({
        actorUserId: admin.id,
        email: "concurrent@example.com",
        password: plantedPassword,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { status: 409, code: "USER_ALREADY_EXISTS" },
    });
    expect(await client.user.count({ where: { email: "concurrent@example.com" } })).toBe(1);
    const auditRows = await client.auditLog.findMany({ where: { action: "USER_CREATED" } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorUserId: admin.id,
      targetUserId: expect.any(String),
      outcome: "SUCCESS",
      requestId: null,
      metadata: null,
    });
    expect(JSON.stringify({ results, auditRows })).not.toContain(plantedPassword);
  });

  it("rolls back a user mutation and session revocation when its semantic audit fails", async () => {
    const admin = await createAdmin();
    const viewer = await createViewer("rollback@example.com");
    const session = await createActiveSession(viewer.id, 9);
    const service = createUsersService();

    await client.$executeRawUnsafe(`
      CREATE FUNCTION "task6_reject_audit"() RETURNS trigger AS $$
      BEGIN
        IF NEW.action::text = 'USER_DISABLED' THEN
          RAISE EXCEPTION 'task6 forced audit rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER "task6_reject_audit"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "task6_reject_audit"()
    `);

    await expect(
      service.disable({
        actorUserId: admin.id,
        targetUserId: viewer.id,
        via: "DISABLE_ENDPOINT",
      }),
    ).rejects.toThrow("task6 forced audit rollback");
    await expect(users.findById(viewer.id)).resolves.toMatchObject({
      isEnabled: true,
      disabledAt: null,
    });
    await expect(client.session.findUnique({ where: { id: session.id } })).resolves.toMatchObject({
      revokedAt: null,
      revocationReason: null,
    });
    expect(await client.auditLog.count()).toBe(0);
  });

  it("filters ADMIN rows and deterministically pages tied VIEWER rows in one snapshot", async () => {
    await createAdmin();
    const viewers = await Promise.all([
      createViewer("one@example.com"),
      createViewer("two@example.com"),
      createViewer("three@example.com"),
    ]);
    const tiedAt = new Date("2026-08-20T05:00:00.000Z");
    await client.user.updateMany({
      where: { id: { in: viewers.map((viewer) => viewer.id) } },
      data: { createdAt: tiedAt },
    });
    await users.setEnabled(viewers[1]!.id, false, now);
    const expectedIds = viewers.map((viewer) => viewer.id).sort((a, b) => b.localeCompare(a));
    const service = createUsersService();

    const first = await service.list({ page: 1, pageSize: 2 });
    const second = await service.list({ page: 2, pageSize: 2 });

    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect([...first.items, ...second.items].map((viewer) => viewer.id)).toEqual(expectedIds);
    expect([...first.items, ...second.items].some((viewer) => viewer.isEnabled === false)).toBe(
      true,
    );
    expect([...first.items, ...second.items].every((viewer) => viewer.role === "VIEWER")).toBe(
      true,
    );
  });

  it("prevents a stale old-password login when reset wins the shared user lock", async () => {
    const admin = await createAdmin();
    const viewer = await createViewer("reset-race@example.com", "old password");
    const mutationLocked = deferred();
    const releaseMutation = deferred();
    const verificationFinished = deferred();
    const service = createUsersService(pauseAfterTargetLock(mutationLocked, releaseMutation));
    const auth = createAuthService({
      ...passwords,
      async verify(hash, password) {
        const result = await passwords.verify(hash, password);
        verificationFinished.resolve();
        return result;
      },
    });

    const reset = service.resetPassword({
      actorUserId: admin.id,
      targetUserId: viewer.id,
      password: "replacement password",
    });
    await mutationLocked.promise;
    const login = auth.login({ email: viewer.email, password: "old password" });
    await verificationFinished.promise;
    releaseMutation.resolve();

    await expect(reset).resolves.toBeUndefined();
    await expectInvalidLogin(login);
    expect(await client.session.count({ where: { userId: viewer.id } })).toBe(0);
    await expect(users.findById(viewer.id)).resolves.toMatchObject({
      passwordHash: "hash:replacement password",
    });
  });

  it("prevents a stale login when disable wins, while revoke-first permits only a later session", async () => {
    const admin = await createAdmin();
    const disabledViewer = await createViewer("disable-race@example.com");
    const disableLocked = deferred();
    const releaseDisable = deferred();
    const disableVerified = deferred();
    const disabling = createUsersService(
      pauseAfterTargetLock(disableLocked, releaseDisable),
    ).disable({
      actorUserId: admin.id,
      targetUserId: disabledViewer.id,
      via: "DISABLE_ENDPOINT",
    });
    await disableLocked.promise;
    const staleLogin = createAuthService({
      ...passwords,
      async verify(hash, password) {
        const result = await passwords.verify(hash, password);
        disableVerified.resolve();
        return result;
      },
    }).login({ email: disabledViewer.email, password: "current password" });
    await disableVerified.promise;
    releaseDisable.resolve();
    await expect(disabling).resolves.toBeUndefined();
    await expectInvalidLogin(staleLogin);
    expect(await client.session.count({ where: { userId: disabledViewer.id } })).toBe(0);

    const revokeViewer = await createViewer("revoke-race@example.com");
    const oldSession = await createActiveSession(revokeViewer.id, 10);
    const revokeLocked = deferred();
    const releaseRevoke = deferred();
    const revokeVerified = deferred();
    const revoking = createUsersService(
      pauseAfterTargetLock(revokeLocked, releaseRevoke),
    ).revokeSessions({ actorUserId: admin.id, targetUserId: revokeViewer.id });
    await revokeLocked.promise;
    const laterLogin = createAuthService({
      ...passwords,
      async verify(hash, password) {
        const result = await passwords.verify(hash, password);
        revokeVerified.resolve();
        return result;
      },
    }).login({ email: revokeViewer.email, password: "current password" });
    await revokeVerified.promise;
    releaseRevoke.resolve();
    await expect(revoking).resolves.toBeUndefined();
    await expect(laterLogin).resolves.toMatchObject({
      user: { id: revokeViewer.id },
      sessionToken: expect.any(String),
    });
    await expect(
      client.session.findUnique({ where: { id: oldSession.id } }),
    ).resolves.toMatchObject({
      revokedAt: now,
      revocationReason: "admin-sessions-revoked",
    });
    expect(
      await client.session.count({ where: { userId: revokeViewer.id, revokedAt: null } }),
    ).toBe(1);
  });

  it("revokes the session when login wins a concurrent disable", async () => {
    const admin = await createAdmin();
    const viewer = await createViewer("login-wins@example.com");
    const loginLocked = deferred();
    const releaseLogin = deferred();
    const mutationAttempted = deferred();
    const login = createAuthService(
      passwords,
      pauseAfterTargetLock(loginLocked, releaseLogin),
    ).login({ email: viewer.email, password: "current password" });
    await loginLocked.promise;
    const disabling = createUsersService(signalBeforeTargetLock(mutationAttempted)).disable({
      actorUserId: admin.id,
      targetUserId: viewer.id,
      via: "DISABLE_ENDPOINT",
    });
    await mutationAttempted.promise;
    releaseLogin.resolve();

    await expect(login).resolves.toMatchObject({ user: { id: viewer.id } });
    await expect(disabling).resolves.toBeUndefined();
    expect(await client.session.count({ where: { userId: viewer.id, revokedAt: null } })).toBe(0);
    await expect(
      client.session.findFirstOrThrow({ where: { userId: viewer.id } }),
    ).resolves.toMatchObject({
      revokedAt: now,
      revocationReason: "admin-user-disabled",
    });
  });

  it("prevents old-email login when canonical rename wins the shared user lock", async () => {
    const admin = await createAdmin();
    const viewer = await createViewer("old-email@example.com");
    const renameLocked = deferred();
    const releaseRename = deferred();
    const verificationFinished = deferred();
    const rename = createUsersService(
      pauseAfterTargetLock(renameLocked, releaseRename),
    ).updateEmail({
      actorUserId: admin.id,
      targetUserId: viewer.id,
      email: "new-email@example.com",
    });
    await renameLocked.promise;
    const login = createAuthService({
      ...passwords,
      async verify(hash, password) {
        const result = await passwords.verify(hash, password);
        verificationFinished.resolve();
        return result;
      },
    }).login({ email: viewer.email, password: "current password" });
    await verificationFinished.promise;
    releaseRename.resolve();

    await expect(rename).resolves.toMatchObject({ email: "new-email@example.com" });
    await expectInvalidLogin(login);
    expect(await client.session.count({ where: { userId: viewer.id } })).toBe(0);
  });

  it("does not resurrect revoked sessions after re-enable and requires a new login", async () => {
    const admin = await createAdmin();
    const viewer = await createViewer("reenable@example.com");
    const oldSession = await createActiveSession(viewer.id, 11);
    const service = createUsersService();

    await service.disable({
      actorUserId: admin.id,
      targetUserId: viewer.id,
      via: "DISABLE_ENDPOINT",
    });
    await service.enable({ actorUserId: admin.id, targetUserId: viewer.id });

    await expect(
      client.session.findUnique({ where: { id: oldSession.id } }),
    ).resolves.toMatchObject({
      revokedAt: now,
      revocationReason: "admin-user-disabled",
    });
    const result = await createAuthService().login({
      email: viewer.email,
      password: "current password",
    });
    expect(result.user).toMatchObject({ id: viewer.id, isEnabled: true });
    const allSessions = await client.session.findMany({ where: { userId: viewer.id } });
    expect(allSessions).toHaveLength(2);
    expect(allSessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
    expect(JSON.stringify(await client.auditLog.findMany())).not.toMatch(
      /current password|hash:|sessionToken|tokenHash/u,
    );
  });
});
