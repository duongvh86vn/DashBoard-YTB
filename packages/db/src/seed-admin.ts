import {
  assertPasswordPolicy,
  AuthInputError,
  hashPassword as hashPasswordWithAuth,
  isValidCanonicalEmail,
  normalizeEmail,
} from "@yt-monitor/auth";

import type { DatabaseClient } from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";
import { SeedAdminConflictError } from "./identity-errors.js";
import type { UserRecord } from "./identity-records.js";

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

type BootstrapIdentityState = "EMPTY" | "UNCHANGED";
type BootstrapTransactionClient = Pick<Prisma.TransactionClient, "$executeRaw" | "user">;

function validateCanonicalEmail(email: string): void {
  if (!isValidCanonicalEmail(email)) {
    throw new AuthInputError("A valid bootstrap admin email is required");
  }
}

async function acquireBootstrapLock(transaction: BootstrapTransactionClient): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${BOOTSTRAP_ADMIN_LOCK_KEY}, 0))
  `;
}

function inspectIdentityState(
  existingUsers: readonly UserRecord[],
  email: string,
): BootstrapIdentityState {
  if (existingUsers.length === 0) return "EMPTY";

  const admins = existingUsers.filter((user) => user.role === "ADMIN");
  if (
    admins.length === 1 &&
    admins[0]?.email === email &&
    admins[0].isEnabled &&
    admins[0].disabledAt === null
  ) {
    return "UNCHANGED";
  }

  throw new SeedAdminConflictError();
}

async function inspectIdentityUnderLock(
  client: DatabaseClient,
  email: string,
): Promise<BootstrapIdentityState> {
  return client.$transaction(async (transaction) => {
    await acquireBootstrapLock(transaction);
    return inspectIdentityState(await transaction.user.findMany(), email);
  });
}

export async function seedInitialAdmin(
  input: SeedAdminInput,
  dependencies: SeedAdminDependencies,
): Promise<SeedAdminResult> {
  const email = normalizeEmail(input.email);
  validateCanonicalEmail(email);
  assertPasswordPolicy(input.password);

  const initialState = await inspectIdentityUnderLock(dependencies.client, email);
  if (initialState === "UNCHANGED") return { status: "UNCHANGED" };

  // Argon2 can legitimately take longer than the database statement deadline.
  // Hash outside the transaction, then lock and re-check before the only insert.
  const passwordHash = await (dependencies.hashPassword ?? hashPasswordWithAuth)(input.password);

  return dependencies.client.$transaction(async (transaction) => {
    await acquireBootstrapLock(transaction);
    const existingUsers = await transaction.user.findMany();
    const finalState = inspectIdentityState(existingUsers, email);
    if (finalState === "EMPTY") {
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
    return { status: "UNCHANGED" };
  });
}
