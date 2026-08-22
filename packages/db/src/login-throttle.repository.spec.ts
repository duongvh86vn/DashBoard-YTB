import { describe, expect, it, vi } from "vitest";

import { LoginThrottleRepository } from "./login-throttle.repository.js";

describe("LoginThrottleRepository", () => {
  it("applies nextThrottleState while holding the per-key transaction lock", async () => {
    const current = {
      id: "00000000-0000-4000-8000-000000000001",
      scope: "IDENTIFIER" as const,
      keyHash: new Uint8Array([1, 2, 3]),
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: null,
      updatedAt: new Date("2026-08-22T00:00:00.000Z"),
    };
    const lock = vi.fn(async () => 1);
    const update = vi.fn(async ({ data }: { data: object }) => ({ ...current, ...data }));
    const transaction = vi.fn(async (work: (transactionClient: unknown) => Promise<unknown>) =>
      work({
        $executeRaw: lock,
        loginThrottle: {
          findUnique: vi.fn(async () => current),
          create: vi.fn(),
          update,
        },
      }),
    );
    const repository = new LoginThrottleRepository({ $transaction: transaction } as never);
    const now = new Date("2026-08-22T00:01:00.000Z");

    await expect(
      repository.registerFailure("IDENTIFIER", current.keyHash, now, {
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

  it("clears a missing throttle row idempotently", async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const repository = new LoginThrottleRepository({ loginThrottle: { deleteMany } } as never);

    await expect(repository.clear("SOURCE", new Uint8Array([9, 9, 9]))).resolves.toBeUndefined();
  });
});
