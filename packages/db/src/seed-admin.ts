import {
  assertPasswordPolicy,
  AuthInputError,
  hashPassword as hashPasswordWithAuth,
  isValidCanonicalEmail,
  normalizeEmail,
} from "@yt-monitor/auth";

import type { DatabaseClient } from "./client.js";
import { SeedAdminConflictError } from "./identity-errors.js";

export interface SeedAdminInput {
  email: string;
  password: string;
}

export interface SeedAdminDependencies {
  client: DatabaseClient;
  hashPassword?: (password: string) => Promise<string>;
}

export type SeedAdminResult = { status: "CREATED" | "UNCHANGED" };

const BOOTSTRAP_ADMIN_LOCK_KEY = "yt-monitor:seed-initial-admin:v1";

function validateCanonicalEmail(email: string): void {
  if (!isValidCanonicalEmail(email)) {
    throw new AuthInputError("A valid bootstrap admin email is required");
  }
}

export async function seedInitialAdmin(
  input: SeedAdminInput,
  dependencies: SeedAdminDependencies,
): Promise<SeedAdminResult> {
  const email = normalizeEmail(input.email);
  validateCanonicalEmail(email);
  assertPasswordPolicy(input.password);

  return dependencies.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${BOOTSTRAP_ADMIN_LOCK_KEY}, 0))
    `;

    const existingUsers = await transaction.user.findMany();
    if (existingUsers.length === 0) {
      const passwordHash = await (dependencies.hashPassword ?? hashPasswordWithAuth)(
        input.password,
      );
      await transaction.user.create({
        data: {
          email,
          passwordHash,
          role: "ADMIN",
          isEnabled: true,
        },
      });
      return { status: "CREATED" };
    }

    const admins = existingUsers.filter((user) => user.role === "ADMIN");
    if (
      admins.length === 1 &&
      admins[0]?.email === email &&
      admins[0].isEnabled &&
      admins[0].disabledAt === null
    ) {
      return { status: "UNCHANGED" };
    }

    throw new SeedAdminConflictError();
  });
}
