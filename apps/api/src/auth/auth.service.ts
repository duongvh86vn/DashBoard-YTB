import {
  assertPasswordPolicy,
  calculateSessionExpiry,
  createSessionCredential,
  normalizeEmail,
  type PublicUser,
} from "@yt-monitor/auth";
import type { IdentityRepositories, UserRecord } from "@yt-monitor/db";

import { AuthApplicationError } from "./auth-application.error.js";
import type { AuthApplicationPort } from "./auth-application.port.js";
import type { Clock, EntropySource, PasswordPort } from "./auth-runtime.ports.js";
import type { LoginThrottleService } from "./login-throttle.service.js";

export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=1,t=3$WUhNLWR1bW15LXYxLXNhbHQ$j4f7wiVxLcRxDd1+QepaC+f3tRFUpYYLkNZ8iitDVb4";

type LoginFailureReason =
  | "UNKNOWN_IDENTIFIER"
  | "INVALID_PASSWORD"
  | "USER_DISABLED"
  | "THROTTLED_IDENTIFIER"
  | "CREDENTIAL_STATE_CHANGED";

interface UserLookupPort {
  findByCanonicalEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

interface IdentityUnitOfWorkPort {
  transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T>;
}

interface AuthServiceDependencies {
  users: UserLookupPort;
  unitOfWork: IdentityUnitOfWorkPort;
  throttle: LoginThrottleService;
  clock: Clock;
  entropy: EntropySource;
  passwords: PasswordPort;
  sessionSecret: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
}

function toPublicUser(user: UserRecord): PublicUser {
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

function isLookupSafeEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

export class AuthService implements AuthApplicationPort {
  constructor(private readonly dependencies: AuthServiceDependencies) {}

  async login(input: {
    email: string;
    password: string;
  }): Promise<{ user: PublicUser; sessionToken: string }> {
    const canonicalEmail = normalizeEmail(input.email);
    const now = this.dependencies.clock.now();
    const keyHash = this.dependencies.throttle.identifierKey(canonicalEmail);

    const preflight = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const current = await repositories.throttles.getLocked("IDENTIFIER", keyHash);
      if (current !== null && this.dependencies.throttle.isBlocked(current, now)) {
        await this.appendLoginFailure(repositories, null, "THROTTLED_IDENTIFIER");
        return { kind: "rate-limited" as const, blockedUntil: current.blockedUntil! };
      }
      return { kind: "continue" as const };
    });
    if (preflight.kind === "rate-limited") {
      throw AuthApplicationError.rateLimited(preflight.blockedUntil, now);
    }

    for (let stateAttempt = 0; stateAttempt < 2; stateAttempt += 1) {
      const target = isLookupSafeEmail(canonicalEmail)
        ? await this.dependencies.users.findByCanonicalEmail(canonicalEmail)
        : null;
      const verifiedHash = target?.passwordHash ?? DUMMY_PASSWORD_HASH;
      const verification = await this.dependencies.passwords.verify(verifiedHash, input.password);

      if (target === null) {
        return this.throwCommittedLoginFailure(keyHash, now, null, "UNKNOWN_IDENTIFIER");
      }
      if (!target.isEnabled) {
        return this.throwCommittedLoginFailure(keyHash, now, target, "USER_DISABLED");
      }
      if (!verification.valid) {
        return this.throwCommittedLoginFailure(keyHash, now, target, "INVALID_PASSWORD");
      }

      const replacementHash = verification.needsRehash
        ? await this.dependencies.passwords.hash(input.password)
        : null;
      const credential = createSessionCredential(
        this.dependencies.sessionSecret,
        this.dependencies.entropy.bytes(32),
      );
      const expiry = calculateSessionExpiry(
        now,
        this.dependencies.sessionIdleMinutes,
        this.dependencies.sessionAbsoluteHours,
      );

      const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const bucket = await repositories.throttles.getLocked("IDENTIFIER", keyHash);
        if (bucket !== null && this.dependencies.throttle.isBlocked(bucket, now)) {
          await this.appendLoginFailure(repositories, target.id, "THROTTLED_IDENTIFIER");
          return { kind: "rate-limited" as const, blockedUntil: bucket.blockedUntil! };
        }

        const locked = await repositories.users.findByIdForSecurityUpdate(target.id);
        if (
          locked === null ||
          !locked.isEnabled ||
          locked.email !== canonicalEmail ||
          locked.passwordHash !== verifiedHash
        ) {
          return { kind: "credential-state-changed" as const };
        }

        if (replacementHash !== null) {
          await repositories.users.updatePasswordHash(locked.id, replacementHash);
        }
        await repositories.throttles.clear("IDENTIFIER", keyHash);
        await repositories.sessions.create({
          userId: locked.id,
          tokenHash: credential.tokenHash,
          now: expiry.createdAt,
          idleExpiresAt: expiry.idleExpiresAt,
          absoluteExpiresAt: expiry.absoluteExpiresAt,
        });
        await repositories.audit.append({
          actorUserId: locked.id,
          targetUserId: locked.id,
          action: "LOGIN_SUCCEEDED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { passwordRehashed: replacementHash !== null },
        });
        return { kind: "success" as const, user: toPublicUser(locked) };
      });

