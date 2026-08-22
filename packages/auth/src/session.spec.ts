import { describe, expect, it } from "vitest";

import {
  calculateSessionExpiry,
  createSessionCredential,
  hashSessionToken,
  isSessionUsable,
} from "./index.js";

const SESSION_SECRET = "test-session-secret-that-is-not-production";

describe("opaque session credentials", () => {
  it("encodes exactly 32 bytes as a 43-character base64url token and stores only its HMAC", () => {
    const entropy = Uint8Array.from({ length: 32 }, (_, index) => index);
    const credential = createSessionCredential(SESSION_SECRET, entropy);

    expect(credential.token).toBe("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    expect(credential.token).toHaveLength(43);
    expect(credential.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(credential.tokenHash).toString("hex")).toBe(
      "dc6ab56410115f68c9cd95cba973c3cac2984eb743912294dc43c0297bcc94bd",
    );
    expect(Buffer.from(credential.tokenHash).toString("base64url")).not.toBe(credential.token);
    expect(credential.tokenHash).toHaveLength(32);
  });

  it("rejects test entropy that is not exactly 32 bytes", () => {
    expect(() => createSessionCredential(SESSION_SECRET, new Uint8Array(31))).toThrow(RangeError);
    expect(() => createSessionCredential(SESSION_SECRET, new Uint8Array(33))).toThrow(RangeError);
  });

  it("changes the stored HMAC when the raw token changes", () => {
    const first = hashSessionToken(SESSION_SECRET, "token-a");
    const second = hashSessionToken(SESSION_SECRET, "token-b");

    expect(first).not.toEqual(second);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
  });
});

describe("session expiry", () => {
  it("copies timestamps and caps idle expiry at the absolute expiry", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");

    const expiry = calculateSessionExpiry(now, 180, 2);

    expect(expiry).toEqual({
      createdAt: new Date("2026-08-22T00:00:00.000Z"),
      lastSeenAt: new Date("2026-08-22T00:00:00.000Z"),
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
    });
    expect(expiry.createdAt).not.toBe(now);
    expect(expiry.lastSeenAt).not.toBe(now);
    expect(now.toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("uses the configured idle expiry when it occurs before absolute expiry", () => {
    expect(calculateSessionExpiry(new Date("2026-08-22T00:00:00.000Z"), 120, 24)).toMatchObject({
      idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
    });
  });

  it("expires a session exactly at the idle boundary", () => {
    const now = new Date("2026-08-22T02:00:00.000Z");

    expect(
      isSessionUsable(
        {
          revokedAt: null,
          idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
          absoluteExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
          userEnabled: true,
        },
        now,
      ),
    ).toBe(false);
  });

  it("expires a session exactly at the absolute boundary", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");

    expect(
      isSessionUsable(
        {
          revokedAt: null,
          idleExpiresAt: new Date("2026-08-24T00:00:00.000Z"),
          absoluteExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
          userEnabled: true,
        },
        now,
      ),
    ).toBe(false);
  });

  it("rejects revoked or disabled sessions while accepting an active enabled session", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const activeSession = {
      revokedAt: null,
      idleExpiresAt: new Date("2026-08-22T01:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-08-23T00:00:00.000Z"),
      userEnabled: true,
    };

    expect(isSessionUsable(activeSession, now)).toBe(true);
    expect(isSessionUsable({ ...activeSession, revokedAt: now }, now)).toBe(false);
    expect(isSessionUsable({ ...activeSession, userEnabled: false }, now)).toBe(false);
  });
});
