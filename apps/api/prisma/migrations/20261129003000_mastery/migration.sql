-- PRODUCT-02/03: unique/idempotency constraints for the knowledge map and
-- mastery evidence tables.
-- Conventions follow 20250101000000_baseline_init: TIMESTAMP(6) defaults and
-- user_id UUID with FK -> users("id") ON DELETE CASCADE ON UPDATE NO ACTION.
-- No CREATE EXTENSION line (uuid-ossp is in the baseline) and no CHECK
-- constraints (Prisma cannot express them).
--
-- The adjacent 20261129002000_knowledge_map migration may already have created
-- these tables and the two named UNIQUE constraints below. CREATE TABLE uses
-- IF NOT EXISTS, and each UNIQUE index is created only when no relation with
-- that name exists, so applying both migrations in order is safe. Column types
-- deliberately match that migration, including VARCHAR(160) attempt_id so
-- legacy/external attempt keys remain representable.
--
-- Idempotency rule (roadmap PRODUCT-02/03): a retried attempt must not apply
-- its evidence twice. The UNIQUE(attempt_id, knowledge_id, evidence_type) key
-- is the durable guard; the writer uses INSERT ... ON CONFLICT (attempt_id,
-- knowledge_id, evidence_type) DO NOTHING inside the same transaction that
-- updates learner_mastery. Redis/in-memory locks are not the source of truth.

-- CreateTable
CREATE TABLE IF NOT EXISTS "knowledge_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "language" VARCHAR(30) NOT NULL,
    "skill" VARCHAR(50),
    "code" VARCHAR(160) NOT NULL,
    "level" VARCHAR(20),
    "title" VARCHAR(255),
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- One canonical item per language/code/version. A new version is a new row;
-- this is what lets a learner's evidence stay tied to the version it saw.
-- DO $block$ guards against the named UNIQUE constraint already existing when
-- 20261129002000_knowledge_map ran first (IF NOT EXISTS does not cover names).
DO $mastery_items$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'knowledge_items_language_code_version_key'
          AND "conrelid" = 'knowledge_items'::regclass
    ) THEN
        CREATE UNIQUE INDEX "knowledge_items_language_code_version_key"
            ON "knowledge_items"("language", "code", "version");
    END IF;
END
$mastery_items$;

-- Curated-code lookup and version history for one code.
CREATE INDEX IF NOT EXISTS "knowledge_items_code_version_idx"
    ON "knowledge_items"("code", "version");

CREATE INDEX IF NOT EXISTS "knowledge_items_language_skill_idx"
    ON "knowledge_items"("language", "skill");

-- CreateTable
CREATE TABLE IF NOT EXISTS "learner_mastery" (
    "user_id" UUID NOT NULL,
    "knowledge_id" UUID NOT NULL,
    "success_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "failure_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "last_practiced_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_mastery_pkey" PRIMARY KEY ("user_id", "knowledge_id"),
    CONSTRAINT "learner_mastery_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "learner_mastery_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- The composite PK is already the (user_id, knowledge_id) unique target, so
-- a duplicate named UNIQUE index would only add a redundant btree. Support the
-- review path (weak evidence per user, oldest practice first) instead. This
-- index name is unique to this migration and does not collide with the
-- neighbour's learner_mastery_user_id_last_practiced_at_idx.
CREATE INDEX IF NOT EXISTS "learner_mastery_user_id_evidence_count_last_practiced_at_idx"
    ON "learner_mastery"("user_id", "evidence_count", "last_practiced_at");

CREATE INDEX IF NOT EXISTS "learner_mastery_knowledge_id_idx"
    ON "learner_mastery"("knowledge_id");

-- CreateTable
CREATE TABLE IF NOT EXISTS "mastery_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "attempt_id" VARCHAR(160) NOT NULL,
    "knowledge_id" UUID NOT NULL,
    "evidence_type" VARCHAR(50) NOT NULL,
    "score" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastery_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mastery_events_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "mastery_events_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- attempt_id intentionally has no FK: it is an application-owned key that may
-- refer to learning_attempts("id") or to an external/legacy attempt, and
-- mastery events may be written by services that do not persist an attempt
-- row. Uniqueness, not a FK, is the idempotency invariant here.
--
-- NOT NULL on all three columns matters: PostgreSQL treats NULLs as distinct
-- in unique indexes, so a nullable key would let duplicate evidence through.
-- The DO block skips creation when 20261129002000_knowledge_map already added
-- the same named UNIQUE constraint.
DO $mastery_events$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'mastery_events_attempt_id_knowledge_id_evidence_type_key'
          AND "conrelid" = 'mastery_events'::regclass
    ) THEN
        CREATE UNIQUE INDEX "mastery_events_attempt_id_knowledge_id_evidence_type_key"
            ON "mastery_events"("attempt_id", "knowledge_id", "evidence_type");
    END IF;
END
$mastery_events$;

-- Evidence replay for one attempt, and the per-knowledge audit history.
CREATE INDEX IF NOT EXISTS "mastery_events_attempt_id_idx"
    ON "mastery_events"("attempt_id");

CREATE INDEX IF NOT EXISTS "mastery_events_knowledge_id_created_at_idx"
    ON "mastery_events"("knowledge_id", "created_at");

CREATE INDEX IF NOT EXISTS "mastery_events_user_id_created_at_idx"
    ON "mastery_events"("user_id", "created_at");

-- Manual rollback (Prisma Migrate has no automatic down migration). This slice
-- only adds indexes; the adjacent knowledge-map migration owns the tables:
--   DROP INDEX IF EXISTS "mastery_events_user_id_created_at_idx";
--   DROP INDEX IF EXISTS "mastery_events_knowledge_id_created_at_idx";
--   DROP INDEX IF EXISTS "mastery_events_attempt_id_idx";
--   DROP INDEX IF EXISTS "learner_mastery_knowledge_id_idx";
--   DROP INDEX IF EXISTS "learner_mastery_user_id_evidence_count_last_practiced_at_idx";
--   DROP INDEX IF EXISTS "knowledge_items_language_skill_idx";
--   DROP INDEX IF EXISTS "knowledge_items_code_version_idx";
-- Drop the two UNIQUE indexes only if they were created by this migration:
--   DROP INDEX IF EXISTS "mastery_events_attempt_id_knowledge_id_evidence_type_key";
--   DROP INDEX IF EXISTS "knowledge_items_language_code_version_key";
