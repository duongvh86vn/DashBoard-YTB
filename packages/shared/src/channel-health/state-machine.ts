import type { ChannelActivity, ChannelAvailability } from "../channel-contracts.js";
import {
  hasTransientFailure,
  HEALTH_RETRY_DELAY_MS,
  isPositiveSignal,
  strongFailureCount,
  type ChannelHealthEvidenceCode,
  type ChannelHealthSignals,
  type SanitizedHealthEvidence,
} from "./signals.js";

export interface ChannelHealthState {
  availabilityStatus: ChannelAvailability;
  activityStatus: ChannelActivity;
  consecutiveHealthFailures: number;
  firstUnavailableAt: Date | null;
  lastSeenAliveAt: Date | null;
}

export interface HealthTransitionInput {
  state: ChannelHealthState;
  signals: ChannelHealthSignals;
  checkedAt: Date;
  evidence: SanitizedHealthEvidence;
}

export interface HealthTransitionResult {
  state: ChannelHealthState;
  normalizedAvailability: ChannelAvailability;
  evidenceCode: ChannelHealthEvidenceCode;
  strongFailureCount: number;
  deletionConfirmed: boolean;
  retryAt: Date | null;
}

function retryAt(checkedAt: Date, shouldRetry: boolean): Date | null {
  return shouldRetry ? new Date(checkedAt.getTime() + HEALTH_RETRY_DELAY_MS) : null;
}

function isArchived(state: ChannelHealthState): boolean {
  return state.availabilityStatus === "ARCHIVED";
}

export function transitionChannelHealth(input: HealthTransitionInput): HealthTransitionResult {
  const { state, signals, checkedAt, evidence } = input;
  if (isArchived(state)) {
    return {
      state,
      normalizedAvailability: "ARCHIVED",
      evidenceCode: "ARCHIVED",
      strongFailureCount: 0,
      deletionConfirmed: false,
      retryAt: null,
    };
  }

  const positive = [signals.publicPage, signals.ytdlp, signals.rss].some(isPositiveSignal);
  if (positive) {
    const nextState: ChannelHealthState = {
      ...state,
      availabilityStatus: "ACTIVE",
      consecutiveHealthFailures: 0,
      firstUnavailableAt: null,
      lastSeenAliveAt: checkedAt,
    };
    return {
      state: nextState,
      normalizedAvailability: "ACTIVE",
      evidenceCode: evidence.evidenceCode,
      strongFailureCount: 0,
      deletionConfirmed: false,
      retryAt: null,
    };
  }

  const strongSignals = strongFailureCount(signals);
  const transient = hasTransientFailure(signals);
  const firstUnavailableAt = state.firstUnavailableAt ?? checkedAt;
  const elapsed = checkedAt.getTime() - firstUnavailableAt.getTime();
  const independentConfirmation = strongSignals >= 2;
  const temporalConfirmation =
    state.consecutiveHealthFailures >= 1 && elapsed >= HEALTH_RETRY_DELAY_MS;
  const deletionConfirmed = strongSignals > 0 && (independentConfirmation || temporalConfirmation);

  if (deletionConfirmed) {
    const nextState: ChannelHealthState = {
      ...state,
      availabilityStatus: "DELETED_OR_TERMINATED",
      consecutiveHealthFailures: state.consecutiveHealthFailures + 1,
      firstUnavailableAt,
    };
    return {
      state: nextState,
      normalizedAvailability: "DELETED_OR_TERMINATED",
      evidenceCode: evidence.evidenceCode,
      strongFailureCount: strongSignals,
      deletionConfirmed: true,
      retryAt: null,
    };
  }

  const nextAvailability: ChannelAvailability =
    strongSignals > 0 ? "NOT_FOUND" : transient ? "UNKNOWN" : "CHECK_FAILED";
  const nextState: ChannelHealthState = {
    ...state,
    availabilityStatus: nextAvailability,
    consecutiveHealthFailures:
      strongSignals > 0 ? state.consecutiveHealthFailures + 1 : state.consecutiveHealthFailures,
    firstUnavailableAt,
  };
  return {
    state: nextState,
    normalizedAvailability: nextAvailability,
    evidenceCode: evidence.evidenceCode,
    strongFailureCount: strongSignals,
    deletionConfirmed: false,
    retryAt: retryAt(checkedAt, transient),
  };
}
