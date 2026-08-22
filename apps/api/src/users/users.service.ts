import {
  assertPasswordPolicy,
  isValidCanonicalEmail,
  normalizeEmail,
  type PublicUser,
} from "@yt-monitor/auth";
import type { IdentityRepositories, UserRecord } from "@yt-monitor/db";

import type { Clock, PasswordPort } from "../auth/auth-runtime.ports.js";
import { UserApplicationError } from "./user-application.error.js";
import type { UsersApplicationPort } from "./users-application.port.js";

interface IdentityUnitOfWorkPort {
  transaction<T>(work: (repositories: IdentityRepositories) => Promise<T>): Promise<T>;
}

interface UsersServiceDependencies {
  unitOfWork: IdentityUnitOfWorkPort;
  clock: Clock;
  passwords: PasswordPort;
}

type ProtectedOperation =
  "UPDATE_EMAIL" | "RESET_PASSWORD" | "REVOKE_SESSIONS" | "DISABLE" | "ENABLE" | "DELETE_ALIAS";

type LockedTargetOutcome =
  { kind: "viewer"; user: UserRecord } | { kind: "not-found" } | { kind: "protected" };

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

function validateCanonicalEmail(email: string): string {
  const canonical = normalizeEmail(email);
  if (!isValidCanonicalEmail(canonical)) {
    throw UserApplicationError.validation();
  }
  return canonical;
}

function validatePassword(password: string): void {
  try {
    assertPasswordPolicy(password);
  } catch {
    throw UserApplicationError.validation();
  }
}

function validatePage(input: { page: number; pageSize: number }): void {
  const offset = (input.page - 1) * input.pageSize;
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100 ||
    !Number.isSafeInteger(offset)
  ) {
    throw UserApplicationError.validation();
  }
}

