BEGIN;

CREATE TABLE "worker_heartbeats" (
    "worker_id" VARCHAR(128) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

CREATE INDEX "worker_heartbeats_last_seen_at_idx"
    ON "worker_heartbeats"("last_seen_at" DESC);

COMMIT;
