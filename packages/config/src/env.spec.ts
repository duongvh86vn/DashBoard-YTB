import { describe, expect, it } from "vitest";

import { parseApiEnv, parseWebEnv, parseWorkerEnv } from "./index.js";

const DATABASE_URL = "postgresql://monitor:password@postgres:5432/youtube_monitor";
const SESSION_SECRET = "s".repeat(32);

function validApiEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL,
    DEPLOYMENT_MODE: "LOCAL",
    APP_PUBLIC_URL: "http://127.0.0.1:3000",
    APP_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
    SESSION_SECRET,
    ...overrides,
  };
}

describe("environment parsing", () => {
  it("rejects a session secret shorter than 32 characters", () => {
    expect(() => parseApiEnv(validApiEnv({ SESSION_SECRET: "short" }))).toThrow();
  });

  it("normalizes the explicit local allowed-origin boundary", () => {
    expect(
      parseApiEnv(
        validApiEnv({
          APP_ALLOWED_ORIGINS: " http://127.0.0.1:3000, http://127.0.0.1:3000 ",
        }),
      ).APP_ALLOWED_ORIGINS,
    ).toEqual(["http://127.0.0.1:3000"]);
  });

  it("permits an IPv6 loopback HTTP public URL in LOCAL mode", () => {
    expect(
      parseApiEnv(
        validApiEnv({
          APP_PUBLIC_URL: "http://[::1]:3000",
          APP_ALLOWED_ORIGINS: "http://[::1]:3000",
        }),
      ).APP_PUBLIC_URL,
    ).toBe("http://[::1]:3000");
  });

  it("rejects a PUBLIC deployment with a non-HTTPS public URL", () => {
    expect(() =>
      parseApiEnv(
        validApiEnv({
          DEPLOYMENT_MODE: "PUBLIC",
          APP_PUBLIC_URL: "http://example.test",
          APP_ALLOWED_ORIGINS: "http://example.test",
        }),
      ),
    ).toThrow();
  });

  it("rejects allowed origins that omit the public URL", () => {
    expect(() =>
      parseApiEnv(validApiEnv({ APP_ALLOWED_ORIGINS: "http://localhost:3000" })),
    ).toThrow();
  });

  it.each([
    "postgresql://monitor:password@postgres:5432/youtube_monitor",
    "postgres://monitor:password@postgres:5432/youtube_monitor",
  ])("accepts a structurally valid PostgreSQL database URL: %s", (databaseUrl) => {
    expect(parseApiEnv(validApiEnv({ DATABASE_URL: databaseUrl })).DATABASE_URL).toBe(databaseUrl);
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
    expect(() => parseApiEnv(validApiEnv({ API_PORT: "70000" }))).toThrow();
  });

  it("uses the specification timezone and service ports by default", () => {
    const api = parseApiEnv(validApiEnv());
    const web = parseWebEnv({});

    expect(api.APP_VERSION).toBe("0.1.0");
    expect(api.APP_TIMEZONE).toBe("Asia/Bangkok");
    expect(api.API_PORT).toBe(5000);
    expect(web.WEB_PORT).toBe(3000);
  });

  it("accepts an application version at the database column boundary", () => {
    const appVersion = "v".repeat(64);

    expect(parseApiEnv(validApiEnv({ APP_VERSION: appVersion })).APP_VERSION).toBe(appVersion);
  });

  it("rejects an application version longer than the database column", () => {
    expect(() => parseApiEnv(validApiEnv({ APP_VERSION: "v".repeat(65) }))).toThrow();
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
