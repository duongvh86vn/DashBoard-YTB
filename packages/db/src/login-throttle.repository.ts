import { nextThrottleState, type ThrottlePolicy, type ThrottleState } from "@yt-monitor/auth";

import type { DatabaseClient } from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";
import type { LoginThrottleScopeValue } from "./identity-records.js";

type ThrottleTransactionClient = Pick<Prisma.TransactionClient, "$executeRaw" | "loginThrottle">;

function toThrottleState(record: {
  attemptCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}): ThrottleState {
  return {
    attemptCount: record.attemptCount,
    windowStartedAt: record.windowStartedAt,
    blockedUntil: record.blockedUntil,
  };
}

function createThrottleLockKey(scope: LoginThrottleScopeValue, keyHash: Uint8Array): string {
  return `${scope}:${Buffer.from(keyHash).toString("base64url")}`;
}

export class TransactionLoginThrottleRepository {
  constructor(private readonly client: ThrottleTransactionClient) {}

  async getLocked(
    scope: LoginThrottleScopeValue,
    keyHash: Uint8Array,
  ): Promise<ThrottleState | null> {
    await this.acquireLock(scope, keyHash);
    return this.get(scope, keyHash);
  }

  async registerFailure(
    scope: LoginThrottleScopeValue,
    keyHash: Uint8Array,
    now: Date,
    policy: ThrottlePolicy,
  ): Promise<ThrottleState> {
    await this.acquireLock(scope, keyHash);
    const databaseKeyHash = Uint8Array.from(keyHash);
    const current = await this.client.loginThrottle.findUnique({
      where: { scope_keyHash: { scope, keyHash: databaseKeyHash } },
    });
    const currentState = current === null ? null : toThrottleState(current);
    const next = nextThrottleState(currentState, now, policy);

    if (current !== null && next === currentState) {
      return next;
    }

    if (current === null) {
      const created = await this.client.loginThrottle.create({
        data: {
          scope,
          keyHash: databaseKeyHash,
          attemptCount: next.attemptCount,
          windowStartedAt: next.windowStartedAt,
          blockedUntil: next.blockedUntil,
        },
      });
      return toThrottleState(created);
    }

    const updated = await this.client.loginThrottle.update({
      where: { id: current.id },
      data: {
        attemptCount: next.attemptCount,
        windowStartedAt: next.windowStartedAt,
        blockedUntil: next.blockedUntil,
      },
    });
    return toThrottleState(updated);
  }

  async clear(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<void> {
    await this.acquireLock(scope, keyHash);
    await this.client.loginThrottle.deleteMany({
      where: { scope, keyHash: Uint8Array.from(keyHash) },
    });
  }

  private async get(
    scope: LoginThrottleScopeValue,
    keyHash: Uint8Array,
  ): Promise<ThrottleState | null> {
    const record = await this.client.loginThrottle.findUnique({
      where: {
        scope_keyHash: { scope, keyHash: Uint8Array.from(keyHash) },
      },
    });
    return record === null ? null : toThrottleState(record);
  }

  private async acquireLock(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<void> {
    const lockKey = createThrottleLockKey(scope, keyHash);
    await this.client.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }
}

export class LoginThrottleRepository {
  constructor(private readonly client: DatabaseClient) {}

  async get(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<ThrottleState | null> {
    const record = await this.client.loginThrottle.findUnique({
      where: {
        scope_keyHash: { scope, keyHash: Uint8Array.from(keyHash) },
      },
    });
    return record === null ? null : toThrottleState(record);
  }

  registerFailure(
    scope: LoginThrottleScopeValue,
    keyHash: Uint8Array,
    now: Date,
    policy: ThrottlePolicy,
  ): Promise<ThrottleState> {
    return this.client.$transaction((transaction) =>
      new TransactionLoginThrottleRepository(transaction).registerFailure(
        scope,
        keyHash,
        now,
        policy,
      ),
    );
  }

  clear(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<void> {
    return this.client.$transaction((transaction) =>
      new TransactionLoginThrottleRepository(transaction).clear(scope, keyHash),
    );
  }
}
