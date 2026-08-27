import type {
  Channel,
  ChannelActivityStatus,
  ChannelAvailabilityStatus,
  ChannelDailyStat,
  ChannelHealthCheck,
  ChannelMonetizationSetting,
  ChannelSnapshot,
  ChannelSnapshotSource,
  CoverageStatus,
  SyncRun,
  SyncRunJobType,
  SyncRunStatus,
  Video,
  VideoCatalogScan,
  VideoMonitorTier,
  VideoSnapshot,
} from "./generated/prisma/client.js";

export type ChannelRecord = Channel;
export type ChannelSnapshotRecord = ChannelSnapshot;
export type ChannelDailyStatRecord = ChannelDailyStat;
export type ChannelHealthCheckRecord = ChannelHealthCheck;
export type ChannelMonetizationSettingRecord = ChannelMonetizationSetting;
export type SyncRunRecord = SyncRun;
export type ChannelAvailabilityStatusValue = ChannelAvailabilityStatus;
export type ChannelActivityStatusValue = ChannelActivityStatus;
export type ChannelSnapshotSourceValue = ChannelSnapshotSource;
export type CoverageStatusValue = CoverageStatus;
export type SyncRunJobTypeValue = SyncRunJobType;
export type SyncRunStatusValue = SyncRunStatus;
export type VideoRecord = Video;
export type VideoCatalogScanRecord = VideoCatalogScan;
export type VideoSnapshotRecord = VideoSnapshot;
export type VideoMonitorTierValue = VideoMonitorTier;
