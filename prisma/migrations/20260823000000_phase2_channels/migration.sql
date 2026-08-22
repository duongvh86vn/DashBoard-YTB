BEGIN;

CREATE TYPE "ChannelAvailabilityStatus" AS ENUM ('ACTIVE', 'DELETED_OR_TERMINATED', 'NOT_FOUND', 'TEMPORARILY_UNAVAILABLE', 'CHECK_FAILED', 'UNKNOWN', 'ARCHIVED');
CREATE TYPE "ChannelActivityStatus" AS ENUM ('ACTIVE_RECENT', 'DORMANT', 'NO_UPLOAD_HISTORY', 'UNKNOWN');
CREATE TYPE "ChannelSnapshotSource" AS ENUM ('YOUTUBE_PUBLIC_PAGE', 'YTDLP', 'YOUTUBE_RSS', 'OPTIONAL_PROVIDER', 'DERIVED');
CREATE TYPE "CoverageStatus" AS ENUM ('COMPLETE', 'PARTIAL');
CREATE TYPE "SyncRunJobType" AS ENUM ('CHANNEL_RESOLVE', 'CHANNEL_CURRENT_STATS', 'CHANNEL_DAILY_FINALIZE', 'CHANNEL_HEALTH', 'RSS_DISCOVERY', 'YTDLP_RECONCILE', 'VIDEO_SNAPSHOT_HOT', 'VIDEO_SNAPSHOT_WARM', 'BREAKOUT_RECALC', 'DAILY_AI_REPORT', 'WEEKLY_AI_REPORT', 'FULL_RECONCILE');
CREATE TYPE "SyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "youtube_channel_id" VARCHAR(24) NOT NULL,
    "original_input" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "handle" VARCHAR(64),
    "title" VARCHAR(512) NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "subscriber_count" BIGINT,
    "video_count" BIGINT,
    "lifetime_view_count" BIGINT,
    "last_upload_at" TIMESTAMPTZ(3),
    "availability_status" "ChannelAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "activity_status" "ChannelActivityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_channel_scan_at" TIMESTAMPTZ(3),
    "last_health_check_at" TIMESTAMPTZ(3),
    "last_seen_alive_at" TIMESTAMPTZ(3),
    "consecutive_health_failures" INTEGER NOT NULL DEFAULT 0,
    "first_unavailable_at" TIMESTAMPTZ(3),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channels_youtube_channel_id_key" UNIQUE ("youtube_channel_id")
);

CREATE TABLE "channel_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "subscriber_count" BIGINT,
    "video_count" BIGINT,
    "lifetime_view_count" BIGINT,
    "last_upload_at" TIMESTAMPTZ(3),
    "source" "ChannelSnapshotSource" NOT NULL,
    "source_details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_snapshots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "channel_daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "subscriber_count" BIGINT,
    "video_count" BIGINT,
    "lifetime_view_count" BIGINT,
    "subscriber_delta" BIGINT,
    "video_delta" BIGINT,
    "view_delta" BIGINT,
    "coverage_status" "CoverageStatus" NOT NULL,
    "source_summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_daily_stats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_daily_stats_channel_id_date_key" UNIQUE ("channel_id", "date"),
    CONSTRAINT "channel_daily_stats_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID,
    "job_type" "SyncRunJobType" NOT NULL,
    "status" "SyncRunStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "records_processed" INTEGER,
    "error_code" VARCHAR(64),
    "error_message_safe" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_runs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "channels_handle_idx" ON "channels"("handle");
CREATE INDEX "channels_availability_status_idx" ON "channels"("availability_status");
CREATE INDEX "channels_activity_status_idx" ON "channels"("activity_status");
CREATE INDEX "channel_snapshots_channel_captured_idx" ON "channel_snapshots"("channel_id", "captured_at" DESC);
CREATE INDEX "channel_daily_stats_channel_date_idx" ON "channel_daily_stats"("channel_id", "date");
CREATE INDEX "sync_runs_channel_created_idx" ON "sync_runs"("channel_id", "created_at" DESC);
CREATE INDEX "sync_runs_job_status_created_idx" ON "sync_runs"("job_type", "status", "created_at" DESC);

COMMIT;
