-- DB-03: database-level invariants + DB-04 candidate indexes.
-- This is a NEW migration. No previously applied migration is modified.
--
-- Safety notes:
--   * Every CHECK is added as NOT VALID first (no long-lived write lock on
--     existing rows), then validated in a separate statement. Validation takes
--     only a SHARE UPDATE EXCLUSIVE lock, so concurrent writes keep working.
--     Validation still fails the migration when legacy rows violate a bound;
--     inspect the queries in the "preflight" section below before applying to
--     a populated database. The bounds chosen here match the application's
--     own validation exactly, so a compliant dataset should validate cleanly.
--   * Prisma cannot express CHECK constraints in schema.prisma. Adding them to
--     schema.prisma would make `prisma migrate dev` want to drop them, so they
--     intentionally live only in this SQL migration.
--   * Index names are new and do not collide with any index from
--     20250101000000_baseline_init, 20261127000000_learning_journey,
--     20261128000000_add_ai_operations, 20261128001000_add_daily_credit_grants,
--     20261128003000_skill_proficiency or 20261128004000_content_workflow.
--     All use IF NOT EXISTS so re-running or a partially applied state is safe.
--   * No rollback statements are emitted: Prisma Migrate does not support
--     automatic down migrations. Manual rollback SQL is documented at the end.

-- ─────────────────────────────────────────────────────────────────────────────
-- Preflight (run manually against a populated database before applying):
--
--   SELECT id FROM "user_token_balance" WHERE "balance" < 0;
--   SELECT id FROM "token_transactions" WHERE "balance_after" < 0;
--   SELECT id FROM "learning_completions"
--     WHERE NOT (("score" IS NULL AND "total" IS NULL) OR
--                ("total" >= 1 AND "score" >= 0 AND "score" <= "total"))
--        OR "duration_seconds" < 0;
--   SELECT id FROM "review_sessions"
--     WHERE "cards_correct" > "cards_reviewed" OR "duration_seconds" < 0;
--   SELECT id FROM "user_card_progress"
--     WHERE "ease_factor" <= 0 OR "difficulty" < 1 OR "difficulty" > 10
--        OR "interval_days" < 0 OR "repetition_count" < 0;
--   SELECT id FROM "quiz_attempts"
--     WHERE "score" < 0 OR "score" > "total_questions"
--        OR "total_questions" < 0 OR "duration_seconds" < 0;
--   SELECT user_id, language, skill FROM "skill_proficiency"
--     WHERE "confidence" < 0 OR "confidence" > 1 OR "evidence_count" < 0;
--   SELECT id FROM "placement_attempts"
--     WHERE "total" < 1 OR "score" < 0 OR "score" > "total";
--   SELECT id FROM "ai_operations"
--     WHERE "reserved_credits" < 0 OR "charged_credits" < 0
--        OR "charged_credits" > "reserved_credits" OR "attempt_count" < 0;
--   SELECT id FROM "daily_credit_grants" WHERE "amount" < 0;
--
-- Fix or explicitly accept any reported rows before running VALIDATE below.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Token economy (BILL-01/02): balance is authoritative and non-negative. ──
ALTER TABLE "user_token_balance"
    ADD CONSTRAINT "user_token_balance_balance_nonnegative_check"
    CHECK ("balance" >= 0) NOT VALID;
ALTER TABLE "user_token_balance"
    VALIDATE CONSTRAINT "user_token_balance_balance_nonnegative_check";

-- Ledger rows must never show a negative balance. amount = 0 is intentionally
-- allowed: TokensService writes a zero-amount consumption marker as the
-- idempotent settlement key for a debited operation; the real movement is the
-- preceding negative entry with its own idempotency key.

ALTER TABLE "token_transactions"
    ADD CONSTRAINT "token_transactions_balance_after_nonnegative_check"
    CHECK ("balance_after" >= 0) NOT VALID;
ALTER TABLE "token_transactions"
    VALIDATE CONSTRAINT "token_transactions_balance_after_nonnegative_check";

-- ── Learning completion (DB-01): score contract and non-negative duration. ──
-- Both columns are nullable in the schema; a row with both NULL is treated
-- as "score unknown" and is allowed, but a present score must be within its
-- declared total. Legacy rows from before score/total existed keep passing.
ALTER TABLE "learning_completions"
    ADD CONSTRAINT "learning_completions_score_range_check"
    CHECK (
        ("score" IS NULL AND "total" IS NULL) OR
        ("total" >= 1 AND "score" >= 0 AND "score" <= "total")
    ) NOT VALID;
ALTER TABLE "learning_completions"
    VALIDATE CONSTRAINT "learning_completions_score_range_check";

ALTER TABLE "learning_completions"
    ADD CONSTRAINT "learning_completions_duration_nonnegative_check"
    CHECK ("duration_seconds" >= 0) NOT VALID;
ALTER TABLE "learning_completions"
    VALIDATE CONSTRAINT "learning_completions_duration_nonnegative_check";

