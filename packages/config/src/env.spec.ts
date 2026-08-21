import { describe, expect, it } from "vitest";

import { parseApiEnv, parseWebEnv, parseWorkerEnv } from "./index.js";

const DATABASE_URL = "postgresql://monitor:password@postgres:5432/youtube_monitor";

describe("environment parsing", () => {
  it.each([
    "postgresql://monitor:password@postgres:5432/youtube_monitor",
    "postgres://monitor:password@postgres:5432/youtube_monitor",
  ])("accepts a structurally valid PostgreSQL database URL: %s", (databaseUrl) => {
    expect(parseApiEnv({ DATABASE_URL: databaseUrl }).DATABASE_URL).toBe(databaseUrl);
  });

  it.each([
    "postgresql://",
    "postgresql://monitor:password@:5432/youtube_monitor",
    "postgresql://monitor:password@postgres:5432",
    "postgresql://monitor:password@postgres:5432/",
    "postgresql://not a valid URL/youtube_monitor",
    "mysql://monitor:password@database:3306/youtube_monitor",
  ])("rejects an invalid PostgreSQL database URL: %s", (databaseUrl) => {
    expect(() => parseApiEnv({ DATABASE_URL: databaseUrl })).toThrow();
  });

  it("rejects an API port outside the TCP range", () => {
    expect(() => parseApiEnv({ DATABASE_URL, API_PORT: "70000" })).toThrow();
  });

  it("uses the specification timezone and service ports by default", () => {
    const api = parseApiEnv({ DATABASE_URL });
    const web = parseWebEnv({});

    expect(api.APP_VERSION).toBe("0.1.0");
    expect(api.APP_TIMEZONE).toBe("Asia/Bangkok");
    expect(api.API_PORT).toBe(5000);
    expect(web.WEB_PORT).toBe(3000);
  });

  it("accepts an application version at the database column boundary", () => {
    const appVersion = "v".repeat(64);

    expect(parseApiEnv({ DATABASE_URL, APP_VERSION: appVersion }).APP_VERSION).toBe(appVersion);
  });

  it("rejects an application version longer than the database column", () => {
    expect(() => parseApiEnv({ DATABASE_URL, APP_VERSION: "v".repeat(65) })).toThrow();
  });

  it("rejects an invalid Web API internal URL", () => {
    expect(() => parseWebEnv({ API_INTERNAL_URL: "not-a-valid-url" })).toThrow();
  });

  it("keeps AI provider keys optional for the worker", () => {
    const worker = parseWorkerEnv({ DATABASE_URL });

    expect(worker.GEMINI_API_KEY).toBeUndefined();
    expect(worker.NVIDIA_API_KEY).toBeUndefined();
  });

  it("accepts a worker identifier at the database column boundary", () => {
    const workerId = "w".repeat(128);

    expect(parseWorkerEnv({ DATABASE_URL, WORKER_ID: workerId }).WORKER_ID).toBe(workerId);
  });

  it("rejects a worker identifier longer than the database column", () => {
    expect(() => parseWorkerEnv({ DATABASE_URL, WORKER_ID: "w".repeat(129) })).toThrow();
  });

  it("rejects a worker heartbeat stale threshold shorter than its interval", () => {
    expect(() =>
      parseWorkerEnv({
        DATABASE_URL,
        WORKER_HEARTBEAT_INTERVAL_SECONDS: "30",
        WORKER_HEARTBEAT_STALE_SECONDS: "15",
      }),
    ).toThrow();
  });
});
