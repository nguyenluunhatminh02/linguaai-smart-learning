# DB-16 benchmark history — query shape, candidate index, measurement plan

Append-only lab log for the DB-16 slice of roadmap item DB-04 ("Query profiling và index tuning", `LinguaAI_Engineering_Roadmap.md` lines 611–649). DB-16 is the workflow slice label; the roadmap itself names this work DB-04.

This entry records **query shapes and a measurement plan only**. No `EXPLAIN` was executed, no database was contacted, and no measurement number in this file is a result. Do not mark any query, index, or gate green until a later entry has appended real numbers with the provenance fields required in section 6.

## 1. Entry 000 provenance

| Field | Value |
|---|---|
| Entry ID | `000-plan` |
| Created | 2026-11-28 (workspace session date) |
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`) |
| Working tree at write time | Dirty. `apps/api/prisma/schema.prisma` modified by concurrent work; untracked `apps/api/prisma/migrations/20261129000000_db_invariants/` and `20261129001000_learning_attempts/`. `docs/benchmarks/` existed and was empty. |
| Roadmap source | `LinguaAI_Engineering_Roadmap.md` lines 611–649, read directly |
| Files touched by this entry | `docs/benchmarks/history.md` only |
| Environment read | Repository source only. No `.env` file, connection string, credential, or API key was read or printed. No package manager was run. |
| Database access | None. No lab DB URL was supplied; no DDL, seed, `ANALYZE`, or `EXPLAIN` was run. |
| Status | `PLANNED / NOT RUN` for every query and every candidate index |

Because the working tree was dirty and other agents were changing schema and migrations, every shape and index statement below is tied to the observed files at HEAD `3be6aa3`. Re-verify against the current tree before running the lab.

## 2. Observed index state at HEAD `3be6aa3`

Taken from `apps/api/prisma/schema.prisma` (dirty working-tree version read during this entry):

| Table | Existing indexes / keys relevant to this plan |
|---|---|
| `user_card_progress` | PK `id`; unique `(user_id, card_id)`; `@@index([user_id])`; `@@index([card_id])`; `@@index([next_review_date])` |
| `chat_messages` | PK `id`; `@@index([conversation_id])` |
| `chat_conversations` | PK `id`; `@@index([user_id])` |
| `writing_submissions` | PK `id`; `@@index([user_id])` |
| `speaking_submissions` | PK `id`; `@@index([user_id])`; `@@index([created_at])` |
| `token_transactions` | PK `id`; unique `idempotency_key`; `@@index([user_id, created_at])` |
| `learning_completions` | PK `id`; unique `(user_id, activity_type, activity_id)`; `@@index([user_id, language, completed_at])` |

Consequence to test, not assume: several history queries sort by `created_at` / `next_review_date` on a leading single-column index. The planner may filter first and sort afterwards. Only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the lab dataset can show whether that costs enough to justify a composite index.

## 3. Canonical query shapes (source-verified)

Parameters are lab placeholders; `PERF_USER`, `PERF_CONV`, `PERF_DECK` are deterministic fixture UUIDs supplied by the lab seeder, never production data. Statements are written to match the Prisma `where`, `orderBy`, `take`, and `select` clauses observed in source. A separate `apps/api/prisma/benchmark/queries.sql` is proposed in section 7 but is out of scope for this entry; the SQL below is the canonical reference until that file exists.

### Q1 — due flashcards for one user in one deck

Source: `apps/api/src/srs/srs.service.ts:30-48` (`getDueCards`), with the deck visibility guard at `:20-28`. Production `take` defaults to 20.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT p.card_id,
       p.next_review_date,
       p.ease_factor,
       p.interval_days,
       p.repetition_count,
       c.id            AS card_id_selected,
       c.deck_id,
       c.front_text,
       c.back_text,
       c.retired_at
FROM user_card_progress AS p
JOIN cards AS c ON c.id = p.card_id
JOIN decks AS d ON d.id = c.deck_id
WHERE p.user_id = 'PERF_USER'::uuid
  AND p.next_review_date <= $1::timestamp
  AND c.deck_id = 'PERF_DECK'::uuid
  AND c.retired_at IS NULL
  AND (d.creator_id = 'PERF_USER'::uuid OR d.is_public)
ORDER BY p.next_review_date ASC
LIMIT 20;
```

