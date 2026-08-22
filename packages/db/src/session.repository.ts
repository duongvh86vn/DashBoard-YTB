import type { Prisma } from "./generated/prisma/client.js";

import type { SessionRecord, UsableSessionRecord } from "./identity-records.js";

type SessionClient = Pick<Prisma.TransactionClient, "$queryRaw" | "session">;

export interface CreateSessionInput {
  userId: string;
  tokenHash: Uint8Array;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

const sessionUserSelection = {
  id: true,
  email: true,
  role: true,
  isEnabled: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
} as const;

export class SessionRepository {
  constructor(private readonly client: SessionClient) {}

  create(input: CreateSessionInput): Promise<SessionRecord> {
    return this.client.session.create({
      data: {
        userId: input.userId,
        tokenHash: Uint8Array.from(input.tokenHash),
        createdAt: input.now,
        lastSeenAt: input.now,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      },
    });
  }

  findUsableByHash(tokenHash: Uint8Array, now: Date): Promise<UsableSessionRecord | null> {
    return this.client.session.findFirst({
      where: {
        tokenHash: Uint8Array.from(tokenHash),
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { isEnabled: true },
      },
      include: {
        user: { select: sessionUserSelection },
      },
    });
  }

  async touch(id: string, now: Date, requestedIdleExpiry: Date): Promise<SessionRecord | null> {
    const touched = await this.client.$queryRaw<SessionRecord[]>`
      WITH input AS (
        SELECT
          ${id}::uuid AS id,
          ${now}::timestamptz AS now,
          ${requestedIdleExpiry}::timestamptz AS requested_idle_expiry
      )
      UPDATE "sessions" AS session
      SET
        "last_seen_at" = input.now,
        "idle_expires_at" = LEAST(input.requested_idle_expiry, session."absolute_expires_at")
      FROM "users" AS account, input
      WHERE
        session."id" = input.id
        AND account."id" = session."user_id"
        AND session."revoked_at" IS NULL
        AND session."idle_expires_at" > input.now
        AND session."absolute_expires_at" > input.now
        AND account."is_enabled" = TRUE
      RETURNING
        session."id",
        session."user_id" AS "userId",
        session."token_hash" AS "tokenHash",
        session."created_at" AS "createdAt",
        session."last_seen_at" AS "lastSeenAt",
        session."idle_expires_at" AS "idleExpiresAt",
        session."absolute_expires_at" AS "absoluteExpiresAt",
        session."revoked_at" AS "revokedAt",
        session."revocation_reason" AS "revocationReason"
    `;

    return touched[0] ?? null;
  }

  async revokeById(id: string, now: Date, reason: string): Promise<void> {
    await this.client.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });
  }

  async revokeAllForUser(userId: string, now: Date, reason: string): Promise<number> {
    const result = await this.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revocationReason: reason },
    });

    return result.count;
  }
}
