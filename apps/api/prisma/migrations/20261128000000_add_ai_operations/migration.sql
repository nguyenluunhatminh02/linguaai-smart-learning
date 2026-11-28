-- BILL-03: durable AI operations ledger.
-- Aligned with schema.prisma model ai_operations + enum ai_operations_status_enum.
-- Timestamps use TIMESTAMP(6) with UTC values written by the application,
-- matching all existing migrations. No SQL CHECK constraints are added because
-- Prisma cannot express them natively.
-- conversation_id is kept as a nullable UUID column but has no FK in this
-- migration: the schema slice does not declare a @relation to chat_conversations,
-- so adding one here would cause Prisma drift. result_ref is likewise a plain
-- UUID because the roadmap does not name a target table.

-- CreateEnum
CREATE TYPE "ai_operations_status_enum" AS ENUM ('RESERVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED');

-- CreateTable
CREATE TABLE "ai_operations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "feature" VARCHAR(50) NOT NULL,
    "client_operation_id" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "pricing_version" VARCHAR(50) NOT NULL,
    "reserved_credits" INTEGER NOT NULL,
    "charged_credits" INTEGER NOT NULL DEFAULT 0,
    "status" "ai_operations_status_enum" NOT NULL DEFAULT 'RESERVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMP(6),
    "lease_token" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 0,
    "conversation_id" UUID,
    "result_ref" UUID,
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(6),

    CONSTRAINT "ai_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_operations_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Bounded idempotency scope: client_operation_id must remain NOT NULL so PostgreSQL
-- does not permit duplicate NULL keys. request_hash is the SHA-256 hex digest of the
-- canonical validated payload (no random timestamps).
-- Index names match the defaults Prisma generates from the schema (no map:).
CREATE UNIQUE INDEX "ai_operations_user_id_feature_client_operation_id_key"
    ON "ai_operations"("user_id", "feature", "client_operation_id");
CREATE INDEX "ai_operations_status_lease_until_idx"
    ON "ai_operations"("status", "lease_until");
CREATE INDEX "ai_operations_user_id_idx"
    ON "ai_operations"("user_id");