Related shapes that must be measured separately, not merged into Q1:

- `apps/api/src/recommendations/recommendations.service.ts:75-81` uses `findFirst` with `orderBy: [{ next_review_date: 'asc' }, { id: 'asc' }]` and a `decks` filter of `language` plus `OR: [{ is_public: true }, { creator_id: userId }]`. This is the tie-break-sensitive variant: `LIMIT 1`, ordered by `(next_review_date, id)`.
- `apps/api/src/recommendations/recommendations.service.ts:84-86` counts due cards by `user_id + deck_id`.
- `apps/api/src/srs/srs.service.ts:53-58` loads all learned `card_id` values for the user with **no limit** when filling the remaining slots; `apps/api/src/analytics/analytics.service.ts` counts due cards by `user_id + next_review_date`. These are unbounded/large-read shapes and are listed as limitations in section 6, not silently treated as Q1.

### Q2 — chat history for one conversation

Source: `apps/api/src/chat/chat.service.ts:223-235` (`loadHistory`), `MAX_HISTORY_MESSAGES = 50` at `:18`.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, role, content, created_at
FROM chat_messages
WHERE conversation_id = 'PERF_CONV'::uuid
ORDER BY created_at ASC, id ASC
LIMIT 50;
```

Variant to record: `apps/api/src/chat/chat.service.ts:454-464` (`getMessages`) orders by `created_at` only and has **no `take`**. It is an unbounded read and must be reported as such if measured.

### Q3 — recent conversations of one user

Source: `apps/api/src/chat/chat.service.ts:446-451`.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, user_id, title, created_at
FROM chat_conversations
WHERE user_id = 'PERF_USER'::uuid
ORDER BY created_at DESC
LIMIT 50;
```

Tie-break variant for the cursor test: `ORDER BY created_at DESC, id DESC`. Adding `id` changes the SQL relative to current Prisma code; the lab must run both and record which plan/result corresponds to which.

### Q4 — writing history

Source: `apps/api/src/writing/writing.service.ts:150-158` (`analyzeErrors`), `limit` defaults to 20. The code lowercases the **input value** (`language.toLowerCase()`), not the stored column.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, user_id, language, created_at, score, ai_feedback
FROM writing_submissions
WHERE user_id = 'PERF_USER'::uuid
  AND language = $1
ORDER BY created_at DESC
LIMIT 20;
```

`$1` is the already-lowercased string supplied by the caller. Do not replace this with `lower(language) = $1` in the canonical query: an expression index is justified **only** if a measured query actually uses the expression. Current production code does not. Tie-break/cursor variant: `ORDER BY created_at DESC, id DESC`.

### Q5 — speaking history with count

Source: `apps/api/src/speaking/speaking.service.ts:35-59`. Page size is clamped to 1–50; `skip = (page - 1) * take`. Prisma runs `findMany` and `count` in parallel.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, topic, transcript, feedback, scores, language, level,
       duration_sec, created_at
FROM speaking_submissions
WHERE user_id = 'PERF_USER'::uuid
ORDER BY created_at DESC
LIMIT 10 OFFSET 10;

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*)::bigint AS total
FROM speaking_submissions
WHERE user_id = 'PERF_USER'::uuid;
```

The lab must also run a deterministic-tie variant with `ORDER BY created_at DESC, id DESC` and a keyset cursor predicate `(created_at, id) < ($cursor_at, $cursor_id)` instead of `OFFSET`. Offset pagination with duplicate `created_at` values is a correctness risk; the candidate index includes `id` for that reason, not because current Prisma code orders by it.

### Q6 — token ledger for one user

Source: `apps/api/src/tokens/tokens.service.ts:762-767`. Note the absence of a `take`.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, amount, type, feature, balance_after, created_at
FROM token_transactions
WHERE user_id = 'PERF_USER'::uuid
ORDER BY created_at DESC;
```

Existing index: `(user_id, created_at)`. Do not propose a change without measured evidence that the unbounded read or a tie-breaker is the dominant cost. Pagination/cursor behavior of the API that consumes this result must be recorded with the measurement; no limit in the Prisma call means the index cannot bound work by itself.

### Q7 — learning completions for one user

Source: `apps/api/src/learning/learning.service.ts:140-152`; related unbounded export at `apps/api/src/users/users.service.ts:570`.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT activity_type, activity_id, language, completed_at,
       score, total, duration_seconds
FROM learning_completions
WHERE user_id = 'PERF_USER'::uuid
ORDER BY completed_at DESC;
```

