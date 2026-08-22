import { createHmac } from "node:crypto";

import { nextThrottleState, type PasswordVerification, type ThrottleState } from "@yt-monitor/auth";
import type {
  AppendAuditLogInput,
  CreateSessionInput,
  IdentityRepositories,
  UserRecord,
} from "@yt-monitor/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApplicationError } from "./auth-application.error.js";
import { AuthService } from "./auth.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";

const NOW = new Date("2026-08-22T01:00:00.000Z");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const CURRENT_PASSWORD = "current password";
const NEW_PASSWORD = "replacement password";
const ENTROPY = Uint8Array.from({ length: 32 }, (_value, index) => index);
const FIXED_DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=1,t=3$WUhNLWR1bW15LXYxLXNhbHQ$j4f7wiVxLcRxDd1+QepaC+f3tRFUpYYLkNZ8iitDVb4";

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    email: "viewer@example.com",
    passwordHash: `hash:${CURRENT_PASSWORD}`,
    role: "VIEWER",
    isEnabled: true,
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    disabledAt: null,
    ...overrides,
  };
}

interface StoredSession extends CreateSessionInput {
  id: string;
  revokedAt: Date | null;
  revocationReason: string | null;
}

interface FakeState {
  users: UserRecord[];
  throttles: Map<string, ThrottleState>;
  sessions: StoredSession[];
  audits: AppendAuditLogInput[];
}

function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}

function throttleMapKey(keyHash: Uint8Array): string {
  return Buffer.from(keyHash).toString("base64url");
}

function createUnitOfWork(
  state: FakeState,
  options: { securityRows?: Array<UserRecord | null>; fail?: Error } = {},
) {
  return {
    async transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T> {
      if (options.fail) {
        throw options.fail;
      }

      const draft = cloneState(state);
      const repositories = {
        users: {
          async findByIdForSecurityUpdate(id: string) {
            if (options.securityRows?.length) {
              return structuredClone(options.securityRows.shift() ?? null);
            }
            return draft.users.find((candidate) => candidate.id === id) ?? null;
          },
          async updatePasswordHash(id: string, passwordHash: string) {
            const target = draft.users.find((candidate) => candidate.id === id);
            if (!target) throw new Error("missing user");
            target.passwordHash = passwordHash;
          },
        },
        throttles: {
          async getLocked(_scope: "IDENTIFIER", keyHash: Uint8Array) {
            return draft.throttles.get(throttleMapKey(keyHash)) ?? null;
          },
          async registerFailure(
            _scope: "IDENTIFIER",
            keyHash: Uint8Array,
            now: Date,
            policy: { maxAttempts: number; windowMinutes: number; lockMinutes: number },
          ) {
            const key = throttleMapKey(keyHash);
            const next = nextThrottleState(draft.throttles.get(key) ?? null, now, policy);
            draft.throttles.set(key, next);
            return next;
          },
          async clear(_scope: "IDENTIFIER", keyHash: Uint8Array) {
            draft.throttles.delete(throttleMapKey(keyHash));
          },
        },
        sessions: {
          async create(input: CreateSessionInput) {
            const created: StoredSession = {
              ...structuredClone(input),
              id: SESSION_ID,
              revokedAt: null,
              revocationReason: null,
            };
            draft.sessions.push(created);
            return created;
          },
          async revokeById(id: string, now: Date, reason: string) {
            const target = draft.sessions.find(
              (candidate) => candidate.id === id && candidate.revokedAt === null,
            );
            if (target) {
              target.revokedAt = now;
              target.revocationReason = reason;
            }
          },
          async revokeAllForUser(userId: string, now: Date, reason: string) {
            let count = 0;
            for (const target of draft.sessions) {
              if (target.userId === userId && target.revokedAt === null) {
                target.revokedAt = now;
                target.revocationReason = reason;
                count += 1;
              }
            }
            return count;
          },
        },
        audit: {
          async append(input: AppendAuditLogInput) {
            draft.audits.push(structuredClone(input));
            return { id: `audit-${draft.audits.length}`, ...input, createdAt: NOW };
          },
        },
      };

      const result = await work(repositories as unknown as IdentityRepositories);
      state.users = draft.users;
      state.throttles = draft.throttles;
      state.sessions = draft.sessions;
      state.audits = draft.audits;
      return result;
    },
  };
}

