import { nextThrottleState, type ThrottlePolicy, type ThrottleState } from "@yt-monitor/auth";

import type { DatabaseClient } from "./client.js";
import type { LoginThrottleScopeValue } from "./identity-records.js";

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

export class LoginThrottleRepository {
  constructor(private readonly client: DatabaseClient) {}

  async get(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<ThrottleState | null> {
    const databaseKeyHash = Uint8Array.from(keyHash);
    const record = await this.client.loginThrottle.findUnique({
      where: { scope_keyHash: { scope, keyHash: databaseKeyHash } },
    });

    return record === null ? null : toThrottleState(record);
  }

  async registerFailure(
    scope: LoginThrottleScopeValue,
    keyHash: Uint8Array,
    now: Date,
    policy: ThrottlePolicy,
  ): Promise<ThrottleState> {
    const lockKey = `${scope}:${Buffer.from(keyHash).toString("base64url")}`;
    const databaseKeyHash = Uint8Array.from(keyHash);

    return this.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;

      const current = await transaction.loginThrottle.findUnique({
        where: { scope_keyHash: { scope, keyHash: databaseKeyHash } },
      });
      const currentState = current === null ? null : toThrottleState(current);
      const next = nextThrottleState(currentState, now, policy);

      if (current !== null && next === currentState) {
        return next;
      }

      if (current === null) {
        const created = await transaction.loginThrottle.create({
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

      const updated = await transaction.loginThrottle.update({
        where: { id: current.id },
        data: {
          attemptCount: next.attemptCount,
          windowStartedAt: next.windowStartedAt,
          blockedUntil: next.blockedUntil,
        },
      });
      return toThrottleState(updated);
    });
  }

  async clear(scope: LoginThrottleScopeValue, keyHash: Uint8Array): Promise<void> {
    await this.client.loginThrottle.deleteMany({
      where: { scope, keyHash: Uint8Array.from(keyHash) },
    });
  }
}
