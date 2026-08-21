import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 1_000;
export const DEFAULT_DATABASE_QUERY_TIMEOUT_MS = 1_500;
export const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 1_000;

export function createPostgresPoolConfig(
  databaseUrl: string,
  connectionTimeoutMillis = DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
  queryTimeoutMillis = DEFAULT_DATABASE_QUERY_TIMEOUT_MS,
  statementTimeoutMillis = DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
) {
  return {
    connectionString: databaseUrl,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
  } as const;
}

export function createPrismaClient(databaseUrl: string): DatabaseClient {
  const adapter = new PrismaPg(createPostgresPoolConfig(databaseUrl));
  return new PrismaClient({ adapter });
}
