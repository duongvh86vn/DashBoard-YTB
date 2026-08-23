CREATE TYPE "AiProvider" AS ENUM ('GEMINI', 'NVIDIA');
CREATE TYPE "AiModelRole" AS ENUM ('FAST', 'ANALYSIS', 'LONG_CONTEXT', 'FALLBACK');
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'SCHEMA_INVALID', 'UNAVAILABLE');
CREATE TYPE "AiTaskType" AS ENUM ('CHANNEL_CLASSIFICATION', 'VIDEO_ANALYSIS', 'DAILY_REPORT', 'WEEKLY_REPORT', 'HEALTH_AMBIGUITY');
CREATE TYPE "AiReportKind" AS ENUM ('DAILY', 'WEEKLY');

CREATE TABLE "ai_provider_settings" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "configured_models" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_provider_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_model_roles" (
    "role" "AiModelRole" NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model_id" VARCHAR(256) NOT NULL,
    "temperature" DECIMAL(4,3),
    "max_output_tokens" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_model_roles_pkey" PRIMARY KEY ("role")
);

CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model_id" VARCHAR(256) NOT NULL,
    "task_type" "AiTaskType" NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "input_token_estimate" INTEGER,
    "output_token_estimate" INTEGER,
    "status" "AiRunStatus" NOT NULL,
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_channel_classifications" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "primary_niche" VARCHAR(256) NOT NULL,
    "sub_niches" JSONB NOT NULL,
    "language" VARCHAR(32) NOT NULL,
    "content_format" VARCHAR(256) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model_id" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_channel_classifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_video_analyses" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "topic" VARCHAR(256) NOT NULL,
    "title_pattern" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "possible_factors" JSONB NOT NULL,
    "anomalies" JSONB NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model_id" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_video_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_reports" (
    "id" UUID NOT NULL,
    "kind" "AiReportKind" NOT NULL,
    "report_date" DATE NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model_id" VARCHAR(256) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_settings_provider_key" ON "ai_provider_settings"("provider");
CREATE INDEX "ai_provider_settings_enabled_priority_idx" ON "ai_provider_settings"("is_enabled", "priority");
CREATE INDEX "ai_model_roles_provider_enabled_idx" ON "ai_model_roles"("provider", "is_enabled");
CREATE INDEX "ai_runs_fingerprint_idx" ON "ai_runs"("fingerprint");
CREATE INDEX "ai_runs_created_at_idx" ON "ai_runs"("created_at" DESC);
CREATE UNIQUE INDEX "ai_channel_classifications_channel_id_key" ON "ai_channel_classifications"("channel_id");
CREATE INDEX "ai_channel_classifications_fingerprint_idx" ON "ai_channel_classifications"("fingerprint");
CREATE UNIQUE INDEX "ai_video_analyses_video_id_key" ON "ai_video_analyses"("video_id");
CREATE INDEX "ai_video_analyses_fingerprint_idx" ON "ai_video_analyses"("fingerprint");
CREATE UNIQUE INDEX "ai_reports_kind_date_key" ON "ai_reports"("kind", "report_date");
CREATE INDEX "ai_reports_fingerprint_idx" ON "ai_reports"("fingerprint");

ALTER TABLE "ai_channel_classifications"
  ADD CONSTRAINT "ai_channel_classifications_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_video_analyses"
  ADD CONSTRAINT "ai_video_analyses_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
