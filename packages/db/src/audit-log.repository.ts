import { Prisma, type Prisma as PrismaTypes } from "./generated/prisma/client.js";

import type {
  AuditActionValue,
  AuditLogRecord,
  AuditMetadata,
  AuditOutcomeValue,
} from "./identity-records.js";

type AuditClient = Pick<PrismaTypes.TransactionClient, "auditLog">;

export interface AppendAuditLogInput {
  actorUserId: string | null;
  targetUserId: string | null;
  action: AuditActionValue;
  outcome: AuditOutcomeValue;
  requestId: string | null;
  metadata: AuditMetadata | null;
}

export class AuditLogRepository {
  constructor(private readonly client: AuditClient) {}

  append(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    return this.client.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        action: input.action,
        outcome: input.outcome,
        requestId: input.requestId,
        metadata: input.metadata ?? Prisma.DbNull,
      },
    });
  }
}
