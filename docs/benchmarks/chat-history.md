# DB-04 / DB-15 — chat history benchmark note

Status: **measurement plan, no results yet**. This note records the exact SQL shapes that the API currently emits, the candidate indexes from the roadmap, and the protocol that must be run before any index is added. It does not claim an index is beneficial, and it does not modify schema, migrations, or application code.

## 1. Provenance and scope

| Field | Value |
|---|---|
| Roadmap entry | `LinguaAI_Engineering_Roadmap.md` lines 611–623, DB-04 "Query profiling và index tuning"; DB-15 slice for this benchmark note |
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`) |
| Working tree | Dirty with concurrent agents' changes; `apps/api/src/chat/chat.service.ts` and `apps/api/prisma/schema.prisma` had non-index formatting/schema edits at collection time. Re-check before running measurements. |
| Sources read | `apps/api/src/chat/chat.service.ts`, `apps/api/src/chat/chat.controller.ts`, `apps/api/src/srs/srs.service.ts`, `apps/api/src/writing/writing.service.ts`, `apps/api/src/speaking/speaking.service.ts`, `apps/api/src/tokens/tokens.service.ts`, `apps/api/src/learning/learning.service.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20250101000000_baseline_init/migration.sql`, `docs/database-inventory.md`, `docs/baseline.md` (all under the repository root) |
| Environment | Not yet captured for a benchmark run. No `.env` file or secret value was read. The default e2e URL in `apps/api/test/chat-billing.e2e-spec.ts:116-117` is a local example; use a disposable DB via an injected `DATABASE_URL`, never a production or shared development database. |
| Tooling observed | Docker present; a container named `linguaai-journey-test` (`postgres:17-alpine`) was running, but no migration, seed, or benchmark was executed against it. `psql` was not found on `PATH`; container exec or another client must be chosen at run time. Do not run package managers as part of this documentation slice. |

The inventory document (section 3, item 4) already states that the index candidates are unproven and that DB-04 must benchmark before adding them. This note is the corresponding experiment design.

## 2. Query shapes emitted today

The SQL below is the Prisma-equivalent shape, not a hand-written application query. Parameter placeholders are shown as `$1`, `$2`, etc.; UUID literals are not implied. Line references are from the files at the HEAD above.

### Q1 — prompt history (bounded, key benchmark target)

Source: `apps/api/src/chat/chat.service.ts:223-236`, `loadHistory()`; called from `runTurn()` (lines 290-295) and `sendStream()` (lines 360-366). `MAX_HISTORY_MESSAGES = 50` at line 18.

```prisma
prisma.chat_messages.findMany({
  where: { conversation_id: conversationId },
  orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  take: 50,
  select: { role: true, content: true },
})
```

```sql
SELECT role, content
FROM chat_messages
WHERE conversation_id = $1
ORDER BY created_at ASC, id ASC
LIMIT 50;
```

This runs once per chat turn, before the provider call. It is the highest-leverage shape because a long conversation must return only the oldest 50 rows in stable order; an index on `(conversation_id)` alone must sort all rows of the conversation.

### Q2 — conversation ownership check (PK probe)

Source: `apps/api/src/chat/chat.service.ts:198-221` (`resolveOwnedConversation`) and `apps/api/src/chat/chat.controller.ts:432-444` (controller-side pre-debit check).

```prisma
prisma.chat_conversations.findFirst({
  where: { id: conversationId, user_id: userId },
  select: { id: true },
})
```

```sql
SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2 LIMIT 1;
```

The conversation `id` is the primary key, so this lookup should already be a single-row index scan. Included here only as a control: it should **not** justify the `(user_id, created_at, id)` candidate.

### Q3 — recent conversations list (bounded, no tie-breaker)

Source: `apps/api/src/chat/chat.service.ts:446-452`, `getConversations()`; endpoint `GET /chat/conversations` (`chat.controller.ts:742-746`). No cursor, skip, or tie-breaker is passed.

```prisma
prisma.chat_conversations.findMany({
  where: { user_id: userId },
  orderBy: { created_at: 'desc' },
  take: 50,
})
```

```sql
SELECT id, user_id, title, created_at
FROM chat_conversations
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

`created_at` is not unique, so equal timestamps can produce unstable page boundaries. The index candidate includes `id` as a tie-breaker; whether the application query should also add `id` is a separate decision to be justified by observed duplicates/pagination instability, not silently changed by an index.

### Q4 — full message history read (unbounded, no tie-breaker)

Source: `apps/api/src/chat/chat.service.ts:454-464`, `getMessages()`; endpoint `GET /chat/conversations/:id/messages` (`chat.controller.ts:748-755`). The ownership check (Q2) runs first.

```prisma
prisma.chat_messages.findMany({
  where: { conversation_id: conversationId },
  orderBy: { created_at: 'asc' },
})
```

