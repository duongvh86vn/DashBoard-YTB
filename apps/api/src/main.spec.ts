import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrapHarness = vi.hoisted(() => ({
  scenario: "create-reject" as "create-reject" | "listen-reject",
  parseCalls: 0,
  clientCreations: 0,
  clientDisconnects: 0,
  factoryCreates: 0,
  abortAttempts: 0,
  appCloses: 0,
  listens: 0,
  createOptions: undefined as { abortOnError?: boolean; bufferLogs?: boolean } | undefined,
  client: undefined as { $disconnect(): Promise<void> } | undefined,
  repositoryClient: undefined as unknown,
  productionOptions: undefined as
    { databaseClient?: unknown; sessionAuthenticator?: unknown } | undefined,
}));

vi.mock("@yt-monitor/config", () => ({
  parseApiEnv() {
    bootstrapHarness.parseCalls += 1;
    return {
      DATABASE_URL: "postgresql://unused:unused@invalid.test/unused",
      API_PORT: 5000,
      TRUST_PROXY: false,
    };
  },
}));

vi.mock("@yt-monitor/db", () => ({
  createPrismaClient() {
    bootstrapHarness.clientCreations += 1;
    const client = {
      async $disconnect(): Promise<void> {
        bootstrapHarness.clientDisconnects += 1;
      },
    };
    bootstrapHarness.client = client;
    return client;
  },
  SessionRepository: class TestSessionRepository {
    constructor(client: unknown) {
      bootstrapHarness.repositoryClient = client;
    }
  },
}));

vi.mock("./app.module.js", () => ({
  AppModule: {
    forProduction(options: { databaseClient?: unknown; sessionAuthenticator?: unknown }) {
      bootstrapHarness.productionOptions = options;
      return { module: "test-app-module" };
    },
  },
}));

vi.mock("nestjs-pino", () => ({ Logger: class TestLogger {} }));

vi.mock("@nestjs/core", () => ({
  NestFactory: {
    async create(
      _module: unknown,
      options: { abortOnError?: boolean; bufferLogs?: boolean } | undefined,
    ) {
      bootstrapHarness.factoryCreates += 1;
      bootstrapHarness.createOptions = options;

      if (bootstrapHarness.scenario === "create-reject") {
        if (options?.abortOnError !== false) {
          bootstrapHarness.abortAttempts += 1;
        }
        throw new Error("simulated Nest initialization failure");
      }

      return {
        useLogger() {},
        getHttpAdapter() {
          return { getInstance: () => ({ set() {} }) };
        },
        get() {
          return {};
        },
        enableShutdownHooks() {},
        setGlobalPrefix() {},
        async listen(): Promise<void> {
          bootstrapHarness.listens += 1;
          throw new Error("simulated listener failure");
        },
        async close(): Promise<void> {
          bootstrapHarness.appCloses += 1;
          await bootstrapHarness.client?.$disconnect();
        },
      };
    },
  },
}));

describe("API bootstrap failure cleanup", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    bootstrapHarness.scenario = "create-reject";
    bootstrapHarness.parseCalls = 0;
    bootstrapHarness.clientCreations = 0;
    bootstrapHarness.clientDisconnects = 0;
    bootstrapHarness.factoryCreates = 0;
    bootstrapHarness.abortAttempts = 0;
    bootstrapHarness.appCloses = 0;
    bootstrapHarness.listens = 0;
    bootstrapHarness.createOptions = undefined;
    bootstrapHarness.client = undefined;
    bootstrapHarness.repositoryClient = undefined;
    bootstrapHarness.productionOptions = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("disables Nest process abort and disconnects the single client when app creation rejects", async () => {
    await import("./main.js");

    await vi.waitFor(() => {
      expect(bootstrapHarness.clientDisconnects).toBe(1);
      expect(process.exitCode).toBe(1);
    });

    expect(bootstrapHarness.createOptions).toEqual({
      abortOnError: false,
      bufferLogs: true,
    });
    expect(bootstrapHarness.abortAttempts).toBe(0);
    expect(bootstrapHarness.parseCalls).toBe(1);
    expect(bootstrapHarness.clientCreations).toBe(1);
    expect(bootstrapHarness.factoryCreates).toBe(1);
    expect(bootstrapHarness.repositoryClient).toBe(bootstrapHarness.client);
    expect(bootstrapHarness.productionOptions).toMatchObject({
      databaseClient: bootstrapHarness.client,
      sessionAuthenticator: expect.any(Object),
    });
    expect(bootstrapHarness.appCloses).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it("closes the created app and its client exactly once when listener startup rejects", async () => {
    bootstrapHarness.scenario = "listen-reject";

    await import("./main.js");

    await vi.waitFor(() => {
      expect(bootstrapHarness.appCloses).toBe(1);
      expect(process.exitCode).toBe(1);
    });

    expect(bootstrapHarness.parseCalls).toBe(1);
    expect(bootstrapHarness.clientCreations).toBe(1);
    expect(bootstrapHarness.factoryCreates).toBe(1);
    expect(bootstrapHarness.listens).toBe(1);
    expect(bootstrapHarness.clientDisconnects).toBe(1);
    expect(process.exitCode).toBe(1);
  });
});