Existing index: `(user_id, language, completed_at)`. Because this query has no `language` predicate, the lab must test whether the leading `user_id` alone is sufficient or whether a `(user_id, completed_at DESC, id DESC)` variant is needed. Recommendation reads at `apps/api/src/recommendations/recommendations.service.ts:105-108` do filter `user_id + activity_type + language`; record that shape separately before proposing any replacement.

## 4. Candidate indexes — hypotheses only, none applied

All DDL below is **lab-only**, executed in a disposable database behind an explicit marker check. No migration and no `@@index` change to `apps/api/prisma/schema.prisma` is authorized by this entry. Names are prefixed `lab_` so they can never be mistaken for production migrations.

| ID | Candidate | Why it is worth measuring | Lab DDL |
|---|---|---|---|
| C1 | `user_card_progress (user_id, next_review_date)` | Matches Q1 equality + range + order; today the planner must combine a `user_id` index with a separate `next_review_date` index or sort. | `CREATE INDEX lab_progress_user_due_idx ON user_card_progress (user_id, next_review_date);` |
| C1b | `user_card_progress (user_id, next_review_date, id)` | Same, with an explicit tie-break for the `findFirst` recommendation variant. Measure C1 and C1b separately; do not assume the extra key is free. | `CREATE INDEX lab_progress_user_due_id_idx ON user_card_progress (user_id, next_review_date, id);` |
| C2 | `chat_messages (conversation_id, created_at, id)` | Q2 orders by `(created_at, id)` with `LIMIT 50`; current index covers only `conversation_id`. | `CREATE INDEX lab_chat_messages_conv_created_idx ON chat_messages (conversation_id, created_at, id);` |
| C3 | `chat_conversations (user_id, created_at DESC, id)` | Q3 orders `created_at DESC` with `LIMIT 50`; current index covers only `user_id`. | `CREATE INDEX lab_chat_conversations_user_created_idx ON chat_conversations (user_id, created_at DESC, id);` |
| C4 | `writing_submissions (user_id, language, created_at DESC, id)` | Q4 filters `user_id + language`, orders `created_at DESC`, takes ≤20. | `CREATE INDEX lab_writing_user_lang_created_idx ON writing_submissions (user_id, language, created_at DESC, id);` |
| C4b | expression on `lower(language)` | Only if a future query is changed to use `lower(language)`. Current code lowercases the bound value, so this is **not** the canonical Q4 SQL. | `CREATE INDEX lab_writing_user_lang_lower_idx ON writing_submissions (user_id, lower(language), created_at DESC, id);` — measure only when the SQL matches. |
| C5 | `speaking_submissions (user_id, created_at DESC, id)` | Q5 filters `user_id`, orders `created_at DESC`, uses `skip/take`; current indexes are separate `user_id` and `created_at`. | `CREATE INDEX lab_speaking_user_created_idx ON speaking_submissions (user_id, created_at DESC, id);` |
| C6 | keep `(user_id, created_at)` on `token_transactions` | Q6 already has a matching composite index. A tie-breaker variant is not justified without data. | No DDL. Optional experiment only: `CREATE INDEX lab_token_user_created_id_idx ON token_transactions (user_id, created_at DESC, id);` |
| C7 | keep `(user_id, language, completed_at)` on `learning_completions` | Q7 has no `language` predicate; measure before changing an index that serves recommendation reads. | No DDL. Optional experiment only: `CREATE INDEX lab_completion_user_created_idx ON learning_completions (user_id, completed_at DESC, id);` |

Every created candidate is followed by `ANALYZE <table>;`, a post-change `EXPLAIN`, and then `DROP INDEX IF EXISTS <lab_index>;`. The baseline run is repeated after the drop to confirm the lab returned to its starting state.

## 5. Measurement plan

### 5.1 Safety preconditions

