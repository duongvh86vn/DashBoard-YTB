export class IdentityConflictError extends Error {
  readonly code = "USER_ALREADY_EXISTS" as const;

  constructor() {
    super("A user with that email already exists");
    this.name = "IdentityConflictError";
  }
}

export class IdentityNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND" as const;

  constructor() {
    super("User not found");
    this.name = "IdentityNotFoundError";
  }
}

export class SeedAdminConflictError extends Error {
  readonly code = "SEED_ADMIN_CONFLICT" as const;

  constructor() {
    super("The existing identity store conflicts with bootstrap admin settings");
    this.name = "SeedAdminConflictError";
  }
}

export function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
