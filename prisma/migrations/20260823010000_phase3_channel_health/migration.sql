CREATE TABLE "channel_health_checks" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "public_page_status" VARCHAR(64) NOT NULL,
    "ytdlp_status" VARCHAR(64) NOT NULL,
    "rss_status" VARCHAR(64) NOT NULL,
    "normalized_availability" "ChannelAvailabilityStatus" NOT NULL,
    "evidence_code" VARCHAR(64) NOT NULL,
    "evidence_text_safe" VARCHAR(256),
    "http_status" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_health_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "channel_health_checks_channel_checked_idx"
    ON "channel_health_checks"("channel_id", "checked_at" DESC);

CREATE INDEX "channel_health_checks_availability_checked_idx"
    ON "channel_health_checks"("normalized_availability", "checked_at" DESC);

ALTER TABLE "channel_health_checks"
    ADD CONSTRAINT "channel_health_checks_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
