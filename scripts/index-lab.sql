-- ============================================================================
-- index-lab.sql — DB-04 Query Profiling and Index Tuning Lab
-- ============================================================================
-- Purpose: Repeatable EXPLAIN lab for benchmarking candidate indexes on
--          high-traffic queries. All indexes use lab_* prefix and are
--          dropped at run start and end for clean repeatability.
--
-- Usage:
--   psql -v ON_ERROR_STOP=1 -v confirm_lab_db=yes -f scripts/index-lab.sql
--
--   Optional variable overrides (resolve via \gset from fixture emails):
--     :fixture_user_uuid        - user for due-card / chat / writing / speaking queries
--     :fixture_conversation_uuid - conversation for chat history query
--     :fixture_writing_user_uuid - user for writing history (defaults to :fixture_user_uuid)
--     :fixture_speaking_user_uuid - user for speaking history (defaults to :fixture_user_uuid)
--     :fixture_token_user_uuid  - user for token ledger (defaults to :fixture_user_uuid)
--     :fixture_learning_user_uuid - user for learning progress (defaults to :fixture_user_uuid)
--     :fixture_learning_language  - language filter for learning progress (default: 'english')
--     :fixture_deck_uuid        - deck for due-card query (optional, defaults to any deck)
--
--   Example with explicit UUIDs:
--     psql -v ON_ERROR_STOP=1 -v confirm_lab_db=yes \
--          -v fixture_user_uuid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' \
--          -v fixture_conversation_uuid='11111111-2222-3333-4444-555555555555' \
--          -f scripts/index-lab.sql
--
-- Requirements:
--   - PostgreSQL 13+ (for \if :{?var} syntax)
--   - Disposable test database (never run on production)
--   - Tables must exist with realistic data distribution (10k+ rows recommended)
--   - Run ANALYZE on tables before executing this script for accurate plans
--
-- Safety:
--   - All lab indexes are dropped at start and end (clean state)
--   - Script refuses to run unless :confirm_lab_db is set
--   - No schema changes, no data modifications, only EXPLAIN and index DDL
-- ============================================================================

\set ON_ERROR_STOP on
\timing on

-- ============================================================================
-- SAFETY GUARD: Require explicit confirmation that this is a lab database
-- ============================================================================
\if :{?confirm_lab_db}
  \echo '✓ Lab database confirmation received'
\else
  \echo '✗ ERROR: Set -v confirm_lab_db=yes to confirm this is a disposable lab database'
  \quit
\endif

-- ============================================================================
-- FIXTURE RESOLUTION: Resolve UUIDs from fixture emails if not provided
-- ============================================================================
-- If fixture_user_uuid is not set, try to resolve from seed-curator email
\if :{?fixture_user_uuid}
  \echo '✓ Using provided fixture_user_uuid'
\else
  \echo '→ Resolving fixture_user_uuid from seed-curator@linguaai.local...'
  \set ON_ERROR_STOP off
  SELECT id AS fixture_user_uuid FROM users WHERE email = 'seed-curator@linguaai.local' LIMIT 1 \gset
  \set ON_ERROR_STOP on
  \if :{?fixture_user_uuid}
    \echo '✓ Resolved fixture_user_uuid from seed curator'
  \else
    \echo '✗ ERROR: fixture_user_uuid is required; pass -v fixture_user_uuid=... or seed the lab DB.'
    \quit
  \endif
\endif

-- Resolve other fixture UUIDs with fallback to fixture_user_uuid
\if :{?fixture_writing_user_uuid}
\else
  \set fixture_writing_user_uuid :fixture_user_uuid
\endif

\if :{?fixture_speaking_user_uuid}
\else
  \set fixture_speaking_user_uuid :fixture_user_uuid
\endif

\if :{?fixture_token_user_uuid}
\else
  \set fixture_token_user_uuid :fixture_user_uuid
\endif

\if :{?fixture_learning_user_uuid}
\else
  \set fixture_learning_user_uuid :fixture_user_uuid
\endif

\if :{?fixture_learning_language}
\else
  \set fixture_learning_language 'english'
\endif

-- Resolve conversation UUID if not provided
\if :{?fixture_conversation_uuid}
  \echo '✓ Using provided fixture_conversation_uuid'