function createPasswordPort() {
  return {
    verify: vi.fn(async (hash: string, password: string): Promise<PasswordVerification> => {
      if (hash.startsWith("legacy:") && hash.slice("legacy:".length) === password) {
        return { valid: true, needsRehash: true };
      }
      return { valid: hash === `hash:${password}`, needsRehash: false };
    }),
    hash: vi.fn(async (password: string) => `hash:${password}`),
  };
}

function createHarness(
  options: {
    state?: FakeState;
    securityRows?: Array<UserRecord | null>;
    users?: {
      findByCanonicalEmail(email: string): Promise<UserRecord | null>;
      findById(id: string): Promise<UserRecord | null>;
    };
    passwordPort?: ReturnType<typeof createPasswordPort>;
    unitOfWorkError?: Error;
  } = {},
) {
  const state = options.state ?? {
    users: [user()],
    throttles: new Map(),
    sessions: [],
    audits: [],
  };
  const passwords = options.passwordPort ?? createPasswordPort();
  const users = options.users ?? {
    async findByCanonicalEmail(email: string) {
      return state.users.find((candidate) => candidate.email === email) ?? null;
    },
    async findById(id: string) {
      return state.users.find((candidate) => candidate.id === id) ?? null;
    },
  };
  const throttle = new LoginThrottleService({
    sessionSecret: "s".repeat(32),
    maxAttempts: 5,
    lockMinutes: 15,
  });
  const service = new AuthService({
    users,
    unitOfWork: createUnitOfWork(state, {
      ...(options.securityRows ? { securityRows: options.securityRows } : {}),
      ...(options.unitOfWorkError ? { fail: options.unitOfWorkError } : {}),
    }),
    throttle,
    clock: { now: () => NOW },
    entropy: { bytes: (length: number) => ENTROPY.slice(0, length) },
    passwords,
    sessionSecret: "s".repeat(32),
    sessionIdleMinutes: 120,
    sessionAbsoluteHours: 24,
  });

  return { state, service, passwords, throttle };
}

async function captureApplicationError(operation: Promise<unknown>): Promise<AuthApplicationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthApplicationError);
    return error as AuthApplicationError;
  }
  throw new Error("Expected AuthApplicationError");
}

