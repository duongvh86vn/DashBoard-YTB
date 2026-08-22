import { createHmac } from "node:crypto";

import {
  isThrottleBlocked,
  nextThrottleState,
  type ThrottlePolicy,
  type ThrottleState,
} from "@yt-monitor/auth";

const IDENTIFIER_DOMAIN = "login-throttle:identifier:v1\0";

export class LoginThrottleService {
  readonly policy: ThrottlePolicy;

  constructor(
    private readonly options: {
      sessionSecret: string;
      maxAttempts: number;
      lockMinutes: number;
    },
  ) {
    this.policy = {
      maxAttempts: options.maxAttempts,
      windowMinutes: 15,
      lockMinutes: options.lockMinutes,
    };
  }

  identifierKey(canonicalEmail: string): Uint8Array {
    return new Uint8Array(
      createHmac("sha256", this.options.sessionSecret)
        .update(IDENTIFIER_DOMAIN + canonicalEmail, "utf8")
        .digest(),
    );
  }

  nextFailure(current: ThrottleState | null, now: Date): ThrottleState {
    return nextThrottleState(current, now, this.policy);
  }

  isBlocked(state: ThrottleState, now: Date): boolean {
    return isThrottleBlocked(state, now);
  }

  retryAfterSeconds(blockedUntil: Date, now: Date): number {
    return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000));
  }
}
