-- AlterTable
ALTER TABLE "token_transactions" ADD COLUMN "idempotency_key" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "token_transactions_idempotency_key_key" ON "token_transactions"("idempotency_key");
CREATE INDEX "token_transactions_idempotency_key_idx" ON "token_transactions"("idempotency_key");
