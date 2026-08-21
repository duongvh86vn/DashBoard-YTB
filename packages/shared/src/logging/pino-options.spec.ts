import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { createPinoOptions } from "./pino-options.js";

function captureLog(writeLog: (logger: pino.Logger) => void): {
  parsed: Record<string, unknown>;
  raw: string;
} {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino(createPinoOptions("test"), destination);

  writeLog(logger);

  const raw = chunks.join("");
  return { parsed: JSON.parse(raw) as Record<string, unknown>, raw };
}

describe("structured log redaction", () => {
  it("removes secrets from nested request and provider fields", () => {
    const marker = "PHASE0_SECRET_MARKER";

    const { parsed, raw } = captureLog((logger) => {
      logger.info({
        password: marker,
        POSTGRES_PASSWORD: marker,
        DATABASE_URL: `postgresql://monitor:${marker}@postgres:5432/monitor`,
        req: { headers: { authorization: marker, cookie: marker } },
        provider: { apiKey: marker, token: marker, password: marker, connectionString: marker },
        message: "redaction probe",
      });
    });

    expect(raw).not.toContain(marker);
    expect(raw).toContain("[Redacted]");
    expect(parsed).toMatchObject({ service: "test", message: "redaction probe" });
  });

  it("recursively redacts secret key variants without mutating the logged value", () => {
    const marker = "DEEP_SECRET_MARKER";
    const details = {
      event: "provider.refresh",
      request: {
        body: {
          accounts: [
            {
              credentials: {
                access_token: marker,
                "client-secret": marker,
                api_key: marker,
                privateKey: marker,
              },
              channelId: "UC-safe-channel",
            },
          ],
        },
      },
      metrics: { tokenCount: 12 },
    };

    const { parsed, raw } = captureLog((logger) => {
      logger.info(details);
    });

    expect(raw).not.toContain(marker);
    expect(parsed).toMatchObject({
      event: "provider.refresh",
      request: {
        body: {
          accounts: [
            {
              credentials: {
                access_token: "[Redacted]",
                "client-secret": "[Redacted]",
                api_key: "[Redacted]",
                privateKey: "[Redacted]",
              },
              channelId: "UC-safe-channel",
            },
          ],
        },
      },
      metrics: { tokenCount: 12 },
    });
    expect(details.request.body.accounts[0]?.credentials.access_token).toBe(marker);
  });

  it("scrubs credentials from a PostgreSQL URL embedded in an otherwise useful string", () => {
    const marker = "URL_PASSWORD_MARKER";

    const { parsed, raw } = captureLog((logger) => {
      logger.warn({
        detail: `failed to connect to postgresql://monitor:${marker}@postgres:5432/monitor?sslmode=disable`,
        operation: "database.health",
      });
    });

    expect(raw).not.toContain(marker);
    expect(parsed).toMatchObject({
      detail:
        "failed to connect to postgresql://monitor:[Redacted]@postgres:5432/monitor?sslmode=disable",
      operation: "database.health",
    });
  });

  it("serializes errors through an allowlist without leaking their message or stack", () => {
    const marker = "ERROR_SECRET_MARKER";
    const error = Object.assign(
      new Error(`database connection failed: postgresql://monitor:${marker}@postgres:5432/monitor`),
      { code: "ECONNREFUSED", operation: "connect", password: marker },
    );

    const { parsed, raw } = captureLog((logger) => {
      logger.error({ err: error, requestId: "request-safe" }, "dependency failed");
    });

    expect(raw).not.toContain(marker);
    expect(parsed).toMatchObject({
      err: { type: "Error", code: "ECONNREFUSED" },
      requestId: "request-safe",
      msg: "dependency failed",
    });
    expect(parsed.err).not.toHaveProperty("message");
    expect(parsed.err).not.toHaveProperty("stack");
  });

  it("does not copy a raw Error message into the top-level log message", () => {
    const marker = "RAW_ERROR_MESSAGE_SECRET";
    const error = Object.assign(new Error(`provider rejected credential ${marker}`), {
      code: "EAUTH",
    });

    const { parsed, raw } = captureLog((logger) => {
      logger.error(error);
    });

    expect(raw).not.toContain(marker);
    expect(parsed).toMatchObject({ err: { type: "Error", code: "EAUTH" }, msg: "Error" });
    expect(parsed.err).not.toHaveProperty("message");
    expect(parsed.err).not.toHaveProperty("stack");
  });

  it("applies the same recursive policy to child logger bindings", () => {
    const marker = "CHILD_BINDING_SECRET_MARKER";

    const { parsed, raw } = captureLog((logger) => {
      logger
        .child({ component: "collector", auth: { refreshToken: marker } })
        .info({ videoId: "video-safe" });
    });

    expect(raw).not.toContain(marker);
    expect(parsed).toMatchObject({
      component: "collector",
      auth: { refreshToken: "[Redacted]" },
      videoId: "video-safe",
    });
  });
});
