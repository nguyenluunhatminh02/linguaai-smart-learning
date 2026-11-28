-- SKILL-01: measurable per-skill proficiency and placement evidence.
-- Intentionally absent from schema.prisma (peer-owned); accessed only through
-- $queryRaw/$executeRaw in ProficiencyModule. Conventions follow
-- 20250101000000_baseline_init and 20261127000000_learning_journey:
-- UUID keys from uuid_generate_v4(), TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
-- user_id UUID NOT NULL with FK -> users("id") ON DELETE CASCADE ON UPDATE CASCADE.
-- No CHECK constraints: Prisma cannot express them in schema.prisma.
-- No CREATE EXTENSION line: uuid-ossp is installed by the baseline migration.

-- CreateTable
CREATE TABLE "skill_proficiency" (
    "user_id" UUID NOT NULL,
    "language" VARCHAR(30) NOT NULL,
    "skill" VARCHAR(50) NOT NULL,
    "cefr_estimate" VARCHAR(10),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_proficiency_pkey" PRIMARY KEY ("user_id", "language", "skill"),
    CONSTRAINT "skill_proficiency_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Composite PK gives one row per user/language/skill and a direct ON CONFLICT target.
CREATE INDEX "skill_proficiency_user_id_language_updated_at_idx"
    ON "skill_proficiency"("user_id", "language", "updated_at");

-- CreateTable
CREATE TABLE "placement_attempts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "language" VARCHAR(30) NOT NULL,
    "skill" VARCHAR(50) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "total" INTEGER NOT NULL,
    "cefr_estimate" VARCHAR(10),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "placement_attempts_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Multiple attempts per user/language/skill are expected; index the history path.
CREATE INDEX "placement_attempts_user_id_language_skill_created_at_idx"
    ON "placement_attempts"("user_id", "language", "skill", "created_at");
