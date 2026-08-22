import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 1_000;
export const DEFAULT_DATABASE_QUERY_TIMEOUT_MS = 1_500;
export const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 1_000;

function readPostgresSchema(databaseUrl: string): string | undefined {
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  if (schema !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(schema)) {
    throw new TypeError("DATABASE_URL schema must be a PostgreSQL identifier");
  }
  return schema;
}

export function createPostgresAdapterOptions(databaseUrl: string): { schema: string } | undefined {
  const schema = readPostgresSchema(databaseUrl);
  return schema ? { schema } : undefined;
}

export function createPostgresPoolConfig(
  databaseUrl: string,
  connectionTimeoutMillis = DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
  queryTimeoutMillis = DEFAULT_DATABASE_QUERY_TIMEOUT_MS,
  statementTimeoutMillis = DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
) {
  const schema = readPostgresSchema(databaseUrl);
  return {
    connectionString: databaseUrl,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  } as const;
}

export function createPrismaClient(databaseUrl: string): DatabaseClient {
  const adapter = new PrismaPg(
    createPostgresPoolConfig(databaseUrl),
    createPostgresAdapterOptions(databaseUrl),
  );
  return new PrismaClient({ adapter });
}
