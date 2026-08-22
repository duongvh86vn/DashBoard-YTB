import { createHmac } from "node:crypto";

import type { PasswordVerification } from "@yt-monitor/auth";
import {
  createPrismaClient,
  IdentityUnitOfWork,
  LoginThrottleRepository,
  SessionRepository,
  UserRepository,
} from "@yt-monitor/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "./auth.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for auth integration tests");
}

const client = createPrismaClient(databaseUrl);
const users = new UserRepository(client);
const sessions = new SessionRepository(client);
const throttles = new LoginThrottleRepository(client);
const unitOfWork = new IdentityUnitOfWork(client);
const now = new Date("2026-08-22T01:00:00.000Z");
const entropy = Uint8Array.from({ length: 32 }, (_value, index) => 255 - index);

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createService(passwords: {
  verify(hash: string, password: string): Promise<PasswordVerification>;
  hash(password: string): Promise<string>;
}) {
  return new AuthService({
    users,
    unitOfWork,
    throttle: new LoginThrottleService({
      sessionSecret: "s".repeat(32),
      maxAttempts: 5,
      lockMinutes: 15,
    }),
    clock: { now: () => now },
    entropy: { bytes: (length: number) => entropy.slice(0, length) },
    passwords,
    sessionSecret: "s".repeat(32),
    sessionIdleMinutes: 120,
    sessionAbsoluteHours: 24,
  });
}

async function expectCredentialFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    status: 401,
    code: "AUTH_INVALID_CREDENTIALS",
  });
}

