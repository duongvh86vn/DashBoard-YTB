import { describe, expect, it } from "vitest";

import {
  isThrottleBlocked,
  nextThrottleState,
  type ThrottlePolicy,
  type ThrottleState,
} from "./index.js";

const policy: ThrottlePolicy = {
  maxAttempts: 5,
  windowMinutes: 15,
  lockMinutes: 15,
};

describe("login throttle state", () => {
  it("starts a new failure window at one attempt without mutating the supplied date", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");

    const state = nextThrottleState(null, now, policy);

    expect(state).toEqual({
      attemptCount: 1,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: null,
    });
    expect(state.windowStartedAt).not.toBe(now);
  });

  it("blocks the first failure when a new window has a one-attempt threshold", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");

    expect(nextThrottleState(null, now, { ...policy, maxAttempts: 1 })).toEqual({
      attemptCount: 1,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:15:00.000Z"),
    });
  });

  it("increments inside the failure window and blocks on the maximum attempt", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const fourFailures: ThrottleState = {
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-21T23:50:00.000Z"),
      blockedUntil: null,
    };

    const state = nextThrottleState(fourFailures, now, policy);

    expect(state).toEqual({
      attemptCount: 5,
      windowStartedAt: new Date("2026-08-21T23:50:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:15:00.000Z"),
    });
    expect(fourFailures).toEqual({
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-21T23:50:00.000Z"),
      blockedUntil: null,
    });
  });

  it("resets a non-blocked state exactly at the failure-window boundary", () => {
    const current: ThrottleState = {
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: null,
    };

    expect(nextThrottleState(current, new Date("2026-08-22T00:15:00.000Z"), policy)).toEqual({
      attemptCount: 1,
      windowStartedAt: new Date("2026-08-22T00:15:00.000Z"),
      blockedUntil: null,
    });
  });

  it("blocks the first reset failure when the new window has a one-attempt threshold", () => {
    const current: ThrottleState = {
      attemptCount: 4,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: null,
    };
    const now = new Date("2026-08-22T00:15:00.000Z");

    expect(nextThrottleState(current, now, { ...policy, maxAttempts: 1 })).toEqual({
      attemptCount: 1,
      windowStartedAt: new Date("2026-08-22T00:15:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:30:00.000Z"),
    });
  });

  it("returns an actively blocked state unchanged", () => {
    const blocked: ThrottleState = {
      attemptCount: 5,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:20:00.000Z"),
    };

    expect(nextThrottleState(blocked, new Date("2026-08-22T00:10:00.000Z"), policy)).toBe(blocked);
  });

  it("uses an exclusive blocked-until boundary", () => {
    const blocked: ThrottleState = {
      attemptCount: 5,
      windowStartedAt: new Date("2026-08-22T00:00:00.000Z"),
      blockedUntil: new Date("2026-08-22T00:15:00.000Z"),
    };

    expect(isThrottleBlocked(blocked, new Date("2026-08-22T00:14:59.999Z"))).toBe(true);
    expect(isThrottleBlocked(blocked, new Date("2026-08-22T00:15:00.000Z"))).toBe(false);
    expect(nextThrottleState(blocked, new Date("2026-08-22T00:15:00.000Z"), policy)).toEqual({
      attemptCount: 1,
      windowStartedAt: new Date("2026-08-22T00:15:00.000Z"),
      blockedUntil: null,
    });
  });
});