describe("AuthService login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes the identifier, dummy-verifies the fixed PHC once, and commits failure before 401", async () => {
    const harness = createHarness({
      state: { users: [], throttles: new Map(), sessions: [], audits: [] },
    });

    const error = await captureApplicationError(
      harness.service.login({ email: "  UNKNOWN@Example.COM ", password: "wrong" }),
    );

    expect(error).toMatchObject({ status: 401, code: "AUTH_INVALID_CREDENTIALS" });
    expect(harness.passwords.verify).toHaveBeenCalledExactlyOnceWith(
      FIXED_DUMMY_PASSWORD_HASH,
      "wrong",
    );
    expect(harness.state.audits).toEqual([
      {
        actorUserId: null,
        targetUserId: null,
        action: "LOGIN_FAILED",
        outcome: "FAILURE",
        requestId: null,
        metadata: { reason: "UNKNOWN_IDENTIFIER" },
      },
    ]);
    expect(harness.state.throttles.size).toBe(1);
    expect(JSON.stringify(harness.state)).not.toMatch(/unknown@example\.com|wrong/u);
  });

  it("real-verifies disabled users and reports their failure only after committing it", async () => {
    const disabled = user({ isEnabled: false, disabledAt: NOW });
    const harness = createHarness({
      state: { users: [disabled], throttles: new Map(), sessions: [], audits: [] },
    });

    const error = await captureApplicationError(
      harness.service.login({ email: disabled.email, password: CURRENT_PASSWORD }),
    );

    expect(error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(harness.passwords.verify).toHaveBeenCalledExactlyOnceWith(
      disabled.passwordHash,
      CURRENT_PASSWORD,
    );
    expect(harness.state.audits[0]?.metadata).toEqual({ reason: "USER_DISABLED" });
    expect(harness.state.sessions).toHaveLength(0);
  });

  it("never rehashes a wrong password or malformed stored PHC", async () => {
    const passwords = createPasswordPort();
    passwords.verify.mockResolvedValue({ valid: false, needsRehash: true });
    const harness = createHarness({
      state: {
        users: [user({ passwordHash: "malformed-phc" })],
        throttles: new Map(),
        sessions: [],
        audits: [],
      },
      passwordPort: passwords,
    });

    await captureApplicationError(
      harness.service.login({ email: "viewer@example.com", password: "wrong" }),
    );

    expect(passwords.hash).not.toHaveBeenCalled();
    expect(harness.state.audits[0]?.metadata).toEqual({ reason: "INVALID_PASSWORD" });
  });

  it("makes the fifth failure itself rate-limited and preserves attempts in committed state", async () => {
    const harness = createHarness();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const error = await captureApplicationError(
        harness.service.login({ email: "viewer@example.com", password: "wrong" }),
      );
      expect(error.code).toBe("AUTH_INVALID_CREDENTIALS");
    }
    const fifth = await captureApplicationError(
      harness.service.login({ email: "viewer@example.com", password: "wrong" }),
    );

    expect(fifth).toMatchObject({
      status: 429,
      code: "AUTH_RATE_LIMITED",
      retryAfterSeconds: 900,
    });
    expect([...harness.state.throttles.values()][0]).toEqual({
      attemptCount: 5,
      windowStartedAt: NOW,
      blockedUntil: new Date("2026-08-22T01:15:00.000Z"),
    });
    expect(harness.state.audits.map((audit) => audit.metadata)).toEqual([
      { reason: "INVALID_PASSWORD" },
      { reason: "INVALID_PASSWORD" },
      { reason: "INVALID_PASSWORD" },
      { reason: "INVALID_PASSWORD" },
      { reason: "THROTTLED_IDENTIFIER" },
    ]);
  });

  it("short-circuits a preblocked bucket without Argon or another increment", async () => {
    const state: FakeState = { users: [user()], throttles: new Map(), sessions: [], audits: [] };
    const harness = createHarness({ state });
    state.throttles.set(throttleMapKey(harness.throttle.identifierKey("viewer@example.com")), {
      attemptCount: 5,
      windowStartedAt: NOW,
      blockedUntil: new Date("2026-08-22T01:05:00.000Z"),
    });

    const error = await captureApplicationError(
      harness.service.login({ email: "viewer@example.com", password: CURRENT_PASSWORD }),
    );

    expect(error).toMatchObject({ code: "AUTH_RATE_LIMITED", retryAfterSeconds: 300 });
    expect(harness.passwords.verify).not.toHaveBeenCalled();
    expect([...state.throttles.values()][0]?.attemptCount).toBe(5);
    expect(state.audits[0]?.metadata).toEqual({ reason: "THROTTLED_IDENTIFIER" });
  });

  it("preserves a block that wins the success race and commits only its throttled audit", async () => {
    const state: FakeState = { users: [user()], throttles: new Map(), sessions: [], audits: [] };
    let key = "";
    const passwords = createPasswordPort();
    passwords.verify.mockImplementation(async (hash, password) => {
      state.throttles.set(key, {
        attemptCount: 5,
        windowStartedAt: NOW,
        blockedUntil: new Date("2026-08-22T01:15:00.000Z"),
      });
      return { valid: hash === `hash:${password}`, needsRehash: false };
    });
    const harness = createHarness({ state, passwordPort: passwords });
    key = throttleMapKey(harness.throttle.identifierKey("viewer@example.com"));

    const error = await captureApplicationError(
      harness.service.login({ email: "viewer@example.com", password: CURRENT_PASSWORD }),
    );

    expect(error).toMatchObject({ code: "AUTH_RATE_LIMITED", retryAfterSeconds: 900 });
    expect(state.throttles.get(key)?.attemptCount).toBe(5);
    expect(state.sessions).toHaveLength(0);
    expect(state.audits).toEqual([
      {
        actorUserId: null,
        targetUserId: USER_ID,
        action: "LOGIN_FAILED",
        outcome: "FAILURE",
        requestId: null,
        metadata: { reason: "THROTTLED_IDENTIFIER" },
      },
    ]);
  });

  it("atomically rehashes, clears the bucket, creates a fresh HMAC-only session, and audits success", async () => {
    const legacyUser = user({ passwordHash: `legacy:${CURRENT_PASSWORD}` });
    const state: FakeState = {
      users: [legacyUser],
      throttles: new Map(),
      sessions: [],
      audits: [],
    };
    const harness = createHarness({ state });
    state.throttles.set(throttleMapKey(harness.throttle.identifierKey(legacyUser.email)), {
      attemptCount: 2,
      windowStartedAt: NOW,
      blockedUntil: null,
    });

    const result = await harness.service.login({
      email: "  VIEWER@example.com ",
      password: CURRENT_PASSWORD,
    });
    const expectedToken = Buffer.from(ENTROPY).toString("base64url");

    expect(result).toEqual({
      user: {
        id: legacyUser.id,
        email: legacyUser.email,
        role: "VIEWER",
        isEnabled: true,
        createdAt: legacyUser.createdAt.toISOString(),
        updatedAt: legacyUser.updatedAt.toISOString(),
        disabledAt: null,
      },
      sessionToken: expectedToken,
    });
    expect(state.users[0]?.passwordHash).toBe(`hash:${CURRENT_PASSWORD}`);
    expect(state.throttles.size).toBe(0);
    expect(state.sessions).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        tokenHash: new Uint8Array(
          createHmac("sha256", "s".repeat(32)).update(expectedToken, "utf8").digest(),
        ),
        now: NOW,
        idleExpiresAt: new Date("2026-08-22T03:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-08-23T01:00:00.000Z"),
      }),
    ]);
    expect(state.audits).toEqual([
      {
        actorUserId: USER_ID,
        targetUserId: USER_ID,
        action: "LOGIN_SUCCEEDED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { passwordRehashed: true },
      },
    ]);
    expect(JSON.stringify({ result, audits: state.audits })).not.toMatch(
      /passwordHash|tokenHash|current password/u,
    );
  });

  it("retries canonical lookup once for locked email/hash drift, then fails generically and audits it", async () => {
    const original = user();
    const rootLookup = vi.fn(async () => structuredClone(original));
    const harness = createHarness({
      users: {
        findByCanonicalEmail: rootLookup,
        findById: vi.fn(async () => original),
      },
      securityRows: [
        user({ email: "renamed-once@example.com" }),
        user({ passwordHash: "hash:changed-again" }),
      ],
    });

    const error = await captureApplicationError(
      harness.service.login({ email: original.email, password: CURRENT_PASSWORD }),
    );

    expect(error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(rootLookup).toHaveBeenCalledTimes(2);
    expect(harness.passwords.verify).toHaveBeenCalledTimes(2);
    expect(harness.state.sessions).toHaveLength(0);
    expect(harness.state.audits).toHaveLength(1);
    expect(harness.state.audits[0]?.metadata).toEqual({ reason: "CREDENTIAL_STATE_CHANGED" });
  });
});