      if (outcome.kind === "success") {
        return { user: outcome.user, sessionToken: credential.token };
      }
      if (outcome.kind === "rate-limited") {
        throw AuthApplicationError.rateLimited(outcome.blockedUntil, now);
      }
      if (stateAttempt === 0) {
        continue;
      }

      return this.throwCommittedLoginFailure(keyHash, now, target, "CREDENTIAL_STATE_CHANGED");
    }

    throw new Error("Unreachable login credential-state retry");
  }

  async logout(input: { userId: string; sessionId: string }): Promise<void> {
    const now = this.dependencies.clock.now();
    await this.dependencies.unitOfWork.transaction(async (repositories) => {
      await repositories.sessions.revokeById(input.sessionId, now, "logout");
      await repositories.audit.append({
        actorUserId: input.userId,
        targetUserId: input.userId,
        action: "LOGOUT",
        outcome: "SUCCESS",
        requestId: null,
        metadata: null,
      });
    });
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    assertPasswordPolicy(input.newPassword);
    const now = this.dependencies.clock.now();

    for (let stateAttempt = 0; stateAttempt < 2; stateAttempt += 1) {
      const snapshot = await this.dependencies.users.findById(input.userId);
      if (snapshot === null || !snapshot.isEnabled) {
        await this.dependencies.unitOfWork.transaction(async (repositories) => {
          await repositories.users.findByIdForSecurityUpdate(input.userId);
        });
        return;
      }

      const verification = await this.dependencies.passwords.verify(
        snapshot.passwordHash,
        input.currentPassword,
      );
      const replacementHash = verification.valid
        ? await this.dependencies.passwords.hash(input.newPassword)
        : null;

      const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const locked = await repositories.users.findByIdForSecurityUpdate(input.userId);
        if (locked === null || !locked.isEnabled) {
          return { kind: "unavailable" as const };
        }
        if (locked.email !== snapshot.email || locked.passwordHash !== snapshot.passwordHash) {
          if (stateAttempt === 0) {
            return { kind: "credential-state-changed" as const };
          }
          await this.appendWrongCurrentPassword(repositories, input.userId);
          return { kind: "invalid-current-password" as const };
        }
        if (!verification.valid || replacementHash === null) {
          await this.appendWrongCurrentPassword(repositories, input.userId);
          return { kind: "invalid-current-password" as const };
        }

        await repositories.users.updatePasswordHash(input.userId, replacementHash);
        const revokedSessionCount = await repositories.sessions.revokeAllForUser(
          input.userId,
          now,
          "password-changed",
        );
        await repositories.audit.append({
          actorUserId: input.userId,
          targetUserId: input.userId,
          action: "PASSWORD_CHANGED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { revokedSessionCount },
        });
        return { kind: "success" as const };
      });

      if (outcome.kind === "credential-state-changed") {
        continue;
      }
      if (outcome.kind === "invalid-current-password") {
        throw AuthApplicationError.invalidCurrentPassword();
      }
      return;
    }
  }

  private async throwCommittedLoginFailure(
    keyHash: Uint8Array,
    now: Date,
    target: UserRecord | null,
    reason: Exclude<LoginFailureReason, "THROTTLED_IDENTIFIER">,
  ): Promise<never> {
    const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const next = await repositories.throttles.registerFailure(
        "IDENTIFIER",
        keyHash,
        now,
        this.dependencies.throttle.policy,
      );
      const blocked = this.dependencies.throttle.isBlocked(next, now);
      await this.appendLoginFailure(
        repositories,
        target?.id ?? null,
        blocked ? "THROTTLED_IDENTIFIER" : reason,
      );
      return blocked
        ? { kind: "rate-limited" as const, blockedUntil: next.blockedUntil! }
        : { kind: "invalid-credentials" as const };
    });

    if (outcome.kind === "rate-limited") {
      throw AuthApplicationError.rateLimited(outcome.blockedUntil, now);
    }
    throw AuthApplicationError.invalidLogin();
  }

  private appendLoginFailure(
    repositories: IdentityRepositories,
    targetUserId: string | null,
    reason: LoginFailureReason,
  ) {
    return repositories.audit.append({
      actorUserId: null,
      targetUserId,
      action: "LOGIN_FAILED",
      outcome: "FAILURE",
      requestId: null,
      metadata: { reason },
    });
  }

  private appendWrongCurrentPassword(repositories: IdentityRepositories, userId: string) {
    return repositories.audit.append({
      actorUserId: userId,
      targetUserId: userId,
      action: "PASSWORD_CHANGED",
      outcome: "FAILURE",
      requestId: null,
      metadata: { reason: "INVALID_CURRENT_PASSWORD" },
    });
  }
}
