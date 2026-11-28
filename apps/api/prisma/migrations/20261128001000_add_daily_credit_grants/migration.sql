-- BILL-05: durable once-per-day marker for daily top-up and check-in grants.
-- Mirrors the `daily_credit_grants` model and `daily_credit_grant_type` enum in
-- schema.prisma. A row is written even when amount = 0 so a processed UTC day
-- is recorded without relying on Redis.
-- grant_type is stored as the native PostgreSQL enum type because Prisma maps
-- the schema enum to a database enum (same convention as other enum-backed
-- columns in this project). Timestamps use TIMESTAMP(6) and application-supplied
-- UTC values, matching existing migrations.

-- CreateEnum
CREATE TYPE "daily_credit_grant_type" AS ENUM ('DAILY_TOPUP', 'DAILY_CHECKIN');

-- CreateTable
CREATE TABLE "daily_credit_grants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "grant_type" "daily_credit_grant_type" NOT NULL,
    "day" DATE NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_credit_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_credit_grants_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Unique per user, grant type and UTC day, including rows with amount = 0.
CREATE UNIQUE INDEX "daily_credit_grants_user_id_grant_type_day_key"
    ON "daily_credit_grants"("user_id", "grant_type", "day");
CREATE INDEX "daily_credit_grants_user_id_day_idx"
    ON "daily_credit_grants"("user_id", "day");