\else
  \echo '→ Resolving fixture_conversation_uuid from fixture user...'
  \set ON_ERROR_STOP off
  SELECT id AS fixture_conversation_uuid FROM chat_conversations WHERE user_id = :'fixture_user_uuid'::uuid ORDER BY created_at DESC LIMIT 1 \gset
  \set ON_ERROR_STOP on
  \if :{?fixture_conversation_uuid}
    \echo '✓ Resolved fixture_conversation_uuid'
  \else
    \echo '✗ ERROR: fixture_conversation_uuid is required; pass -v fixture_conversation_uuid=... or seed conversations.'
    \quit
  \endif
\endif

-- Resolve deck UUID if not provided (optional for due-card query)
\if :{?fixture_deck_uuid}
  \echo '✓ Using provided fixture_deck_uuid'
\else
  \echo '→ Resolving fixture_deck_uuid from fixture user...'
  SELECT id AS fixture_deck_uuid FROM decks WHERE creator_id = :'fixture_user_uuid'::uuid LIMIT 1 \gset
  \if :{?fixture_deck_uuid}
    \echo '✓ Resolved fixture_deck_uuid'
  \else
    \echo '⚠ No deck found for fixture user. Due-card query will use NULL deck_id.'
    \set fixture_deck_uuid NULL
  \endif
\endif

\echo ''
\echo '============================================================================'
\echo 'Fixture UUIDs:'
\echo '  fixture_user_uuid:        :fixture_user_uuid'
\echo '  fixture_conversation_uuid: :fixture_conversation_uuid'
\echo '  fixture_writing_user_uuid: :fixture_writing_user_uuid'
\echo '  fixture_speaking_user_uuid: :fixture_speaking_user_uuid'
\echo '  fixture_token_user_uuid:  :fixture_token_user_uuid'
\echo '  fixture_learning_user_uuid: :fixture_learning_user_uuid'
\echo '  fixture_learning_language: :fixture_learning_language'
\echo '  fixture_deck_uuid:        :fixture_deck_uuid'
\echo '============================================================================'
\echo ''

-- ============================================================================
-- CLEANUP: Drop all lab_* indexes from previous runs
-- ============================================================================
\echo '→ Cleaning up lab_* indexes from previous runs...'
DROP INDEX IF EXISTS lab_progress_user_due_idx;
DROP INDEX IF EXISTS lab_chat_messages_conv_created_id_idx;
DROP INDEX IF EXISTS lab_chat_conversations_user_created_id_idx;
DROP INDEX IF EXISTS lab_writing_user_created_id_idx;
DROP INDEX IF EXISTS lab_speaking_user_created_id_idx;
DROP INDEX IF EXISTS lab_token_user_created_idx;
DROP INDEX IF EXISTS lab_learning_user_lang_completed_idx;
\echo '✓ Cleanup complete'
\echo ''

-- ============================================================================
-- QUERY 1: Flashcard due cards (user_card_progress)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 1: Flashcard due cards'
\echo '============================================================================'
\echo 'Query shape: SELECT card_id, next_review_date FROM user_card_progress'
\echo '             WHERE user_id = ? AND next_review_date <= CURRENT_TIMESTAMP'
\echo '             ORDER BY next_review_date LIMIT 50;'
\echo ''
\echo 'Candidate index: user_card_progress(user_id, next_review_date)'
\echo ''

\echo '--- BEFORE: Baseline EXPLAIN (no lab index) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT card_id, next_review_date
FROM user_card_progress
WHERE user_id = :'fixture_user_uuid'::uuid
  AND next_review_date <= CURRENT_TIMESTAMP
ORDER BY next_review_date
LIMIT 50;

\echo ''
\echo '→ Creating lab index: lab_progress_user_due_idx...'
CREATE INDEX lab_progress_user_due_idx ON user_card_progress (user_id, next_review_date);
ANALYZE user_card_progress;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT card_id, next_review_date
FROM user_card_progress
WHERE user_id = :'fixture_user_uuid'::uuid
  AND next_review_date <= CURRENT_TIMESTAMP
ORDER BY next_review_date
LIMIT 50;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_progress_user_due_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 2: Chat history pagination (chat_messages)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 2: Chat history pagination (cursor-based)'
\echo '============================================================================'
\echo 'Query shape: SELECT id, role, content, created_at FROM chat_messages'
\echo '             WHERE conversation_id = ?'
\echo '             ORDER BY created_at ASC, id ASC LIMIT 50;'
\echo ''
\echo 'Candidate index: chat_messages(conversation_id, created_at, id)'
\echo ''

