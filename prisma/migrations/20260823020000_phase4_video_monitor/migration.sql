CREATE TYPE "VideoMonitorTier" AS ENUM ('HOT', 'WARM', 'OLD_HOT', 'PINNED', 'ARCHIVED');

CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "youtube_video_id" VARCHAR(32) NOT NULL,
    "channel_id" UUID NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnail" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,
    "current_views" BIGINT,
    "current_likes" BIGINT,
    "current_comments" BIGINT,
    "vph_1h" DECIMAL(24,6),
    "vph_3h" DECIMAL(24,6),
    "vph_6h" DECIMAL(24,6),
    "breakout_24h" DECIMAL(24,6),
    "breakout_48h" DECIMAL(24,6),
    "breakout_7d" DECIMAL(24,6),
    "monitor_tier" "VideoMonitorTier" NOT NULL DEFAULT 'WARM',
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_snapshots" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "snapshot_bucket" TIMESTAMPTZ(3) NOT NULL,
    "views" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "source" "ChannelSnapshotSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "videos_youtube_video_id_key" ON "videos"("youtube_video_id");
CREATE INDEX "videos_channel_published_idx" ON "videos"("channel_id", "published_at" DESC);
CREATE INDEX "videos_tier_seen_idx" ON "videos"("monitor_tier", "last_seen_at" DESC);
CREATE INDEX "videos_vph_1h_idx" ON "videos"("vph_1h" DESC);
CREATE INDEX "videos_breakout_48h_idx" ON "videos"("breakout_48h" DESC);
CREATE UNIQUE INDEX "video_snapshots_video_bucket_key" ON "video_snapshots"("video_id", "snapshot_bucket");
CREATE INDEX "video_snapshots_video_captured_idx" ON "video_snapshots"("video_id", "captured_at" DESC);
CREATE INDEX "video_snapshots_channel_captured_idx" ON "video_snapshots"("channel_id", "captured_at" DESC);

ALTER TABLE "videos"
    ADD CONSTRAINT "videos_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "video_snapshots"
    ADD CONSTRAINT "video_snapshots_video_id_fkey"
    FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "video_snapshots"
    ADD CONSTRAINT "video_snapshots_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
