import type { DatabaseClient } from "./client.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { hasPrismaErrorCode } from "./identity-errors.js";
import { TransactionLoginThrottleRepository } from "./login-throttle.repository.js";
import { SessionRepository } from "./session.repository.js";
import { UserRepository } from "./user.repository.js";

export interface IdentityRepositories {
  users: UserRepository;
  sessions: SessionRepository;
  throttles: TransactionLoginThrottleRepository;
  audit: AuditLogRepository;
}

export class IdentityUnitOfWork {
  constructor(private readonly client: DatabaseClient) {}

  async transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.client.$transaction(
          (transaction) =>
            work({
              users: new UserRepository(transaction),
              sessions: new SessionRepository(transaction),
              throttles: new TransactionLoginThrottleRepository(transaction),
              audit: new AuditLogRepository(transaction),
            }),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (attempt === 0 && hasPrismaErrorCode(error, "P2034")) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Unreachable identity transaction retry state");
  }
}