\echo '--- BEFORE: Baseline EXPLAIN (no lab index) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, role, content, created_at
FROM chat_messages
WHERE conversation_id = :'fixture_conversation_uuid'::uuid
ORDER BY created_at ASC, id ASC
LIMIT 50;

\echo ''
\echo '→ Creating lab index: lab_chat_messages_conv_created_id_idx...'
CREATE INDEX lab_chat_messages_conv_created_id_idx ON chat_messages (conversation_id, created_at, id);
ANALYZE chat_messages;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, role, content, created_at
FROM chat_messages
WHERE conversation_id = :'fixture_conversation_uuid'::uuid
ORDER BY created_at ASC, id ASC
LIMIT 50;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_chat_messages_conv_created_id_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 3: Latest conversations for user (chat_conversations)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 3: Latest conversations for user'
\echo '============================================================================'
\echo 'Query shape: SELECT id, title, created_at FROM chat_conversations'
\echo '             WHERE user_id = ?'
\echo '             ORDER BY created_at DESC LIMIT 50;'
\echo ''
\echo 'Candidate index: chat_conversations(user_id, created_at, id)'
\echo ''

\echo '--- BEFORE: Baseline EXPLAIN (no lab index) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, created_at
FROM chat_conversations
WHERE user_id = :'fixture_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 50;

\echo ''
\echo '→ Creating lab index: lab_chat_conversations_user_created_id_idx...'
CREATE INDEX lab_chat_conversations_user_created_id_idx ON chat_conversations (user_id, created_at, id);
ANALYZE chat_conversations;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, created_at
FROM chat_conversations
WHERE user_id = :'fixture_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 50;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_chat_conversations_user_created_id_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 4: Writing submission history (writing_submissions)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 4: Writing submission history (paginated)'
\echo '============================================================================'
\echo 'Query shape: SELECT id, user_text, language, created_at FROM writing_submissions'
\echo '             WHERE user_id = ?'
\echo '             ORDER BY created_at DESC LIMIT 10 OFFSET 0;'
\echo ''
\echo 'Candidate index: writing_submissions(user_id, created_at, id)'
\echo ''

\echo '--- BEFORE: Baseline EXPLAIN (no lab index) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_text, language, created_at
FROM writing_submissions
WHERE user_id = :'fixture_writing_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;

\echo ''
\echo '→ Creating lab index: lab_writing_user_created_id_idx...'
CREATE INDEX lab_writing_user_created_id_idx ON writing_submissions (user_id, created_at, id);
ANALYZE writing_submissions;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, user_text, language, created_at
FROM writing_submissions
WHERE user_id = :'fixture_writing_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_writing_user_created_id_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 5: Speaking submission history (speaking_submissions)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 5: Speaking submission history (paginated)'
\echo '============================================================================'
\echo 'Query shape: SELECT id, topic, transcript, scores, language, level, created_at'
\echo '             FROM speaking_submissions WHERE user_id = ?'
\echo '             ORDER BY created_at DESC LIMIT 10 OFFSET 0;'
\echo ''
\echo 'Candidate index: speaking_submissions(user_id, created_at, id)'
\echo ''

\echo '--- BEFORE: Baseline EXPLAIN (no lab index) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, topic, transcript, scores, language, level, created_at
FROM speaking_submissions
WHERE user_id = :'fixture_speaking_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;

\echo ''
\echo '→ Creating lab index: lab_speaking_user_created_id_idx...'
CREATE INDEX lab_speaking_user_created_id_idx ON speaking_submissions (user_id, created_at, id);
ANALYZE speaking_submissions;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, topic, transcript, scores, language, level, created_at
FROM speaking_submissions
WHERE user_id = :'fixture_speaking_user_uuid'::uuid
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_speaking_user_created_id_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 6: Token transaction ledger (token_transactions)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 6: Token transaction ledger'
\echo '============================================================================'
\echo 'Query shape: SELECT id, amount, type, feature, balance_after, created_at'
\echo '             FROM token_transactions WHERE user_id = ?'
\echo '             ORDER BY created_at DESC;'
\echo ''
\echo 'Note: token_transactions already has (user_id, created_at) index.'
\echo '      This benchmark verifies the existing index is effective.'
\echo ''