-- ── SRS (DB-01/TEST-03): rating counts and FSRS state stay in domain. ────────
-- ease_factor stores FSRS stability S, not SM-2 EF. The algorithm clamps S to
-- >= 0.1 and the schema default is 2.5; legacy SM-2 rows use 1.3..2.5, all
-- compatible with the weaker > 0 bound. An upper bound is deliberately not
-- imposed: stability can grow with repeated successful reviews.
ALTER TABLE "user_card_progress"
    ADD CONSTRAINT "user_card_progress_ease_factor_positive_check"
    CHECK ("ease_factor" > 0) NOT VALID;
ALTER TABLE "user_card_progress"
    VALIDATE CONSTRAINT "user_card_progress_ease_factor_positive_check";

-- FSRS difficulty is clamped to [1, 10] by FsrsAlgorithm; schema default 5.0.
ALTER TABLE "user_card_progress"
    ADD CONSTRAINT "user_card_progress_difficulty_range_check"
    CHECK ("difficulty" >= 1 AND "difficulty" <= 10) NOT VALID;
ALTER TABLE "user_card_progress"
    VALIDATE CONSTRAINT "user_card_progress_difficulty_range_check";

ALTER TABLE "user_card_progress"
    ADD CONSTRAINT "user_card_progress_interval_nonnegative_check"
    CHECK ("interval_days" >= 0) NOT VALID;
ALTER TABLE "user_card_progress"
    VALIDATE CONSTRAINT "user_card_progress_interval_nonnegative_check";

ALTER TABLE "user_card_progress"
    ADD CONSTRAINT "user_card_progress_repetition_nonnegative_check"
    CHECK ("repetition_count" >= 0) NOT VALID;
ALTER TABLE "user_card_progress"
    VALIDATE CONSTRAINT "user_card_progress_repetition_nonnegative_check";

ALTER TABLE "review_sessions"
    ADD CONSTRAINT "review_sessions_counts_nonnegative_check"
    CHECK (
        "cards_reviewed" >= 0 AND
        "cards_correct" >= 0 AND
        "cards_correct" <= "cards_reviewed" AND
        "duration_seconds" >= 0
    ) NOT VALID;
ALTER TABLE "review_sessions"
    VALIDATE CONSTRAINT "review_sessions_counts_nonnegative_check";

-- ── Quiz attempts: same score <= total contract as other activities. ─────────
ALTER TABLE "quiz_attempts"
    ADD CONSTRAINT "quiz_attempts_score_range_check"
    CHECK ("score" >= 0 AND "score" <= "total_questions") NOT VALID;
ALTER TABLE "quiz_attempts"
    VALIDATE CONSTRAINT "quiz_attempts_score_range_check";

ALTER TABLE "quiz_attempts"
    ADD CONSTRAINT "quiz_attempts_duration_nonnegative_check"
    CHECK ("duration_seconds" >= 0) NOT VALID;
ALTER TABLE "quiz_attempts"
    VALIDATE CONSTRAINT "quiz_attempts_duration_nonnegative_check";

-- ── Skill proficiency (SKILL-01, raw-SQL-only table). ────────────────────────
-- validateScoreTotal() in ProficiencyService already enforces these ranges,
-- and confidenceForCount() returns count / (count + 2) <= 1.
ALTER TABLE "skill_proficiency"
    ADD CONSTRAINT "skill_proficiency_confidence_range_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1) NOT VALID;
ALTER TABLE "skill_proficiency"
    VALIDATE CONSTRAINT "skill_proficiency_confidence_range_check";

ALTER TABLE "skill_proficiency"
    ADD CONSTRAINT "skill_proficiency_evidence_count_nonnegative_check"
    CHECK ("evidence_count" >= 0) NOT VALID;
ALTER TABLE "skill_proficiency"
    VALIDATE CONSTRAINT "skill_proficiency_evidence_count_nonnegative_check";

ALTER TABLE "placement_attempts"
    ADD CONSTRAINT "placement_attempts_score_range_check"
    CHECK ("total" >= 1 AND "score" >= 0 AND "score" <= "total") NOT VALID;
ALTER TABLE "placement_attempts"
    VALIDATE CONSTRAINT "placement_attempts_score_range_check";

-- ── AI operations ledger (BILL-03/04). ───────────────────────────────────────
-- charged_credits is the settled portion of reserved_credits; it must never
-- exceed the reservation even while the operation is still RUNNING.
ALTER TABLE "ai_operations"
    ADD CONSTRAINT "ai_operations_credits_range_check"
    CHECK (
        "reserved_credits" >= 0 AND
        "charged_credits" >= 0 AND
        "charged_credits" <= "reserved_credits"
    ) NOT VALID;
ALTER TABLE "ai_operations"
    VALIDATE CONSTRAINT "ai_operations_credits_range_check";

ALTER TABLE "ai_operations"
    ADD CONSTRAINT "ai_operations_attempt_count_nonnegative_check"
    CHECK ("attempt_count" >= 0) NOT VALID;
ALTER TABLE "ai_operations"
    VALIDATE CONSTRAINT "ai_operations_attempt_count_nonnegative_check";

