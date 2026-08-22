import type { DatabaseClient } from "./client.js";
import { AuditLogRepository } from "./audit-log.repository.js";
import { SessionRepository } from "./session.repository.js";
import { UserRepository } from "./user.repository.js";

export interface IdentityRepositories {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditLogRepository;
}

export class IdentityUnitOfWork {
  constructor(private readonly client: DatabaseClient) {}

  transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (transaction) =>
        work({
          users: new UserRepository(transaction),
          sessions: new SessionRepository(transaction),
          audit: new AuditLogRepository(transaction),
        }),
      { isolationLevel: "Serializable" },
    );
  }
}