function hasIdentityCode(error: unknown, code: "USER_NOT_FOUND" | "USER_ALREADY_EXISTS") {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function mapIdentityError(error: unknown): never {
  if (hasIdentityCode(error, "USER_ALREADY_EXISTS")) {
    throw UserApplicationError.alreadyExists();
  }
  if (hasIdentityCode(error, "USER_NOT_FOUND")) {
    throw UserApplicationError.notFound();
  }
  throw error;
}

export class UsersService implements UsersApplicationPort {
  constructor(private readonly dependencies: UsersServiceDependencies) {}

  async list(input: { page: number; pageSize: number }) {
    validatePage(input);
    const page = await this.dependencies.unitOfWork.transaction((repositories) =>
      repositories.users.listViewers(input),
    );
    return {
      items: page.items.map(toPublicUser),
      page: input.page,
      pageSize: input.pageSize,
      total: page.total,
    };
  }

  async create(input: {
    actorUserId: string;
    email: string;
    password: string;
  }): Promise<PublicUser> {
    const email = validateCanonicalEmail(input.email);
    validatePassword(input.password);
    const passwordHash = await this.dependencies.passwords.hash(input.password);

    try {
      const created = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const user = await repositories.users.create({ email, passwordHash, role: "VIEWER" });
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: user.id,
          action: "USER_CREATED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: null,
        });
        return user;
      });
      return toPublicUser(created);
    } catch (error) {
      return mapIdentityError(error);
    }
  }

  async updateEmail(input: {
    actorUserId: string;
    targetUserId: string;
    email: string;
  }): Promise<PublicUser> {
    const email = validateCanonicalEmail(input.email);

    try {
      const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
        const target = await this.lockTarget(
          repositories,
          input.actorUserId,
          input.targetUserId,
          "UPDATE_EMAIL",
        );
        if (target.kind !== "viewer") return target;

        const changed = target.user.email !== email;
        const updated = changed
          ? await repositories.users.updateEmail(target.user.id, email)
          : target.user;
        await repositories.audit.append({
          actorUserId: input.actorUserId,
          targetUserId: target.user.id,
          action: "USER_EMAIL_CHANGED",
          outcome: "SUCCESS",
          requestId: null,
          metadata: { changed },
        });
        return { kind: "success" as const, user: updated };
      });
      if (outcome.kind === "success") return toPublicUser(outcome.user);
      return this.throwTargetError(outcome);
    } catch (error) {
      if (error instanceof UserApplicationError) throw error;
      return mapIdentityError(error);
    }
  }

  async resetPassword(input: {
    actorUserId: string;
    targetUserId: string;
    password: string;
  }): Promise<void> {
    validatePassword(input.password);
    const passwordHash = await this.dependencies.passwords.hash(input.password);
    const now = this.dependencies.clock.now();
    const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const target = await this.lockTarget(
        repositories,
        input.actorUserId,
        input.targetUserId,
        "RESET_PASSWORD",
      );
      if (target.kind !== "viewer") return target;

      await repositories.users.updatePasswordHash(target.user.id, passwordHash);
      const revokedSessionCount = await repositories.sessions.revokeAllForUser(
        target.user.id,
        now,
        "admin-password-reset",
      );
      await repositories.audit.append({
        actorUserId: input.actorUserId,
        targetUserId: target.user.id,
        action: "USER_PASSWORD_RESET",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { revokedSessionCount },
      });
      return { kind: "success" as const };
    });
    if (outcome.kind !== "success") this.throwTargetError(outcome);
  }

  async revokeSessions(input: { actorUserId: string; targetUserId: string }): Promise<void> {
    const now = this.dependencies.clock.now();
    const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const target = await this.lockTarget(
        repositories,
        input.actorUserId,
        input.targetUserId,
        "REVOKE_SESSIONS",
      );
      if (target.kind !== "viewer") return target;

      const revokedSessionCount = await repositories.sessions.revokeAllForUser(
        target.user.id,
        now,
        "admin-sessions-revoked",
      );
      await repositories.audit.append({
        actorUserId: input.actorUserId,
        targetUserId: target.user.id,
        action: "USER_SESSIONS_REVOKED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { revokedSessionCount },
      });
      return { kind: "success" as const };
    });
    if (outcome.kind !== "success") this.throwTargetError(outcome);
  }

  async disable(input: {
    actorUserId: string;
    targetUserId: string;
    via: "DISABLE_ENDPOINT" | "DELETE_ALIAS";
  }): Promise<void> {
    const now = this.dependencies.clock.now();
    const operation = input.via === "DELETE_ALIAS" ? "DELETE_ALIAS" : "DISABLE";
    const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const target = await this.lockTarget(
        repositories,
        input.actorUserId,
        input.targetUserId,
        operation,
      );
      if (target.kind !== "viewer") return target;

      const changed = target.user.isEnabled;
      if (changed) {
        await repositories.users.setEnabled(target.user.id, false, now);
      }
      const revokedSessionCount = await repositories.sessions.revokeAllForUser(
        target.user.id,
        now,
        "admin-user-disabled",
      );
      await repositories.audit.append({
        actorUserId: input.actorUserId,
        targetUserId: target.user.id,
        action: "USER_DISABLED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { changed, revokedSessionCount, via: input.via },
      });
      return { kind: "success" as const };
    });
    if (outcome.kind !== "success") this.throwTargetError(outcome);
  }

  async enable(input: { actorUserId: string; targetUserId: string }): Promise<void> {
    const now = this.dependencies.clock.now();
    const outcome = await this.dependencies.unitOfWork.transaction(async (repositories) => {
      const target = await this.lockTarget(
        repositories,
        input.actorUserId,
        input.targetUserId,
        "ENABLE",
      );
      if (target.kind !== "viewer") return target;

      const changed = !target.user.isEnabled;
      if (changed) {
        await repositories.users.setEnabled(target.user.id, true, now);
      }
      await repositories.audit.append({
        actorUserId: input.actorUserId,
        targetUserId: target.user.id,
        action: "USER_ENABLED",
        outcome: "SUCCESS",
        requestId: null,
        metadata: { changed },
      });
      return { kind: "success" as const };
    });
    if (outcome.kind !== "success") this.throwTargetError(outcome);
  }

  private async lockTarget(
    repositories: IdentityRepositories,
    actorUserId: string,
    targetUserId: string,
    operation: ProtectedOperation,
  ): Promise<LockedTargetOutcome> {
    const target = await repositories.users.findByIdForSecurityUpdate(targetUserId);
    if (target === null) return { kind: "not-found" };
    if (target.role === "VIEWER") return { kind: "viewer", user: target };

    await repositories.audit.append({
      actorUserId,
      targetUserId: target.id,
      action: "AUTHORIZATION_DENIED",
      outcome: "FAILURE",
      requestId: null,
      metadata: { operation, reason: "ADMIN_TARGET_PROTECTED" },
    });
    return { kind: "protected" };
  }

  private throwTargetError(outcome: { kind: "not-found" } | { kind: "protected" }): never {
    if (outcome.kind === "not-found") throw UserApplicationError.notFound();
    throw UserApplicationError.forbidden();
  }
}