```sql
SELECT id, conversation_id, role, content, created_at
FROM chat_messages
WHERE conversation_id = $1
ORDER BY created_at ASC;
```

No `take`, `skip`, `cursor`, or `id` tie-breaker. This is the endpoint that most needs a future cursor-pagination contract; a composite index can make the ordered scan cheaper, but it cannot make an unbounded response bounded. Measure row count and response size alongside latency.

### Q5 — turn persistence (write path, transaction)

Source: `apps/api/src/chat/chat.service.ts:243-270`, `persistTurn()`.

```sql
BEGIN;
INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING id;
INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, 'assistant', $3) RETURNING id;
COMMIT;
```

Every added index costs two inserts per turn. Record `INSERT` latency and index write amplification before accepting any candidate; a read win on Q1/Q4 is not sufficient by itself.

### Q6 — adjacent shapes included for comparison, not for this note's change set

| Shape | Source | SQL summary | Existing index |
|---|---|---|---|
| Due cards | `apps/api/src/srs/srs.service.ts:34-48` | `SELECT ... FROM user_card_progress WHERE user_id = $1 AND next_review_date <= $2 ... ORDER BY next_review_date ASC LIMIT $3` with `cards`/`decks` joins | `user_id`, `next_review_date`, unique `(user_id, card_id)`; no composite `(user_id, next_review_date)` |
| Learned IDs + new cards | `apps/api/src/srs/srs.service.ts:50-69` | `SELECT card_id FROM user_card_progress WHERE user_id = $1`, then `SELECT ... FROM cards WHERE deck_id = $2 AND retired_at IS NULL AND id NOT IN (...)` | `user_id`, `deck_id` |
| SRS stats/forecast/retention | `apps/api/src/srs/srs.service.ts:315-419` | Full per-user `user_card_progress` read with joins, aggregated in JS | Same as due cards; `quality_history` is JSONB and is parsed in app code |
| Writing history | `apps/api/src/writing/writing.service.ts:100-108`, `187-197` | `WHERE user_id = $1 [AND language = $2] ORDER BY created_at DESC LIMIT/SKIP` + `count` | `user_id` only |
| Speaking history | `apps/api/src/speaking/speaking.service.ts:38-46` | `WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3` + `count` | `user_id`, `created_at` (separate indexes) |
| Token ledger | `apps/api/src/tokens/tokens.service.ts:762-767` | `WHERE user_id = $1 ORDER BY created_at DESC` (unbounded) | `(user_id, created_at)` already present |
| Learning progress | `apps/api/src/learning/learning.service.ts:140-146` | `WHERE user_id = $1 ORDER BY completed_at DESC` | `(user_id, language, completed_at)` present; no `language` filter in this query |

These are recorded so the benchmark can include a control group. This slice does not propose applying their candidate indexes; that belongs to separate DB-04 slices with their own measurements.

## 3. Current indexes (from schema and baseline migration)

| Table | Current indexes | Roadmap candidate | State |
|---|---|---|---|
| `chat_messages` | PK `id`; `chat_messages_conversation_id_idx` (`conversation_id`) | `(conversation_id, created_at, id)` | **Lab-only**, not applied |
| `chat_conversations` | PK `id`; `chat_conversations_user_id_idx` (`user_id`) | `(user_id, created_at, id)` | **Lab-only**, not applied |
| `user_card_progress` | PK `id`; unique `(user_id, card_id)`; `user_id`, `card_id`, `next_review_date` | `(user_id, next_review_date)` | **Lab-only**, not applied |
| `writing_submissions` | PK `id`; `user_id` | `(user_id, created_at, id)` (+ language only if filtered) | **Lab-only**, not applied |
| `speaking_submissions` | PK `id`; `user_id`, `created_at` | `(user_id, created_at, id)` | **Lab-only**, not applied |
| `token_transactions` | PK `id`; `(user_id, created_at)`; unique + non-unique `idempotency_key` | Measure tie-breaker/type need | No new index proposed |
| `learning_completions` | PK `id`; unique `(user_id, activity_type, activity_id)`; `(user_id, language, completed_at)` | Measure real workload | No new index proposed |

Index names are not yet chosen for candidates; if a migration is later accepted, use explicit names consistent with the existing convention, for example `chat_messages_conversation_id_created_at_id_idx` and `chat_conversations_user_id_created_at_id_idx`, and update `schema.prisma` in the same change. A candidate index may replace, not duplicate, a prefix-covered single-column index only after verifying that no other query needs the narrower index.

## 4. Measurement plan

### 4.1 Environment record (fill at run time; no secrets)

Record in the results table: git SHA, branch and whether the tree is clean; Node version; PostgreSQL server version (`SHOW server_version;`); Prisma client version; container image/tag; dataset version/seed; `shared_buffers`, `work_mem`, `random_page_cost`, `enable_seqscan` (if changed); table and index sizes (`pg_total_relation_size`, `pg_relation_size`); row counts per table; and UTC timestamp of the run. Store only a redacted DB target such as `postgresql://<host>/<db>`; never record a password, token, or raw `.env` content.

