-- CreateTable
CREATE TABLE "user_token_balance" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_token_balance_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "token_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "feature" VARCHAR(50) NOT NULL DEFAULT '',
    "balance_after" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "user_token_balance" ADD CONSTRAINT "user_token_balance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX "token_transactions_user_id_created_at_idx" ON "token_transactions"("user_id", "created_at");
