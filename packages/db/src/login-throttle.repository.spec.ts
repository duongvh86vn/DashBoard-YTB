import { describe, expect, it, vi } from "vitest";

import {
  LoginThrottleRepository,
  TransactionLoginThrottleRepository,
} from "./login-throttle.repository.js";

const keyHash = new Uint8Array([1, 2, 3]);
const current = {
  id: "00000000-0000-4000-8000-000000000001",
  scope: "IDENTIFIER" as const,
  keyHash,
  attemptCount: 4,
  windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
  blockedUntil: null,
  updatedAt: new Date("2026-08-22T00:00:00.000Z"),
};

describe("TransactionLoginThrottleRepository", () => {
  it("locks before reading the current bucket without opening a nested transaction", async () => {
    const lock = vi.fn(async () => 1);
    const findUnique = vi.fn(async () => current);
    const repository = new TransactionLoginThrottleRepository({
      $executeRaw: lock,
      loginThrottle: { findUnique },
    } as never);

    await expect(repository.getLocked("IDENTIFIER", keyHash)).resolves.toEqual({
      attemptCount: 4,
      windowStartedAt: current.windowStartedAt,
      blockedUntil: null,
    });
    expect(lock).toHaveBeenCalledOnce();
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
  });

  it("applies the fifth failure while holding the same transaction lock", async () => {
    const lock = vi.fn(async () => 1);
    const update = vi.fn(async ({ data }: { data: object }) => ({ ...current, ...data }));
    const repository = new TransactionLoginThrottleRepository({
      $executeRaw: lock,
      loginThrottle: {
        findUnique: vi.fn(async () => current),
        create: vi.fn(),
        update,
      },
    } as never);
    const now = new Date("2026-08-22T00:01:00.000Z");

    await expect(
      repository.registerFailure("IDENTIFIER", keyHash, now, {
        maxAttempts: 5,
        windowMinutes: 15,
        lockMinutes: 30,
      }),
    ).resolves.toEqual({
      attemptCount: 5,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:31:00.000Z"),
    });
    expect(lock).toHaveBeenCalledOnce();
  });

  it("clears idempotently while holding the same transaction lock", async () => {
    const lock = vi.fn(async () => 1);
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const repository = new TransactionLoginThrottleRepository({
      $executeRaw: lock,
      loginThrottle: { deleteMany },
    } as never);

    await expect(repository.clear("IDENTIFIER", keyHash)).resolves.toBeUndefined();
    expect(lock).toHaveBeenCalledOnce();
  });
});

describe("LoginThrottleRepository", () => {
  it("preserves the root get API", async () => {
    const findUnique = vi.fn(async () => current);
    const repository = new LoginThrottleRepository({
      loginThrottle: { findUnique },
    } as never);

    await expect(repository.get("IDENTIFIER", keyHash)).resolves.toEqual({
      attemptCount: 4,
      windowStartedAt: current.windowStartedAt,
      blockedUntil: null,
    });
  });

  it("delegates root mutations through their own transactions", async () => {
    const lock = vi.fn(async () => 1);
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const transaction = vi.fn(async (work: (client: unknown) => Promise<unknown>) =>
      work({
        $executeRaw: lock,
        loginThrottle: {
          findUnique: vi.fn(async () => null),
          create: vi.fn(async ({ data }: { data: object }) => ({
            id: "bucket-id",
            updatedAt: new Date("2026-08-22T00:00:00.000Z"),
            ...data,
          })),
          deleteMany,
        },
      }),
    );
    const repository = new LoginThrottleRepository({ $transaction: transaction } as never);
    const now = new Date("2026-08-22T00:00:00.000Z");

    await repository.registerFailure("IDENTIFIER", keyHash, now, {
      maxAttempts: 5,
      windowMinutes: 15,
      lockMinutes: 15,
    });
    await repository.clear("IDENTIFIER", keyHash);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledOnce();
  });
});
