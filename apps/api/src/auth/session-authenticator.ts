import { hashSessionToken, type PublicUser } from "@yt-monitor/auth";
import type { SessionRecord, UsableSessionRecord } from "@yt-monitor/db";

import type { Clock } from "./auth-runtime.ports.js";
import type {
  AuthenticatedPrincipal,
  SessionAuthenticationPort,
} from "./session-authentication.port.js";

const MILLISECONDS_PER_MINUTE = 60_000;

export interface SessionReader {
  findUsableByHash(tokenHash: Uint8Array, now: Date): Promise<UsableSessionRecord | null>;
  touch(id: string, now: Date, requestedIdleExpiry: Date): Promise<SessionRecord | null>;
}

function toPublicUser(user: UsableSessionRecord["user"]): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isEnabled: user.isEnabled,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    disabledAt: user.disabledAt?.toISOString() ?? null,
  };
}

export class SessionAuthenticator implements SessionAuthenticationPort {
  constructor(
    private readonly dependencies: {
      sessions: SessionReader;
      sessionSecret: string;
      idleMinutes: number;
      clock: Clock;
    },
  ) {}

  async authenticate(token: string): Promise<AuthenticatedPrincipal | null> {
    const now = this.dependencies.clock.now();
    const tokenHash = hashSessionToken(this.dependencies.sessionSecret, token);
    const session = await this.dependencies.sessions.findUsableByHash(tokenHash, now);
    if (session === null) {
      return null;
    }

    const requestedIdleExpiry = new Date(
      Math.min(
        now.getTime() + this.dependencies.idleMinutes * MILLISECONDS_PER_MINUTE,
        session.absoluteExpiresAt.getTime(),
      ),
    );
    const touched = await this.dependencies.sessions.touch(session.id, now, requestedIdleExpiry);
    if (touched === null) {
      return null;
    }

    return {
      user: toPublicUser(session.user),
      session: { id: session.id },
    };
  }
}
