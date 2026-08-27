ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CHANNEL_MONETIZATION_UPDATED';
ALTER TYPE "ChannelSnapshotSource" ADD VALUE IF NOT EXISTS 'YTDLP_CATALOG';
ALTER TYPE "SyncRunJobType" ADD VALUE IF NOT EXISTS 'VIDEO_CATALOG_DAILY';

CREATE TABLE "channel_monetization_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "is_monetized" BOOLEAN NOT NULL,
    "rpm_micros" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_monetization_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_monetization_settings_state_check" CHECK (
        ("is_monetized" = TRUE AND "rpm_micros" IS NOT NULL AND "rpm_micros" >= 0)
        OR
        ("is_monetized" = FALSE AND "rpm_micros" IS NULL)
    ),
    CONSTRAINT "channel_monetization_settings_currency_check" CHECK ("currency" = 'USD')
);

CREATE UNIQUE INDEX "channel_monetization_settings_channel_date_key"
    ON "channel_monetization_settings"("channel_id", "effective_date");
CREATE INDEX "channel_monetization_settings_channel_date_idx"
    ON "channel_monetization_settings"("channel_id", "effective_date" DESC);
CREATE INDEX "channel_monetization_settings_recorder_idx"
    ON "channel_monetization_settings"("recorded_by_user_id");

ALTER TABLE "channel_monetization_settings"
    ADD CONSTRAINT "channel_monetization_settings_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_monetization_settings"
    ADD CONSTRAINT "channel_monetization_settings_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "video_catalog_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "snapshot_bucket" TIMESTAMPTZ(3) NOT NULL,
    "total_videos" INTEGER NOT NULL,
    "videos_with_views" INTEGER NOT NULL,
    "coverage_status" "CoverageStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "video_catalog_scans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "video_catalog_scans_counts_check" CHECK (
        "total_videos" >= 0
        AND "videos_with_views" >= 0
        AND "videos_with_views" <= "total_videos"
        AND (
            "coverage_status" <> 'COMPLETE'
            OR "videos_with_views" = "total_videos"
        )
    )
);

CREATE UNIQUE INDEX "video_catalog_scans_channel_date_key"
    ON "video_catalog_scans"("channel_id", "date");
CREATE INDEX "video_catalog_scans_channel_date_idx"
    ON "video_catalog_scans"("channel_id", "date" DESC);

ALTER TABLE "video_catalog_scans"
    ADD CONSTRAINT "video_catalog_scans_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