1. Use a disposable PostgreSQL database dedicated to this lab. Never point the runner at the default local test database or any environment-derived URL.
2. Require an explicit marker environment variable (proposed name `LAB_DB_CONFIRM_DISPOSABLE=1`) before any `CREATE INDEX`, `DROP INDEX`, `TRUNCATE`, or seed write. Read the lab connection string only from the lab runner's invocation, not from `.env`.
3. Record PostgreSQL version, image/build, Node version, Prisma CLI/client version, commit SHA, and working-tree cleanliness at the top of each appended result entry, following the provenance style of `docs/baseline.md`.
4. No package manager execution and no production connection are part of this entry.

### 5.2 Dataset

Proposed deterministic seeder (out of scope here, see section 7): fixed PRNG seed; scale steps of 10k, 100k, and 1M `user_card_progress` and `token_transactions` rows; rows spread across many users plus one deliberately hot user; a smaller number of chat, writing, speaking, and completion rows per user so each Q2–Q7 has enough pages to exercise ordering. Deliberately create duplicate `created_at` / `next_review_date` timestamps for cursor tests.

Planned configuration, not yet measured or asserted: due-card ratio target, users-per-scale, hot-user share, messages-per-conversation, and tie count. The seeder must assert fixed user/row counts, the due-card ratio, and the presence of timestamp ties at seed time. Record actual counts in the result entry; do not report the targets as observations.

### 5.3 Per-query procedure

For each of Q1–Q7, for each scale, and for each candidate in section 4:

1. Ensure the seed is complete and `ANALYZE` has run on seeded tables. Confirm no `lab_` index exists.
2. Run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` at least 5 times with warm cache; capture raw JSON.
3. Run a cold-ish sample after reconnecting and discarding cached plans/buffers where the lab permits it. Do not claim a true cold-cache result unless PostgreSQL cache and OS cache were actually reset and that mechanism is named in the entry.
4. Create one candidate index, `ANALYZE` the affected table, then repeat the warm and cold-ish samples with identical parameters.
5. Drop the lab index, re-run one baseline sample, and confirm the plan/row count matches the original baseline.
6. Compare identical result sets with and without the index, ordered by the full deterministic tuple used in the query. For cursor variants, insert concurrent rows with duplicate timestamps between pages and assert no row is skipped or repeated.
7. Report medians over ≥5 runs, not a single best run. If runs are highly variable, append all samples and say so.

### 5.4 Fields to capture per measurement

| Field | Meaning |
|---|---|
| Query ID / variant | Q1–Q7, plus `findFirst`, unbounded, or keyset variant where applicable |
| Commit SHA + dirty-file note | Exact code/schema state |
| PostgreSQL / driver versions | Runtime identity |
| Scale + actual row counts | Seeded dataset identity, not targets |
| Index state | `baseline`, `lab_<name>`, or `after-drop` |
| Plan node | e.g. `Index Scan` / `Index Only Scan` / `Seq Scan` + `Sort` / `Bitmap Heap Scan`, copied from JSON |
| Rows scanned vs rows returned | From plan node `Actual Rows` / `Rows Removed by Filter` and the statement's returned row count |
| Shared hit / read | `Shared Hit Blocks` / `Shared Read Blocks`, summed over plan nodes |
| Execution time | Median ms, cold-ish and warm, with run count |
| Index size | `pg_relation_size('lab_<name>')` plus human-readable copy |
| Write-overhead delta | Median insert/upsert time before vs after, with run count |
| Equivalence result | Identical rows yes/no; cursor stability yes/no |
| Raw evidence | Path or hash of captured JSON |
| Status | `NOT RUN` until real numbers exist; no green marker by default |

### 5.5 Write-overhead micro-measurements

For each candidate, measure before and after index creation with ≥5 repetitions each:

- `SrsService.reviewCard` upsert shape on `user_card_progress` (`apps/api/src/srs/srs.service.ts`) for C1/C1b.
- `chat_messages` insert shape from `persistTurn` (`apps/api/src/chat/chat.service.ts:243-265`) for C2.
- `token_transactions` ledger insert shape from `TokensService` for C6 (control case: no new index).
- Where practical, also time writing/speaking submission inserts for C4/C5, since those tables gain an index.

Record medians and the dataset scale. A read improvement is not an index decision until this delta is recorded.

### 5.6 Equivalence, N+1, and aggregate checks

- Use `PrismaService` with a separate lab DB URL and the `Pool` + `PrismaPg` connection pattern from `apps/api/test/setup.ts`. Do **not** call `seedTestDB()` — it `TRUNCATE`s `users`.
- Enable Prisma query metrics / event logging in the lab only. Count statements per request path; no query parameter values from production are logged. Compare counts with and without candidate indexes to detect N+1 regressions.
- `SrsService.getStats`, `getForecast`, `getRetentionDashboard` (`apps/api/src/srs/srs.service.ts:316`, `:373`, `:409`) load all user progress rows into JavaScript. Indexes cannot fix that shape; record a separate SQL-pushdown experiment before/after as its own entry, and do not attribute any change to C1/C1b.
- Check the connection budget (pool per process × processes + workers + migration/admin) against the lab DB limit with headroom. This is a reported observation, not a reason to add an index.

### 5.7 Provisional decision rule

No index is promoted to a migration from this plan alone. A later entry must show, on at least the 100k scale and for the same query shape:

- a material median execution-time reduction and/or a material reduction in shared reads/rows scanned,
- no unexplained regression in the write-overhead delta,
- identical result rows and stable cursor behavior, and
- an explicit note of the synthetic-data limitation.

Thresholds for "material" are not asserted here; they must be written into the result entry before a promotion decision, with the numbers that justify them. Keep the existing `token_transactions` and `learning_completions` indexes unless the workload data disagrees.

## 6. Result rows — append only

Every future run appends a new entry with the section-1 provenance fields and one row per query/scale/index state. Nothing is measured yet:

| Entry | Query | Scale | Index state | Plan node | Rows scanned / returned | Shared hit / read | Median cold-ish | Median warm | Index size | Write delta | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Q1 due cards | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q2 chat history | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q3 conversations | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q4 writing history | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q5 speaking history | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q6 token ledger | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |
| — | Q7 learning completions | 10k / 100k / 1M | — | NOT RUN | — / — | — / — | — | — | — | — | NOT RUN |

`—` means no data, not zero. Do not replace it with an estimate.

### Known limitations of this entry

- No lab database, seeder, runner, or `EXPLAIN` result exists yet.
- Dataset is synthetic; distribution is a hypothesis, not observed production traffic.
- Several production reads are unbounded (Q6, Q7, `getMessages`, learned-card ID load). An index cannot bound their work without a query change.
- Aggregates in `SrsService` and analytics are computed in JavaScript; see section 5.6.
- Current Prisma `orderBy` clauses do not always include an `id` tie-break. Cursor variants are extra SQL, not a claim about existing endpoints.
- Schema and migrations were being edited concurrently; re-read the current tree before acting on any SQL or index name here.
- Connection budget was not measured.
- This log must not be used as evidence that DB-04's sprint gate is met; the roadmap requires real before/after numbers.

## 7. Out-of-scope work recorded as blockers

The computed task listed additional files, but the assigned edit scope for this entry is `docs/benchmarks/history.md` only. None of the following was created or modified; they are required before measurements can be appended:

1. `apps/api/prisma/benchmark/seed-benchmark.ts` — deterministic seeder with fixed PRNG, three scale steps, hot user, timestamp ties, and seed assertions.
2. `apps/api/prisma/benchmark/queries.sql` — canonical `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` statements for Q1–Q7, including the variants noted in section 3.
3. `apps/api/prisma/benchmark/run-benchmark.sh` — disposable-DB marker check, baseline → create index → `ANALYZE` → measure → drop loop, JSON capture, and append to this log.
4. `apps/api/prisma/migrations/<timestamp>_db04_query_indexes/migration.sql` plus matching `@@index` entries in `apps/api/prisma/schema.prisma` — only after evidence under section 5.7 justifies a specific candidate.
5. `apps/api/package.json` scripts `db:bench:seed` / `db:bench:run` — only once the runner exists.
6. `apps/api/test/db-index.e2e-spec.ts` — opt-in lab spec for row-equivalence and stable cursor pagination under concurrent inserts, using `apps/api/test/jest-e2e.json`.

No package manager was run, no DB was changed, and no commit was made.
