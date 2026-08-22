import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { LoginThrottleService } from "./login-throttle.service.js";

const now = new Date("2026-08-22T01:00:00.000Z");

describe("LoginThrottleService", () => {
  it("derives only the domain-separated identifier HMAC", () => {
    const secret = "session-secret-with-at-least-32-bytes";
    const canonicalEmail = "viewer@example.com";
    const service = new LoginThrottleService({
      sessionSecret: secret,
      maxAttempts: 5,
      lockMinutes: 15,
    });
    const expected = createHmac("sha256", secret)
      .update("login-throttle:identifier:v1\0" + canonicalEmail, "utf8")
      .digest();

    const key = service.identifierKey(canonicalEmail);

    expect(Buffer.from(key)).toEqual(expected);
    expect(key).toHaveLength(32);
    expect(Buffer.from(key).toString("utf8")).not.toContain(canonicalEmail);
  });

  it("blocks on the fifth failure and resets an expired fifteen-minute window", () => {
    const service = new LoginThrottleService({
      sessionSecret: "s".repeat(32),
      maxAttempts: 5,
      lockMinutes: 15,
    });
    const fourth = {
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-22T00:59:00.000Z"),
      blockedUntil: null,
    };

    expect(service.nextFailure(fourth, now)).toEqual({
      attemptCount: 5,
      windowStartedAt: fourth.windowStartedAt,
      blockedUntil: new Date("2026-08-22T01:15:00.000Z"),
    });
    expect(
      service.nextFailure(
        {
          attemptCount: 4,
          windowStartedAt: new Date("2026-08-22T00:45:00.000Z"),
          blockedUntil: null,
        },
        now,
      ),
    ).toEqual({ attemptCount: 1, windowStartedAt: now, blockedUntil: null });
  });

  it("uses strict blockedUntil comparison and a minimum one-second Retry-After", () => {
    const service = new LoginThrottleService({
      sessionSecret: "s".repeat(32),
      maxAttempts: 5,
      lockMinutes: 15,
    });

    expect(
      service.isBlocked({ attemptCount: 5, windowStartedAt: now, blockedUntil: now }, now),
    ).toBe(false);
    expect(
      service.isBlocked(
        {
          attemptCount: 5,
          windowStartedAt: now,
          blockedUntil: new Date(now.getTime() + 1),
        },
        now,
      ),
    ).toBe(true);
    expect(service.retryAfterSeconds(new Date(now.getTime() + 1), now)).toBe(1);
    expect(service.retryAfterSeconds(new Date(now.getTime() + 1_001), now)).toBe(2);
  });
});
