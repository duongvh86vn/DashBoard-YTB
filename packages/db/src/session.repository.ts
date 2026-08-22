import type { Prisma } from "./generated/prisma/client.js";

import type { SessionRecord, UsableSessionRecord } from "./identity-records.js";

type SessionClient = Pick<Prisma.TransactionClient, "session">;

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
    const session = await this.client.session.findUnique({ where: { id } });
    if (session === null) {
      return null;
    }

    const idleExpiresAt =
      requestedIdleExpiry.getTime() < session.absoluteExpiresAt.getTime()
        ? requestedIdleExpiry
        : session.absoluteExpiresAt;

    return this.client.session.update({
      where: { id },
      data: { lastSeenAt: now, idleExpiresAt },
    });
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
