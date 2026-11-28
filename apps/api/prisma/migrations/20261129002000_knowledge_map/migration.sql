-- PROD-04 / PRODUCT-02: knowledge map and learner mastery storage.
-- New migration only; no previously applied migration is modified.
--
-- Status/type columns are plain VARCHAR rather than native PostgreSQL enums.
-- Conventions follow
-- 20250101000000_baseline_init: UUID keys from uuid_generate_v4(),
-- TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP, user_id UUID NOT NULL with
-- FK -> users("id") ON DELETE CASCADE ON UPDATE NO ACTION. No CHECK constraints
-- (Prisma cannot express them); no CREATE EXTENSION line (uuid-ossp is already
-- installed by the baseline migration).
--
-- Every DDL statement uses IF NOT EXISTS so a partially applied state is safe.
-- No automatic down migration is emitted; manual rollback SQL is at the end.

-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical knowledge items. A language + code + version triple identifies one
-- item revision; version changes create a new row rather than overwriting the
-- old one so historical mastery evidence keeps pointing at the code it saw.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "language" VARCHAR(30) NOT NULL,
    "skill" VARCHAR(50) NOT NULL,
    "code" VARCHAR(160) NOT NULL,
    "level" VARCHAR(30),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_items_language_code_version_key"
        UNIQUE ("language", "code", "version")
);

-- Catalog browsing: all items for a language/skill, optionally by level.
CREATE INDEX IF NOT EXISTS "knowledge_items_language_skill_level_idx"
    ON "knowledge_items"("language", "skill", "level");

-- ─────────────────────────────────────────────────────────────────────────────
-- Directed prerequisite edges. Both endpoints are knowledge item UUIDs; a
-- composite PRIMARY KEY prevents duplicate edges and gives the self-referencing
-- traversal an index in both directions. Cycle detection is an application
-- concern (validated before insert); the MVP does not need a graph database.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "knowledge_prerequisites" (
    "knowledge_id" UUID NOT NULL,
    "prerequisite_id" UUID NOT NULL,

    CONSTRAINT "knowledge_prerequisites_pkey"
        PRIMARY KEY ("knowledge_id", "prerequisite_id"),
    CONSTRAINT "knowledge_prerequisites_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_prerequisites_prerequisite_id_fkey"
        FOREIGN KEY ("prerequisite_id") REFERENCES "knowledge_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Reverse lookup: which items does mastering this one unlock?
CREATE INDEX IF NOT EXISTS "knowledge_prerequisites_prerequisite_id_idx"
    ON "knowledge_prerequisites"("prerequisite_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Curated mapping from existing activities (quiz, reading passage, writing /
-- speaking submission, SRS card, content item, ...) to knowledge items.
-- activity_id is VARCHAR because activity types have different key domains;
-- content_version pins a mapping to a specific revision of the activity.
-- The composite key makes a mapping idempotent per activity version + item.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "activity_knowledge_items" (
    "activity_type" VARCHAR(50) NOT NULL,
    "activity_id" VARCHAR(160) NOT NULL,
    "content_version" VARCHAR(50) NOT NULL DEFAULT '1',
    "knowledge_id" UUID NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_knowledge_items_pkey"
        PRIMARY KEY ("activity_type", "activity_id", "content_version", "knowledge_id"),
    CONSTRAINT "activity_knowledge_items_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Daily-plan content selection: find activities tagged with a knowledge item.
CREATE INDEX IF NOT EXISTS "activity_knowledge_items_knowledge_id_idx"
    ON "activity_knowledge_items"("knowledge_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user mastery snapshot. Composite PK gives one row per user/knowledge
-- pair and a direct ON CONFLICT target for the evidence updater. The snapshot
-- is derived from mastery_events but stored so reads stay cheap.
-- ─────────────────────────────────────────────────────────────────────────────
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
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "learner_mastery_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Weak-knowledge / review-needed queries: one user, ordered by last practice.
CREATE INDEX IF NOT EXISTS "learner_mastery_user_id_last_practiced_at_idx"
    ON "learner_mastery"("user_id", "last_practiced_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only evidence log. One row per attempt/knowledge/evidence_type makes
-- retrying an attempt idempotent: a replay conflicts instead of double-counting
-- mastery. attempt_id is VARCHAR because learning_attempts.id is a UUID but
-- external/legacy attempt identifiers may not be (and no FK is added so the
-- table stays usable before the attempt log is written).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mastery_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "attempt_id" VARCHAR(160) NOT NULL,
    "knowledge_id" UUID NOT NULL,
    "evidence_type" VARCHAR(50) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastery_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mastery_events_attempt_id_knowledge_id_evidence_type_key"
        UNIQUE ("attempt_id", "knowledge_id", "evidence_type"),
    CONSTRAINT "mastery_events_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "mastery_events_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
);

-- User-scoped mastery history, newest first (id as a stable tie-breaker).
CREATE INDEX IF NOT EXISTS "mastery_events_user_id_created_at_id_idx"
    ON "mastery_events"("user_id", "created_at" DESC, "id");

-- Attempt replay lookup without scanning the whole evidence log.
CREATE INDEX IF NOT EXISTS "mastery_events_attempt_id_idx"
    ON "mastery_events"("attempt_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Error log for the error-to-flashcard pipeline. Excerpt is optional and kept
-- minimal; status is app-owned (e.g. OPEN, RESOLVED, DISMISSED) and confidence
-- records how much the classifier/AI result should be trusted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "learner_errors" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "attempt_id" VARCHAR(160),
    "knowledge_id" UUID,
    "error_type" VARCHAR(80) NOT NULL,
    "excerpt" TEXT,
    "correction" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_errors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learner_errors_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "learner_errors_knowledge_id_fkey"
        FOREIGN KEY ("knowledge_id") REFERENCES "knowledge_items"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Error history and error-to-card candidate lookup paths.
CREATE INDEX IF NOT EXISTS "learner_errors_user_id_created_at_id_idx"
    ON "learner_errors"("user_id", "created_at" DESC, "id");
CREATE INDEX IF NOT EXISTS "learner_errors_user_id_knowledge_id_idx"
    ON "learner_errors"("user_id", "knowledge_id");
CREATE INDEX IF NOT EXISTS "learner_errors_attempt_id_idx"
    ON "learner_errors"("attempt_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual rollback (Prisma Migrate has no down migrations). Roll back in reverse
-- dependency order; this drops the knowledge map and all mastery evidence.
-- ─────────────────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS "learner_errors";
--   DROP TABLE IF EXISTS "mastery_events";
--   DROP TABLE IF EXISTS "learner_mastery";
--   DROP TABLE IF EXISTS "activity_knowledge_items";
--   DROP TABLE IF EXISTS "knowledge_prerequisites";
--   DROP TABLE IF EXISTS "knowledge_items";
