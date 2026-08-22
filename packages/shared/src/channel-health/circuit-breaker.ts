import type { ChannelHealthSignals } from "./signals.js";
import { isPositiveSignal, isStrongFailureSignal, isTransientFailureSignal } from "./signals.js";

export interface CircuitBreakerOptions {
  minimumSamples: number;
  failureRatio: number;
}

export interface CircuitBreakerState {
  open: boolean;
  samples: number;
  failures: number;
  failureRatio: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  minimumSamples: 10,
  failureRatio: 0.5,
};

export function evaluateHealthCircuit(
  checks: readonly ChannelHealthSignals[],
  options: CircuitBreakerOptions = DEFAULT_CIRCUIT_BREAKER_OPTIONS,
): CircuitBreakerState {
  const failures = checks.filter((signals) => {
    const statuses = [signals.publicPage, signals.ytdlp, signals.rss];
    return (
      statuses.some(isTransientFailureSignal) &&
      statuses.every((status) => !isPositiveSignal(status) && !isStrongFailureSignal(status))
    );
  }).length;
  const samples = checks.length;
  const failureRatio = samples === 0 ? 0 : failures / samples;
  return {
    open: samples >= options.minimumSamples && failureRatio >= options.failureRatio,
    samples,
    failures,
    failureRatio,
  };
}