### 4.2 Disposable dataset

Use a disposable PostgreSQL database with migrations from `apps/api/prisma/migrations` applied and the benchmark fixture seeded by an injected `DATABASE_URL`. Suggested seed sizes for the first run: 1 user + 50 conversations + 50,000 messages in one long conversation for Q1/Q4; 5,000 conversations for Q3; 10,000 `user_card_progress` rows for Q6. Use deterministic UUIDs and fixed timestamps (`2026-01-01T00:00:00Z` plus a fixed offset per row) so before/after runs are comparable. Include tied `created_at` values (at least two messages and two conversations with identical timestamps) to test tie-breaker stability. Include a second user with the same timestamp pattern as a control for partition pruning by user/conversation. Never run against production or a shared dev DB; reset the DB by recreation, not by deleting rows from a real dataset.

### 4.3 Protocol

1. **Baseline.** On the unmodified schema, run `VACUUM ANALYZE` on the seeded tables, then `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for Q1, Q2, Q3, Q4, Q5's two inserts, and the Q6 shapes. Use the same parameter values and `LIMIT`s for every repetition.
2. **Cold and warm.** Cold: first execution after `pg_dropbuffers` where available (or a fresh server/container); warm: three subsequent executions. Record planning time, execution time, rows, shared hit/read/dirty/twritten buffers, sort method, and whether a spill to disk occurred. Report medians of at least 5 warm runs and all cold runs; do not average a cold outlier into the warm median.
3. **Lab index pass.** In the disposable DB only, create the candidate indexes one at a time with `CREATE INDEX` (no `CONCURRENTLY` needed on a disposable DB; use `CONCURRENTLY` if adapting to a live DB). Re-run `ANALYZE` and the identical `EXPLAIN` set after each change. Capture the plan node types (`Index Scan`, `Index Only Scan`, `Bitmap Heap Scan`, `Seq Scan`, `Sort`, `Incremental Sort`) and the `Index Name` field, not just the timing.
4. **Empty-result and skew cases.** Repeat with a conversation that has no messages, a user with no conversations, a very large conversation (>10k messages) and a hot conversation that receives a write per second. Confirm the plan does not degrade for empty or tiny inputs.
5. **Write cost.** Re-run Q5's transaction with each candidate active; record insert latency and index size. A candidate that improves Q1 but adds disproportionate insert cost or index bloat must be rejected or narrowed.
6. **Selector decision.** Accept an index only if the before/after evidence shows all of: intended index used on the target shape; no regression on Q2/Q6 controls; acceptable insert cost; and a stable plan across cold/warm and small/large datasets. If the plan still chooses a seq scan for a small dataset, record that as expected and do not treat it as a failure; if it chooses a seq scan on a large dataset with high selectivity, treat it as a reason to reject or revise the candidate. Restore the disposable DB between candidate comparisons when plans interfere.
7. **Documentation of outcome.** Add a results section below with actual numbers and the chosen index names, or explicitly record "no index applied" with the measured reasons. Only then may a migration be authored in a follow-up slice.

### 4.4 Suggested result table (fill after running)

| Query | Candidate | Before plan / median ms / buffers | After plan / median ms / buffers | Cold before/after | Insert-cost delta | Decision |
|---|---|---|---|---|---|---|
| Q1 | `chat_messages(conversation_id, created_at, id)` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | PENDING |
| Q3 | `chat_conversations(user_id, created_at, id)` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | PENDING |
| Q4 | same as Q1 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | PENDING |
| Q6 control | none / `(user_id, next_review_date)` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | PENDING |

## 5. Risks and out-of-scope changes

- **No pagination contract for messages.** Q4 is unbounded and has no `id` tie-breaker. An index cannot fix the response size or duplicate/missing rows on equal `created_at`. A controller/DTO change to accept cursor/limit is a separate API slice; do not make it here.
- **Conversation list tie-breaker.** Q3 orders only by `created_at DESC`. Adding `id` to the index does not add deterministic ordering to the query; that requires an explicit `orderBy` change in `chat.service.ts`, out of scope for this documentation slice.
- **Generated Prisma client.** The inventory notes drift between `schema.prisma`, migrations and `src/generated/prisma`. If a candidate is accepted later, regenerate the client in the same slice as the schema/migration change and verify the generated indexes match.
- **Environment limits.** `psql` was not on `PATH`; `docker exec` into the disposable PostgreSQL container is one viable path, but no DB access, migration, or benchmark was performed in this slice. All result fields remain `NOT RUN` until an operator executes the plan.
- **Concurrency.** Other agents were editing API and schema files during collection; any line number or working-tree observation here can go stale. Re-verify before quoting this note as current evidence.
- **No secrets.** No `.env` file was read, printed or written; connection strings in results must be redacted to host/database only.
