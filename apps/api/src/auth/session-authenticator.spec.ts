import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { SessionAuthenticator, type SessionReader } from "./session-authenticator.js";

const now = new Date("2026-08-22T01:00:00.000Z");
const session = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tokenHash: new Uint8Array([1, 2, 3]),
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
  lastSeenAt: new Date("2026-08-22T00:00:00.000Z"),
  idleExpiresAt: new Date("2026-08-22T02:00:00.000Z"),
  absoluteExpiresAt: new Date("2026-08-22T02:30:00.000Z"),
  revokedAt: null,
  revocationReason: null,
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "viewer@example.com",
    role: "VIEWER" as const,
    isEnabled: true,
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T01:00:00.000Z"),
    disabledAt: null,
  },
};

describe("SessionAuthenticator", () => {
  it("hashes only the validated token, captures time once, caps touch, and returns a safe principal", async () => {
    const findUsableByHash = vi.fn(async () => session);
    const touch = vi.fn(async () => session);
    const clock = { now: vi.fn(() => now) };
    const secret = "s".repeat(32);
    const authenticator = new SessionAuthenticator({
      sessions: { findUsableByHash, touch },
      sessionSecret: secret,
      idleMinutes: 120,
      clock,
    });
    const token = "t".repeat(43);

    const principal = await authenticator.authenticate(token);
    expect(principal).toEqual({
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        isEnabled: true,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T01:00:00.000Z",
        disabledAt: null,
      },
      session: { id: session.id },
    });
    expect(clock.now).toHaveBeenCalledOnce();
    expect(findUsableByHash).toHaveBeenCalledWith(
      new Uint8Array(createHmac("sha256", secret).update(token, "utf8").digest()),
      now,
    );
    expect(touch).toHaveBeenCalledWith(session.id, now, session.absoluteExpiresAt);
    expect(JSON.stringify(principal)).not.toMatch(/tokenHash|passwordHash|rawToken/u);
  });

  it("returns null without touch on every unusable lookup miss", async () => {
    const touch = vi.fn();
    const sessions: SessionReader = {
      findUsableByHash: vi.fn(async () => null),
      touch,
    };
    const authenticator = new SessionAuthenticator({
      sessions,
      sessionSecret: "s".repeat(32),
      idleMinutes: 120,
      clock: { now: () => now },
    });

    await expect(authenticator.authenticate("m".repeat(43))).resolves.toBeNull();
    expect(touch).not.toHaveBeenCalled();
  });

  it("returns null when touch loses the race and propagates database failures", async () => {
    const lostTouch = new SessionAuthenticator({
      sessions: {
        findUsableByHash: vi.fn(async () => session),
        touch: vi.fn(async () => null),
      },
      sessionSecret: "s".repeat(32),
      idleMinutes: 120,
      clock: { now: () => now },
    });
    await expect(lostTouch.authenticate("l".repeat(43))).resolves.toBeNull();

    const databaseError = new Error("database unavailable");
    const failing = new SessionAuthenticator({
      sessions: {
        findUsableByHash: vi.fn(async () => {
          throw databaseError;
        }),
        touch: vi.fn(),
      },
      sessionSecret: "s".repeat(32),
      idleMinutes: 120,
      clock: { now: () => now },
    });
    await expect(failing.authenticate("e".repeat(43))).rejects.toBe(databaseError);
  });
});
