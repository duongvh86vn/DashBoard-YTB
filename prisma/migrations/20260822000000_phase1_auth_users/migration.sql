BEGIN;

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER');
CREATE TYPE "LoginThrottleScope" AS ENUM ('IDENTIFIER', 'SOURCE');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TYPE "AuditAction" AS ENUM (
    'LOGIN_SUCCEEDED',
    'LOGIN_FAILED',
    'LOGOUT',
    'PASSWORD_CHANGED',
    'USER_CREATED',
    'USER_EMAIL_CHANGED',
    'USER_PASSWORD_RESET',
    'USER_SESSIONS_REVOKED',
    'USER_DISABLED',
    'USER_ENABLED',
    'AUTHORIZATION_DENIED'
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_key" UNIQUE ("email")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(64),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "sessions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "login_throttles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "LoginThrottleScope" NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_throttles_scope_key_hash_key" UNIQUE ("scope", "key_hash")
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "request_id" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_target_user_id_fkey"
        FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "users_role_enabled_idx" ON "users"("role", "is_enabled");
CREATE INDEX "sessions_user_revoked_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_idle_expiry_idx" ON "sessions"("idle_expires_at");
CREATE INDEX "sessions_absolute_expiry_idx" ON "sessions"("absolute_expires_at");
CREATE INDEX "login_throttles_blocked_until_idx" ON "login_throttles"("blocked_until");
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);
CREATE INDEX "audit_logs_target_created_idx" ON "audit_logs"("target_user_id", "created_at" DESC);
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

COMMIT;