\echo '--- EXPLAIN with existing index (no lab index needed) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount, type, feature, balance_after, created_at
FROM token_transactions
WHERE user_id = :'fixture_token_user_uuid'::uuid
ORDER BY created_at DESC;

\echo ''
\echo '→ Creating lab index with id tie-breaker: lab_token_user_created_idx...'
CREATE INDEX lab_token_user_created_idx ON token_transactions (user_id, created_at, id);
ANALYZE token_transactions;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index (id tie-breaker) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount, type, feature, balance_after, created_at
FROM token_transactions
WHERE user_id = :'fixture_token_user_uuid'::uuid
ORDER BY created_at DESC, id DESC;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_token_user_created_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- QUERY 7: Learning progress by user/language (learning_completions)
-- ============================================================================
\echo '============================================================================'
\echo 'QUERY 7: Learning progress by user/language'
\echo '============================================================================'
\echo 'Query shape: SELECT activity_type, activity_id, score, completed_at'
\echo '             FROM learning_completions'
\echo '             WHERE user_id = ? AND language = ?'
\echo '             ORDER BY completed_at DESC;'
\echo ''
\echo 'Note: learning_completions already has (user_id, language, completed_at) index.'
\echo '      This benchmark verifies the existing index is effective.'
\echo ''

\echo '--- EXPLAIN with existing index (no lab index needed) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT activity_type, activity_id, score, completed_at
FROM learning_completions
WHERE user_id = :'fixture_learning_user_uuid'::uuid
  AND language = :'fixture_learning_language'
ORDER BY completed_at DESC;

\echo ''
\echo '→ Creating lab index with id tie-breaker: lab_learning_user_lang_completed_idx...'
CREATE INDEX lab_learning_user_lang_completed_idx ON learning_completions (user_id, language, completed_at, id);
ANALYZE learning_completions;
\echo '✓ Index created and analyzed'
\echo ''

\echo '--- AFTER: EXPLAIN with lab index (id tie-breaker) ---'
EXPLAIN (ANALYZE, BUFFERS)
SELECT activity_type, activity_id, score, completed_at
FROM learning_completions
WHERE user_id = :'fixture_learning_user_uuid'::uuid
  AND language = :'fixture_learning_language'
ORDER BY completed_at DESC, id DESC;

\echo ''
\echo '→ Dropping lab index...'
DROP INDEX IF EXISTS lab_learning_user_lang_completed_idx;
\echo '✓ Dropped'
\echo ''

-- ============================================================================
-- FINAL CLEANUP: Ensure all lab_* indexes are dropped
-- ============================================================================
\echo '============================================================================'
\echo 'FINAL CLEANUP'
\echo '============================================================================'
\echo '→ Ensuring all lab_* indexes are dropped...'
DROP INDEX IF EXISTS lab_progress_user_due_idx;
DROP INDEX IF EXISTS lab_chat_messages_conv_created_id_idx;
DROP INDEX IF EXISTS lab_chat_conversations_user_created_id_idx;
DROP INDEX IF EXISTS lab_writing_user_created_id_idx;
DROP INDEX IF EXISTS lab_speaking_user_created_id_idx;
DROP INDEX IF EXISTS lab_token_user_created_idx;
DROP INDEX IF EXISTS lab_learning_user_lang_completed_idx;
\echo '✓ All lab indexes dropped'
\echo ''

-- ============================================================================
-- SUMMARY
-- ============================================================================
\echo '============================================================================'
\echo 'LAB COMPLETE'
\echo '============================================================================'
\echo ''
\echo 'Review the EXPLAIN output above for each query:'
\echo '  - Compare rows scanned, buffers hit/read, execution time'
\echo '  - Note plan shape changes (Seq Scan → Index Scan, etc.)'
\echo '  - Record before/after metrics in tests-manual/README.md'
\echo ''
\echo 'Next steps:'
\echo '  1. Populate test DB with 10k-1M rows across many users for realistic plans'
\echo '  2. Run ANALYZE on all tables before executing this script'
\echo '  3. Compare cold vs warm cache (run twice, second run is warm)'
\echo '  4. Document findings and decide which indexes to promote to production'
\echo ''
\echo '✓ Lab script finished successfully'
