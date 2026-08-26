export {
  aggregateHealthStatus,
  HealthCheckSchema,
  HealthResponseSchema,
  HealthStatusSchema,
  type HealthCheck,
  type HealthResponse,
  type HealthStatus,
} from "./health/health-contract.js";
export { createPinoOptions } from "./logging/pino-options.js";
export {
  CanonicalChannelIdSchema,
  ChannelActivitySchema,
  ChannelAvailabilitySchema,
  ChannelSnapshotSourceSchema,
  CoverageStatusSchema,
  SyncRunJobTypeSchema,
  SyncRunStatusSchema,
  type CanonicalChannel,
  type ChannelActivity,
  type ChannelAvailability,
  type ChannelCurrentStats,
  type ChannelSnapshotSource,
  type CoverageStatus,
  type ProviderVideo,
  type ProviderVideoStats,
  type PublicChannelProvider,
  type ResolvedChannel,
  type SyncRunJobType,
  type SyncRunStatus,
} from "./channel-contracts.js";
export {
  deriveActivityStatus,
  deriveCoverageStatus,
  deriveMetricDeltas,
  localCalendarDate,
  localCalendarDateStart,
  previousCalendarDate,
  type ChannelMetricDeltas,
  type NullableChannelMetrics,
} from "./channel-history.js";
export {
  ChannelHealthEvidenceCodeSchema,
  ChannelHealthSignalStatusSchema,
  HEALTH_RETRY_DELAY_MS,
  hasTransientFailure,
  isPositiveSignal,
  isStrongFailureSignal,
  isTransientFailureSignal,
  strongFailureCount,
  type ChannelHealthEvidenceCode,
  type ChannelHealthSignalStatus,
  type ChannelHealthSignals,
  type SanitizedHealthEvidence,
} from "./channel-health/signals.js";
export {
  transitionChannelHealth,
  type ChannelHealthState,
  type HealthTransitionInput,
  type HealthTransitionResult,
} from "./channel-health/state-machine.js";
export {
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  evaluateHealthCircuit,
  type CircuitBreakerOptions,
  type CircuitBreakerState,
} from "./channel-health/circuit-breaker.js";
export {
  VideoAvailabilitySchema,
  VideoMonitorTierSchema,
  type VideoAvailability,
  type VideoMonitorTier,
} from "./video-contracts.js";
export {
  DashboardTrendPointSchema,
  DashboardTrendResponseSchema,
  type DashboardTrendPoint,
  type DashboardTrendResponse,
} from "./dashboard-contracts.js";
export {
  PublicIntelligenceMetricSchema,
  PublicIntelligenceResponseSchema,
  PublicIntelligenceWarningSchema,
  PublicMetricClassSchema,
  PublicMetricPrecisionSchema,
  PublicMetricProvenanceSchema,
  PublicMetricReasonSchema,
  PublicMetricStatusSchema,
  PublicMetricUnitSchema,
  type PublicIntelligenceMetric,
  type PublicIntelligenceResponse,
  type PublicIntelligenceWarning,
  type PublicMetricClass,
  type PublicMetricPrecision,
  type PublicMetricProvenance,
  type PublicMetricReason,
  type PublicMetricStatus,
  type PublicMetricUnit,
} from "./public-intelligence-contracts.js";
