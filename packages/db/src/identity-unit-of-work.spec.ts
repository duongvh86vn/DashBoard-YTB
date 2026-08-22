import { describe, expect, it, vi } from "vitest";

import { AuditLogRepository } from "./audit-log.repository.js";
import { IdentityUnitOfWork } from "./identity-unit-of-work.js";
import { TransactionLoginThrottleRepository } from "./login-throttle.repository.js";
import { SessionRepository } from "./session.repository.js";
import { UserRepository } from "./user.repository.js";

describe("IdentityUnitOfWork", () => {
  it("runs every identity repository in one Serializable Prisma transaction", async () => {
    const transactionClient = {
      $executeRaw: vi.fn(),
      user: {},
      session: {},
      auditLog: {},
      loginThrottle: {},
    };
    const transaction = vi.fn(
      async (work: (client: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return work(transactionClient);
      },
    );
    const unitOfWork = new IdentityUnitOfWork({ $transaction: transaction } as never);

    await expect(
      unitOfWork.transaction(async ({ users, sessions, throttles, audit }) => {
        expect(users).toBeInstanceOf(UserRepository);
        expect(sessions).toBeInstanceOf(SessionRepository);
        expect(throttles).toBeInstanceOf(TransactionLoginThrottleRepository);
        expect(audit).toBeInstanceOf(AuditLogRepository);
        return "committed";
      }),
    ).resolves.toBe("committed");
  });

  it("retries a P2034 transaction exactly once", async () => {
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" });
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) =>
        work({ user: {}, session: {}, loginThrottle: {}, auditLog: {}, $executeRaw: vi.fn() }),
      );
    const unitOfWork = new IdentityUnitOfWork({ $transaction: transaction } as never);

    await expect(unitOfWork.transaction(async () => "committed")).resolves.toBe("committed");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry a second P2034 or any other error", async () => {
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" });
    const repeatedConflict = vi.fn().mockRejectedValue(conflict);
    const conflictingUnitOfWork = new IdentityUnitOfWork({
      $transaction: repeatedConflict,
    } as never);

    await expect(conflictingUnitOfWork.transaction(async () => undefined)).rejects.toBe(conflict);
    expect(repeatedConflict).toHaveBeenCalledTimes(2);

    const infrastructure = new Error("connection failed");
    const nonConflict = vi.fn().mockRejectedValue(infrastructure);
    const failingUnitOfWork = new IdentityUnitOfWork({ $transaction: nonConflict } as never);

    await expect(failingUnitOfWork.transaction(async () => undefined)).rejects.toBe(infrastructure);
    expect(nonConflict).toHaveBeenCalledOnce();
  });
});