describe("AuthService logout and password change", () => {
  it("commits logout revocation and its allowlisted audit atomically", async () => {
    const state: FakeState = {
      users: [user()],
      throttles: new Map(),
      sessions: [
        {
          id: SESSION_ID,
          userId: USER_ID,
          tokenHash: new Uint8Array([1]),
          now: NOW,
          idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
          absoluteExpiresAt: new Date("2026-08-23T01:00:00.000Z"),
          revokedAt: null,
          revocationReason: null,
        },
      ],
      audits: [],
    };
    const harness = createHarness({ state });

    await harness.service.logout({ userId: USER_ID, sessionId: SESSION_ID });

    expect(state.sessions[0]).toMatchObject({ revokedAt: NOW, revocationReason: "logout" });
    expect(state.audits).toEqual([
      {
        actorUserId: USER_ID,
        targetUserId: USER_ID,
        action: "LOGOUT",
        outcome: "SUCCESS",
        requestId: null,
        metadata: null,
      },
    ]);
  });

  it("commits only the failure audit before returning wrong-current-password", async () => {
    const harness = createHarness();

    const error = await captureApplicationError(
      harness.service.changePassword({
        userId: USER_ID,
        currentPassword: "wrong",
        newPassword: NEW_PASSWORD,
      }),
    );

    expect(error).toMatchObject({ status: 401, code: "AUTH_INVALID_CREDENTIALS" });
    expect(harness.state.users[0]?.passwordHash).toBe(`hash:${CURRENT_PASSWORD}`);
    expect(harness.state.sessions).toHaveLength(0);
    expect(harness.state.audits).toEqual([
      {
        actorUserId: USER_ID,
        targetUserId: USER_ID,
        action: "PASSWORD_CHANGED",
        outcome: "FAILURE",
        requestId: null,
        metadata: { reason: "INVALID_CURRENT_PASSWORD" },
      },
    ]);
  });

  it("updates the locked hash, revokes every active session, and audits the count atomically", async () => {
    const state: FakeState = {
      users: [user()],
      throttles: new Map(),
      sessions: [
        {
          id: SESSION_ID,
          userId: USER_ID,
          tokenHash: new Uint8Array([1]),
          now: NOW,
          idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
          absoluteExpiresAt: new Date("2026-08-23T01:00:00.000Z"),
          revokedAt: null,
          revocationReason: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          userId: USER_ID,
          tokenHash: new Uint8Array([2]),
          now: NOW,
          idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
          absoluteExpiresAt: new Date("2026-08-23T01:00:00.000Z"),
          revokedAt: null,
          revocationReason: null,
        },
      ],
      audits: [],
    };
    const harness = createHarness({ state });

    await harness.service.changePassword({
      userId: USER_ID,
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(state.users[0]?.passwordHash).toBe(`hash:${NEW_PASSWORD}`);
    expect(state.sessions.every((session) => session.revocationReason === "password-changed")).toBe(
      true,
    );
    expect(state.audits[0]).toEqual({
      actorUserId: USER_ID,
      targetUserId: USER_ID,
      action: "PASSWORD_CHANGED",
      outcome: "SUCCESS",
      requestId: null,
      metadata: { revokedSessionCount: 2 },
    });
    expect(JSON.stringify(state.audits.map((audit) => audit.metadata))).not.toMatch(
      /password|token|email|hash/iu,
    );
  });

  it("reverifies once after current-hash drift and commits only failure when it no longer matches", async () => {
    const original = user();
    const changed = user({ passwordHash: "hash:different current password" });
    const findById = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(changed);
    const harness = createHarness({
      users: {
        findByCanonicalEmail: vi.fn(async () => original),
        findById,
      },
      securityRows: [changed, changed],
    });

    const error = await captureApplicationError(
      harness.service.changePassword({
        userId: USER_ID,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    );

    expect(error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(findById).toHaveBeenCalledTimes(2);
    expect(harness.passwords.verify).toHaveBeenCalledTimes(2);
    expect(harness.state.users[0]?.passwordHash).toBe(`hash:${CURRENT_PASSWORD}`);
    expect(harness.state.audits[0]?.metadata).toEqual({ reason: "INVALID_CURRENT_PASSWORD" });
  });

  it("can succeed after one locked-hash drift only by completing verification again", async () => {
    const original = user();
    const changed = user({ passwordHash: "same-password-new-phc" });
    const findById = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(changed);
    const passwords = createPasswordPort();
    passwords.verify.mockImplementation(async (hash, password) => ({
      valid:
        password === CURRENT_PASSWORD &&
        (hash === original.passwordHash || hash === changed.passwordHash),
      needsRehash: false,
    }));
    const harness = createHarness({
      users: {
        findByCanonicalEmail: vi.fn(async () => original),
        findById,
      },
      securityRows: [changed, changed],
      passwordPort: passwords,
    });

    await harness.service.changePassword({
      userId: USER_ID,
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(findById).toHaveBeenCalledTimes(2);
    expect(passwords.verify).toHaveBeenCalledTimes(2);
    expect(harness.state.users[0]?.passwordHash).toBe(`hash:${NEW_PASSWORD}`);
    expect(harness.state.audits[0]?.outcome).toBe("SUCCESS");
  });

  it("propagates infrastructure rollback without returning a committed public outcome", async () => {
    const databaseError = new Error("database unavailable");
    const harness = createHarness({ unitOfWorkError: databaseError });

    await expect(harness.service.logout({ userId: USER_ID, sessionId: SESSION_ID })).rejects.toBe(
      databaseError,
    );
    expect(harness.state.audits).toHaveLength(0);
  });
});
