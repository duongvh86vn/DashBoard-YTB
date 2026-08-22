import { describe, expect, it, vi } from "vitest";

import { AuditLogRepository } from "./audit-log.repository.js";
import { IdentityUnitOfWork } from "./identity-unit-of-work.js";
import { SessionRepository } from "./session.repository.js";
import { UserRepository } from "./user.repository.js";

describe("IdentityUnitOfWork", () => {
  it("runs identity repositories in one Serializable Prisma transaction", async () => {
    const transactionClient = { user: {}, session: {}, auditLog: {} };
    const transaction = vi.fn(
      async (work: (client: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
        expect(options).toEqual({ isolationLevel: "Serializable" });
        return work(transactionClient);
      },
    );
    const unitOfWork = new IdentityUnitOfWork({ $transaction: transaction } as never);

    await expect(
      unitOfWork.transaction(async ({ users, sessions, audit }) => {
        expect(users).toBeInstanceOf(UserRepository);
        expect(sessions).toBeInstanceOf(SessionRepository);
        expect(audit).toBeInstanceOf(AuditLogRepository);
        return "committed";
      }),
    ).resolves.toBe("committed");
  });
});
