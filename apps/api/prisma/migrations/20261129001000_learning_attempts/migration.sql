-- DB-02: per-submission learning attempt log with a legacy-marked summary backfill.
-- Conventions follow 20250101000000_baseline_init and prior migrations:
-- UUID keys from uuid_generate_v4(), TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
-- user_id UUID NOT NULL with FK -> users("id") ON DELETE CASCADE ON UPDATE NO ACTION.
-- No CHECK constraint (Prisma cannot express one); no CREATE EXTENSION line
-- (uuid-ossp is installed by the baseline migration).

-- CreateTable
CREATE TABLE IF NOT EXISTS "learning_attempts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "language" VARCHAR(30),
    "activity_type" VARCHAR(20),
    "activity_id" VARCHAR(160),
    "content_version" VARCHAR(50),
    "client_attempt_id" UUID NOT NULL,
    "raw_score" DOUBLE PRECISION,
    "score_scale" VARCHAR(20),
    "normalized_score" DOUBLE PRECISION,
    "total" INTEGER,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback_ref" VARCHAR(160),

    CONSTRAINT "learning_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_attempts_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- One row per client submission key. client_attempt_id is NOT NULL so
-- PostgreSQL cannot accept duplicate NULL keys for different attempts.
CREATE UNIQUE INDEX IF NOT EXISTS "learning_attempts_user_id_client_attempt_id_key"
    ON "learning_attempts"("user_id", "client_attempt_id");

-- History path: attempts for one user/language, newest first.
CREATE INDEX IF NOT EXISTS "learning_attempts_user_id_language_completed_at_idx"
    ON "learning_attempts"("user_id", "language", "completed_at" DESC);

-- Expand learning_completions with summary columns. Existing identity/unique
-- key (user_id, activity_type, activity_id) and original columns are untouched.
ALTER TABLE "learning_completions"
    ADD COLUMN IF NOT EXISTS "first_completed_at" TIMESTAMP(6),
    ADD COLUMN IF NOT EXISTS "last_completed_at" TIMESTAMP(6),
    ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "best_score" INTEGER,
    ADD COLUMN IF NOT EXISTS "latest_score" INTEGER,
    ADD COLUMN IF NOT EXISTS "total_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "is_legacy" BOOLEAN NOT NULL DEFAULT false;

-- Backfill marker: legacy rows existed before per-attempt logging, so their
-- history cannot be reconstructed. Mark them as legacy summaries and seed the
-- summary from the single row we do have. No attempt rows are fabricated, and
-- no score scale is guessed. The attempt_count = 0 / is_legacy = false guard
-- makes the UPDATE a no-op when re-run.
UPDATE "learning_completions"
SET "first_completed_at" = "completed_at",
    "last_completed_at" = "completed_at",
    "attempt_count" = 1,
    "best_score" = "score",
    "latest_score" = "score",
    "total_duration_seconds" = "duration_seconds",
    "is_legacy" = true
WHERE "attempt_count" = 0 AND "is_legacy" = false;

-- Documented manual rollback (expand/contract: this migration does not drop
-- data, so rollback is a deliberate app-compatible DBA action, not an auto
-- down migration):
--   DROP INDEX IF EXISTS "learning_attempts_user_id_language_completed_at_idx";
--   DROP INDEX IF EXISTS "learning_attempts_user_id_client_attempt_id_key";
--   DROP TABLE IF EXISTS "learning_attempts";
--   ALTER TABLE "learning_completions"
--       DROP COLUMN IF EXISTS "first_completed_at",
--       DROP COLUMN IF EXISTS "last_completed_at",
--       DROP COLUMN IF EXISTS "attempt_count",
--       DROP COLUMN IF EXISTS "best_score",
--       DROP COLUMN IF EXISTS "latest_score",
--       DROP COLUMN IF EXISTS "total_duration_seconds",
--       DROP COLUMN IF EXISTS "is_legacy";
