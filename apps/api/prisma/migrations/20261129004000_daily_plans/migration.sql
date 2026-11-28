-- PRODUCT-04: idempotent daily study plans.
-- uuid-ossp is installed in the baseline migration; TIMESTAMP(6)
-- CURRENT_TIMESTAMP defaults and ON DELETE CASCADE user foreign keys follow
-- 20261128001000_add_daily_credit_grants.
-- Status columns are plain VARCHAR (see 20261128004000_content_workflow);
-- activity_id is VARCHAR(160) to match learning_completions.activity_id.
-- The UTC day is stored as DATE with its source timezone label; application
-- code performs any local-day conversion.

-- CreateTable
CREATE TABLE IF NOT EXISTS "daily_plans" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "generated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_plans_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Idempotency guard for plan generation: one row per user, UTC day and
-- version. Concurrent refresh attempts must resolve a duplicate key (P2002)
-- by reading back the winning row rather than relying on a read-then-write.
CREATE UNIQUE INDEX IF NOT EXISTS "daily_plans_user_id_day_version_key"
    ON "daily_plans"("user_id", "day", "version");

-- Lookup of the current plan for a learner and day.
CREATE INDEX IF NOT EXISTS "daily_plans_user_id_day_idx"
    ON "daily_plans"("user_id", "day");

-- CreateTable
CREATE TABLE IF NOT EXISTS "daily_plan_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "plan_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "activity_type" VARCHAR(50) NOT NULL,
    "activity_id" VARCHAR(160) NOT NULL,
    "estimated_minutes" INTEGER NOT NULL DEFAULT 10,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "knowledge_tags" JSON NOT NULL DEFAULT '[]'::json,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_plan_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_plan_items_plan_id_fkey"
        FOREIGN KEY ("plan_id") REFERENCES "daily_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Stable ordering within a plan; also the conflict target for an idempotent
-- item upsert when a plan version is regenerated.
CREATE UNIQUE INDEX IF NOT EXISTS "daily_plan_items_plan_id_order_index_key"
    ON "daily_plan_items"("plan_id", "order_index");

-- Per-plan queue/status reads (pending items first).
CREATE INDEX IF NOT EXISTS "daily_plan_items_plan_id_status_idx"
    ON "daily_plan_items"("plan_id", "status");

-- Manual rollback (Prisma Migrate has no automatic down migration):
--   DROP TABLE IF EXISTS "daily_plan_items";
--   DROP TABLE IF EXISTS "daily_plans";