-- ── Daily credit grants (BILL-05): zero rows are valid markers. ──────────────
ALTER TABLE "daily_credit_grants"
    ADD CONSTRAINT "daily_credit_grants_amount_nonnegative_check"
    CHECK ("amount" >= 0) NOT VALID;
ALTER TABLE "daily_credit_grants"
    VALIDATE CONSTRAINT "daily_credit_grants_amount_nonnegative_check";

-- ─────────────────────────────────────────────────────────────────────────────
-- DB-04 candidate indexes for profiled query shapes.
-- Names are distinct from Prisma defaults; they are not added to schema.prisma
-- so `prisma migrate diff` stays quiet and no drift is introduced.
-- ─────────────────────────────────────────────────────────────────────────────

-- Flashcards due for one user: equality on user_id, range on next_review_date.
CREATE INDEX IF NOT EXISTS "idx_user_card_progress_user_next_review_date"
    ON "user_card_progress"("user_id", "next_review_date");

-- Chat history pagination: scoped to a conversation, ordered by time + id.
CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_created_at_id"
    ON "chat_messages"("conversation_id", "created_at", "id");

-- Most recent conversation per user.
CREATE INDEX IF NOT EXISTS "idx_chat_conversations_user_created_at_id"
    ON "chat_conversations"("user_id", "created_at", "id");

-- Writing history: user-scoped, newest first, id tie-breaker for stable pages.
CREATE INDEX IF NOT EXISTS "idx_writing_submissions_user_created_at_id"
    ON "writing_submissions"("user_id", "created_at", "id");

-- Speaking history: user-scoped, newest first, id tie-breaker for stable pages.
CREATE INDEX IF NOT EXISTS "idx_speaking_submissions_user_created_at_id"
    ON "speaking_submissions"("user_id", "created_at", "id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual rollback (do NOT commit this as a Prisma down migration):
--
--   DROP INDEX IF EXISTS "idx_speaking_submissions_user_created_at_id";
--   DROP INDEX IF EXISTS "idx_writing_submissions_user_created_at_id";
--   DROP INDEX IF EXISTS "idx_chat_conversations_user_created_at_id";
--   DROP INDEX IF EXISTS "idx_chat_messages_conversation_created_at_id";
--   DROP INDEX IF EXISTS "idx_user_card_progress_user_next_review_date";
--
--   ALTER TABLE "daily_credit_grants"
--       DROP CONSTRAINT IF EXISTS "daily_credit_grants_amount_nonnegative_check";
--   ALTER TABLE "ai_operations"
--       DROP CONSTRAINT IF EXISTS "ai_operations_attempt_count_nonnegative_check";
--   ALTER TABLE "ai_operations"
--       DROP CONSTRAINT IF EXISTS "ai_operations_credits_range_check";
--   ALTER TABLE "placement_attempts"
--       DROP CONSTRAINT IF EXISTS "placement_attempts_score_range_check";
--   ALTER TABLE "skill_proficiency"
--       DROP CONSTRAINT IF EXISTS "skill_proficiency_evidence_count_nonnegative_check";
--   ALTER TABLE "skill_proficiency"
--       DROP CONSTRAINT IF EXISTS "skill_proficiency_confidence_range_check";
--   ALTER TABLE "quiz_attempts"
--       DROP CONSTRAINT IF EXISTS "quiz_attempts_duration_nonnegative_check";
--   ALTER TABLE "quiz_attempts"
--       DROP CONSTRAINT IF EXISTS "quiz_attempts_score_range_check";
--   ALTER TABLE "review_sessions"
--       DROP CONSTRAINT IF EXISTS "review_sessions_counts_nonnegative_check";
--   ALTER TABLE "user_card_progress"
--       DROP CONSTRAINT IF EXISTS "user_card_progress_repetition_nonnegative_check";
--   ALTER TABLE "user_card_progress"
--       DROP CONSTRAINT IF EXISTS "user_card_progress_interval_nonnegative_check";
--   ALTER TABLE "user_card_progress"
--       DROP CONSTRAINT IF EXISTS "user_card_progress_difficulty_range_check";
--   ALTER TABLE "user_card_progress"
--       DROP CONSTRAINT IF EXISTS "user_card_progress_ease_factor_positive_check";
--   ALTER TABLE "learning_completions"
--       DROP CONSTRAINT IF EXISTS "learning_completions_duration_nonnegative_check";
--   ALTER TABLE "learning_completions"
--       DROP CONSTRAINT IF EXISTS "learning_completions_score_range_check";
--   ALTER TABLE "token_transactions"
--       DROP CONSTRAINT IF EXISTS "token_transactions_balance_after_nonnegative_check";
--   ALTER TABLE "user_token_balance"
--       DROP CONSTRAINT IF EXISTS "user_token_balance_balance_nonnegative_check";
--
-- After rollback, mark the migration reverted in _prisma_migrations only when
-- following the documented Prisma recovery procedure, never by hand-editing
-- already applied migration files.
