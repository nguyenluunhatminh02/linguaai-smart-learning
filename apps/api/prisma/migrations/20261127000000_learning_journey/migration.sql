ALTER TABLE "users" ADD COLUMN "learning_level" VARCHAR(10),
                    ADD COLUMN "daily_study_minutes" INTEGER,
                    ADD COLUMN "daily_word_goal" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "cards" ADD COLUMN "seed_key" VARCHAR(500),
                    ADD COLUMN "retired_at" TIMESTAMP(6),
                    ADD COLUMN "learning_phrase_key" VARCHAR(120);

CREATE UNIQUE INDEX "cards_deck_id_seed_key_key" ON "cards"("deck_id", "seed_key");
CREATE UNIQUE INDEX "cards_deck_id_learning_phrase_key_key" ON "cards"("deck_id", "learning_phrase_key");

ALTER TABLE "decks" ADD COLUMN "learning_collection" VARCHAR(30);
CREATE UNIQUE INDEX "decks_creator_id_learning_collection_key" ON "decks"("creator_id", "learning_collection");

ALTER TABLE "quizzes" ADD COLUMN "language" VARCHAR(50);
UPDATE "quizzes" SET "language" = "decks"."language"
FROM "decks" WHERE "quizzes"."deck_id" = "decks"."id";

CREATE TABLE "learning_completions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "activity_type" VARCHAR(20) NOT NULL,
    "activity_id" VARCHAR(160) NOT NULL,
    "language" VARCHAR(30) NOT NULL,
    "score" INTEGER,
    "total" INTEGER,
    "completed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_completions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_completions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "learning_completions_user_id_activity_type_activity_id_key"
    ON "learning_completions"("user_id", "activity_type", "activity_id");
CREATE INDEX "learning_completions_user_id_language_completed_at_idx"
    ON "learning_completions"("user_id", "language", "completed_at");

CREATE TABLE "srs_review_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "srs_review_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "srs_review_events_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "srs_review_events_card_id_fkey"
        FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "srs_review_events_user_id_idx" ON "srs_review_events"("user_id");
CREATE INDEX "srs_review_events_card_id_idx" ON "srs_review_events"("card_id");
