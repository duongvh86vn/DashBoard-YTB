import { createHmac, randomBytes } from "node:crypto";

const SESSION_ENTROPY_BYTES = 32;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;

export interface SessionCredential {
  token: string;
  tokenHash: Uint8Array;
}

export interface SessionExpiry {
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionUsabilityInput {
  revokedAt: Date | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  userEnabled: boolean;
}

export function hashSessionToken(secret: string, token: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(token, "utf8").digest());
}

export function createSessionCredential(
  secret: string,
  entropy: Uint8Array = randomBytes(SESSION_ENTROPY_BYTES),
): SessionCredential {
  if (entropy.byteLength !== SESSION_ENTROPY_BYTES) {
    throw new RangeError("Session entropy must contain exactly 32 bytes");
  }

  const token = Buffer.from(entropy).toString("base64url");

  return {
    token,
    tokenHash: hashSessionToken(secret, token),
  };
}

export function calculateSessionExpiry(
  now: Date,
  idleMinutes: number,
  absoluteHours: number,
): SessionExpiry {
  const nowMilliseconds = now.getTime();
  const absoluteExpiresAt = new Date(nowMilliseconds + absoluteHours * MILLISECONDS_PER_HOUR);
  const idleExpiryMilliseconds = Math.min(
    nowMilliseconds + idleMinutes * MILLISECONDS_PER_MINUTE,
    absoluteExpiresAt.getTime(),
  );

  return {
    createdAt: new Date(nowMilliseconds),
    lastSeenAt: new Date(nowMilliseconds),
    idleExpiresAt: new Date(idleExpiryMilliseconds),
    absoluteExpiresAt,
  };
}

export function isSessionUsable(session: SessionUsabilityInput, now: Date): boolean {
  const nowMilliseconds = now.getTime();

  return (
    session.userEnabled &&
    session.revokedAt === null &&
    nowMilliseconds < session.idleExpiresAt.getTime() &&
    nowMilliseconds < session.absoluteExpiresAt.getTime()
  );
}
