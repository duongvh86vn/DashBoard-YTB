const MILLISECONDS_PER_MINUTE = 60_000;

export interface ThrottleState {
  attemptCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

export interface ThrottlePolicy {
  maxAttempts: number;
  windowMinutes: number;
  lockMinutes: number;
}

export function isThrottleBlocked(state: ThrottleState, now: Date): boolean {
  return state.blockedUntil !== null && state.blockedUntil.getTime() > now.getTime();
}

function startThrottleWindow(now: Date): ThrottleState {
  return {
    attemptCount: 1,
    windowStartedAt: new Date(now.getTime()),
    blockedUntil: null,
  };
}

export function nextThrottleState(
  current: ThrottleState | null,
  now: Date,
  policy: ThrottlePolicy,
): ThrottleState {
  if (current === null) {
    return startThrottleWindow(now);
  }

  if (isThrottleBlocked(current, now)) {
    return current;
  }

  const nowMilliseconds = now.getTime();
  const windowEndsAt =
    current.windowStartedAt.getTime() + policy.windowMinutes * MILLISECONDS_PER_MINUTE;

  if (nowMilliseconds >= windowEndsAt) {
    return startThrottleWindow(now);
  }

  const attemptCount = current.attemptCount + 1;

  return {
    attemptCount,
    windowStartedAt: new Date(current.windowStartedAt.getTime()),
    blockedUntil:
      attemptCount >= policy.maxAttempts
        ? new Date(nowMilliseconds + policy.lockMinutes * MILLISECONDS_PER_MINUTE)
        : null,
  };
}
