import { describe, expect, it } from "vitest";

import {
  createPostgresPoolConfig,
  DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
  DEFAULT_DATABASE_QUERY_TIMEOUT_MS,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
} from "./client.js";

describe("createPostgresPoolConfig", () => {
  it("bounds connection attempts so health checks can fail fast", () => {
    expect(createPostgresPoolConfig("postgresql://monitor:secret@postgres:5432/monitor")).toEqual({
      connectionString: "postgresql://monitor:secret@postgres:5432/monitor",
      connectionTimeoutMillis: DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS,
      query_timeout: DEFAULT_DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    });
    expect(DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS).toBeLessThan(3_000);
    expect(DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS).toBeLessThan(DEFAULT_DATABASE_QUERY_TIMEOUT_MS);
    expect(DEFAULT_DATABASE_QUERY_TIMEOUT_MS).toBeLessThan(3_000);
  });

  it("accepts explicit connection, client-query, and server-statement deadlines", () => {
    expect(createPostgresPoolConfig("postgresql://localhost/monitor", 250, 350, 300)).toMatchObject(
      {
        connectionTimeoutMillis: 250,
        query_timeout: 350,
        statement_timeout: 300,
      },
    );
  });
});