describe("real PostgreSQL auth flow", () => {
  beforeEach(async () => {
    await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS "task5_reject_audit" ON "audit_logs"');
    await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS "task5_reject_audit"()');
    await client.auditLog.deleteMany();
    await client.loginThrottle.deleteMany();
    await client.session.deleteMany();
    await client.user.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("stores only the session HMAC, persists rehash, and plants no raw secrets in audit", async () => {
    const plantedPassword = "planted-current-password";
    const plantedHash = "legacy-planted-password-hash";
    const replacementHash = "replacement-argon2id-password-hash";
    const account = await users.create({
      email: "viewer@example.com",
      passwordHash: plantedHash,
      role: "VIEWER",
    });
    const service = createService({
      verify: vi.fn(async (hash, password) => ({
        valid: hash === plantedHash && password === plantedPassword,
        needsRehash: hash === plantedHash && password === plantedPassword,
      })),
      hash: vi.fn(async () => replacementHash),
    });

    const result = await service.login({ email: account.email, password: plantedPassword });
    const storedSession = await client.session.findFirstOrThrow({ where: { userId: account.id } });
    const storedUser = await users.findById(account.id);
    const auditRows = await client.auditLog.findMany();

    expect(Buffer.from(storedSession.tokenHash)).toEqual(
      createHmac("sha256", "s".repeat(32)).update(result.sessionToken, "utf8").digest(),
    );
    expect(Buffer.from(storedSession.tokenHash).toString("utf8")).not.toContain(
      result.sessionToken,
    );
    expect(storedSession.createdAt).toEqual(now);
    expect(storedSession.lastSeenAt).toEqual(now);
    expect(storedUser?.passwordHash).toBe(replacementHash);
    expect(JSON.stringify(auditRows)).not.toContain(plantedPassword);
    expect(JSON.stringify(auditRows)).not.toContain(plantedHash);
    expect(JSON.stringify(auditRows)).not.toContain(replacementHash);
    expect(JSON.stringify(auditRows)).not.toContain(result.sessionToken);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.metadata).toEqual({ passwordRehashed: true });
  });

  it("linearizes a success clear before a concurrent failure under the same throttle lock", async () => {
    const throttle = new LoginThrottleService({
      sessionSecret: "s".repeat(32),
      maxAttempts: 5,
      lockMinutes: 15,
    });
    const keyHash = throttle.identifierKey("viewer@example.com");
    await throttles.registerFailure("IDENTIFIER", keyHash, now, throttle.policy);
    const successHasLock = deferred();
    const releaseSuccess = deferred();

    const success = unitOfWork.transaction(async (repositories) => {
      await repositories.throttles.getLocked("IDENTIFIER", keyHash);
      successHasLock.resolve();
      await releaseSuccess.promise;
      await repositories.throttles.clear("IDENTIFIER", keyHash);
    });
    await successHasLock.promise;
    const laterFailure = unitOfWork.transaction((repositories) =>
      repositories.throttles.registerFailure("IDENTIFIER", keyHash, now, throttle.policy),
    );
    releaseSuccess.resolve();

    await expect(Promise.all([success, laterFailure])).resolves.toEqual([
      undefined,
      { attemptCount: 1, windowStartedAt: now, blockedUntil: null },
    ]);
    await expect(throttles.get("IDENTIFIER", keyHash)).resolves.toEqual({
      attemptCount: 1,
      windowStartedAt: now,
      blockedUntil: null,
    });
  });

  it("prevents login verified before a concurrent password reset from creating a session", async () => {
    const account = await users.create({
      email: "reset-race@example.com",
      passwordHash: "old-hash",
      role: "VIEWER",
    });
    const verificationStarted = deferred();
    const finishVerification = deferred();
    const service = createService({
      async verify(hash, password) {
        if (hash === "old-hash" && password === "old password") {
          verificationStarted.resolve();
          await finishVerification.promise;
          return { valid: true, needsRehash: false };
        }
        return { valid: false, needsRehash: false };
      },
      async hash(password) {
        return `hash:${password}`;
      },
    });

    const login = service.login({ email: account.email, password: "old password" });
    await verificationStarted.promise;
    await unitOfWork.transaction(async (repositories) => {
      await repositories.users.findByIdForSecurityUpdate(account.id);
      await repositories.users.updatePasswordHash(account.id, "reset-hash");
      await repositories.sessions.revokeAllForUser(account.id, now, "password-reset");
    });
    finishVerification.resolve();

    await expectCredentialFailure(login);
    expect(await client.session.count({ where: { userId: account.id } })).toBe(0);
    await expect(users.findById(account.id)).resolves.toMatchObject({ passwordHash: "reset-hash" });
  });

  it("prevents login verified before a concurrent canonical-email rename from creating a session", async () => {
    const account = await users.create({
      email: "rename-race@example.com",
      passwordHash: "current-hash",
      role: "VIEWER",
    });
    const verificationStarted = deferred();
    const finishVerification = deferred();
    const service = createService({
      async verify(hash, password) {
        if (hash === "current-hash" && password === "current password") {
          verificationStarted.resolve();
          await finishVerification.promise;
          return { valid: true, needsRehash: false };
        }
        return { valid: false, needsRehash: false };
      },
      async hash(password) {
        return `hash:${password}`;
      },
    });

    const login = service.login({ email: account.email, password: "current password" });
    await verificationStarted.promise;
    await unitOfWork.transaction(async (repositories) => {
      await repositories.users.findByIdForSecurityUpdate(account.id);
      await repositories.users.updateEmail(account.id, "renamed@example.com");
    });
    finishVerification.resolve();

    await expectCredentialFailure(login);
    expect(await client.session.count({ where: { userId: account.id } })).toBe(0);
    await expect(users.findById(account.id)).resolves.toMatchObject({
      email: "renamed@example.com",
    });
  });

  it("rolls back logout and password mutations when their semantic audit insert fails", async () => {
    const account = await users.create({
      email: "rollback@example.com",
      passwordHash: "hash:current password",
      role: "VIEWER",
    });
    const session = await sessions.create({
      userId: account.id,
      tokenHash: new Uint8Array([9, 8, 7]),
      now,
      idleExpiresAt: new Date("2026-08-22T03:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-23T01:00:00.000Z"),
    });
    const service = createService({
      async verify(hash, password) {
        return { valid: hash === `hash:${password}`, needsRehash: false };
      },
      async hash(password) {
        return `hash:${password}`;
      },
    });

    await client.$executeRawUnsafe(`
      CREATE FUNCTION "task5_reject_audit"() RETURNS trigger AS $$
      BEGIN
        IF NEW.action::text IN ('LOGOUT', 'PASSWORD_CHANGED') THEN
          RAISE EXCEPTION 'task5 forced audit rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER "task5_reject_audit"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "task5_reject_audit"()
    `);

    await expect(service.logout({ userId: account.id, sessionId: session.id })).rejects.toThrow(
      "task5 forced audit rollback",
    );
    await expect(
      service.changePassword({
        userId: account.id,
        currentPassword: "current password",
        newPassword: "replacement password",
      }),
    ).rejects.toThrow("task5 forced audit rollback");

    await expect(client.session.findUnique({ where: { id: session.id } })).resolves.toMatchObject({
      revokedAt: null,
      revocationReason: null,
    });
    await expect(users.findById(account.id)).resolves.toMatchObject({
      passwordHash: "hash:current password",
    });
    expect(await client.auditLog.count()).toBe(0);
  });
});
