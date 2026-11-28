# Sprint 4 — Database sprint report (DB sprint report)

**Status: source-evidenced implementation inventory; runtime verification NOT RUN.** This report separates what exists in code/SQL from what has been measured or executed. Code presence is not proof of correctness: following `docs/billing-call-sites.md:5-14` and `docs/baseline.md`, an unexecuted command is `NOT RUN`, and no number appears here unless it was actually captured. No `.env` value, credential, or API key was read or written.

## 1. Provenance and snapshot

| Field | Value |
|---|---|
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`) |
| Report timestamp (UTC) | `2026-11-28T03:27:49Z` (captured with `date -u +%Y-%m-%dT%H:%M:%SZ` before drafting) |
| Roadmap source | `LinguaAI_Engineering_Roadmap.md:558-658` (Sprint 4: DB-01…DB-05 and the sprint gate) |
| Methods used | Read-only source inspection (`grep`, file reads), `git rev-parse HEAD`, `git status --short`, `date -u`. No package manager, migration, database query, test suite, or build was run. |
| Working tree | Not clean (230 changed paths at collection time). Directly relevant: modified `apps/api/prisma/schema.prisma`; untracked `apps/api/prisma/migrations/20261129000000_db_invariants/`, `20261129001000_learning_attempts/`, `docs/benchmarks/`. This report does not claim the dirty tree is green or consistent. |
| Files changed by this slice | `docs/sprint4-report.md` only. No application code, schema, migration, or test was edited. |
| Neighbour evidence consulted | `docs/baseline.md`, `docs/database-inventory.md`, `docs/dependency-audit.md:85-106`, `docs/billing-call-sites.md:5-14`, `docs/backup-restore.md`, `docs/migration-safety.md`, `docs/benchmarks/due-cards.md`, `docs/benchmarks/chat-history.md`, `docs/benchmarks/history.md`, `docs/benchmarks/connection-budget.md` (all under the repo root). |

**Verdict legend**

| Verdict | Meaning |
|---|---|
| Implemented (source-evidenced) | Code or SQL exists at the cited path. No runtime assertion is implied. |
| Test declared | A test file declares scenarios; no test result is claimed. |
| NOT MEASURED / NOT RUN | No captured command output, exit code, or measurement exists for this slice. |
| Partial / risk | Implementation exists but a stated contract or consistency check is incomplete or contradictory. |

## 2. Implemented vs unmeasured — summary table

| Roadmap item | State | Evidence actually checked | What is unmeasured or missing |
|---|---|---|---|
| DB-01 schema/invariants | Implemented (source-evidenced) + Partial | Tracked schema at `apps/api/prisma/schema.prisma`; untracked invariant migration `apps/api/prisma/migrations/20261129000000_db_invariants/migration.sql:52-188` adds CHECK constraints with `NOT VALID` then `VALIDATE` | Migration never applied; preflight queries at `:24-49` never run; legacy rows never inspected; `docs/backup-restore.md:266` still describes ledger/balance invariants as application-only, contradicting the new CHECK migration; `docs/database-inventory.md` predates these constraints |
| DB-02 attempt history | Implemented (source-evidenced) + Test declared + risk | `schema.prisma:382-431` (summary fields, `learning_attempts`), untracked `20261129001000_learning_attempts/migration.sql:11-66`, `apps/api/src/learning/learning.service.ts:58-85`, `apps/api/src/learning/dto/learning-attempt.dto.ts:61-104`, `apps/api/src/learning/learning.service.spec.ts:578-819` | No test execution; no DB migrate/seed/duplicate/concurrency run; `is_legacy` exists in untracked SQL (`migration.sql:51`) but not in the dirty `schema.prisma` — schema/migration drift; raw SQL uses `DOUBLE PRECISION`/`VARCHAR` for score fields while the schema model uses `Int` |
| DB-03 score contract | Partial (source-evidenced) + Test declared | `apps/api/src/writing/dto/writing.dto.ts:21-27,74-89,192-234,299`; `apps/api/src/writing/writing.service.ts:38-127,269-323`; `apps/api/src/writing/writing.service.spec.ts:228-443`; `apps/api/src/learning/dto/learning-attempt.dto.ts:61-104` | No test run; `apps/api/src/writing/writing.controller.ts:155-161` still infers scale from raw magnitude (`rawScore <= 1 ? *100 : <=10 ? *10 : raw`), the exact ambiguity DB-03 forbids; no FastAPI `scoreScale`/`score_scale` field found in `apps/ai-service/app/models/schemas.py`; speaking/level-estimation contract not asserted; null/NaN/negative/overflow tests are declared but not executed here |
| DB-04 query profiling and indexes | NOT MEASURED (plans only) | `docs/benchmarks/due-cards.md:3`, `docs/benchmarks/chat-history.md:3`, `docs/benchmarks/history.md:5`, `docs/benchmarks/connection-budget.md:3` — all explicitly state no benchmark/DB access; candidate indexes written in untracked `20261129000000_db_invariants/migration.sql:196-214` | No `EXPLAIN (ANALYZE, BUFFERS)`, no 10k/100k/1M fixture, no before/after numbers, no index size/write overhead, no N+1 counts, no `SHOW max_connections;`; adding candidate indexes before measurement contradicts the plan in `due-cards.md:17` and `chat-history.md:3` |
| DB-05 backup/restore | Policy/runbook only, NOT VERIFIED | `docs/backup-restore.md:3-8,32-37,297-327` labels CLI, workflow, e2e drill, evidence log and RTO/RPO as TARGET; single migrator job is present in Compose per `docs/benchmarks/connection-budget.md:44-46` | No backup job execution, no restore drill, no manifest, no timing/RTO evidence; `docs/restore-drill-log.md` is a TARGET path, not created by this slice |
| Sprint gate (`roadmap:658`) | NOT MET | — | Scores not runtime-verified (and one legacy path still guesses scale); attempts not runtime-verified as duplicate-free; no before/after index numbers; no successful restore drill |

## 3. DB-01 — schema and invariants: detail

**Implemented (read-only evidence).** `apps/api/prisma/schema.prisma:660-718` contains `user_token_balance`, `token_transactions` (unique `idempotency_key`, `@@index([user_id, created_at])`), `ai_operations` (unique `(user_id, feature, client_operation_id)`, `@@index([status, lease_until])`, enum with `RESERVED/RUNNING/SUCCEEDED/FAILED/UNKNOWN/CANCELLED`) and `daily_credit_grants` neighbours. The untracked migration `20261129000000_db_invariants/migration.sql:53-188` adds and validates CHECKs for non-negative token balances, score ranges, SRS fields, quiz/placement ranges, skill confidence/counts, AI credit and attempt bounds, and grant amounts. Constraints are added `NOT VALID` before `VALIDATE` (`:52-57`); manual rollback SQL is documented at `:216-262`.

**Unmeasured / risk.** The preflight queries at `:24-49` are comments, not executed checks; `VALIDATE CONSTRAINT` will fail if legacy rows violate bounds. `docs/backup-restore.md:266` still states balance/ledger invariants are application-only — the newly written CHECK migration is not reflected there. No migration was applied, so none of these constraints is proven against a fixture database. Retention/PII, UTC UI conversion, empty vs populated migration tests, and account deletion behaviour were not exercised.

## 4. DB-02 — attempt history: detail

**Implemented (read-only evidence).** `schema.prisma:382-431` extends `learning_completions` with `first_completed_at`, `last_completed_at`, `attempt_count`, `best_score`, `latest_score`, `total_duration_seconds`, and adds `learning_attempts` with `content_version`, `client_attempt_id`, score fields, and `@@unique([user_id, client_attempt_id])`. The original unique key `(user_id, activity_type, activity_id)` is preserved; the schema comment at `:380-381` explains why `language` was not added (language scoping for activity IDs is unproven). The untracked SQL migration `:11-40` creates the raw table, unique key and history index; `:44-66` expands the summary and marks existing rows `is_legacy = true` with `attempt_count = 1` while inserting no fabricated attempts. `learning.service.ts:58-85` derives a deterministic UUID-shaped fallback key from user/activity/language/score/duration/request fields for callers that do not send `clientAttemptId`.

**Test declared, not executed.** `apps/api/src/learning/learning.service.spec.ts:578-819` declares low/high score accumulation, monotonic best, duplicate `clientAttemptId` no-op, out-of-order completion, concurrent distinct attempts (deferred barrier), same-key race, analytics failure handling and summary projection. These are Jest mock tests with an in-memory attempt store (`learning.service.spec.ts:337-453`), **not** a database test: they do not prove the PostgreSQL unique index, migration backfill, or cross-process concurrency. No `pnpm --filter api test` or e2e run was performed for this report.

**Risk.** The untracked migration adds `is_legacy` (`:51`), but the dirty `schema.prisma:382-405` does not declare it; `git show HEAD:apps/api/prisma/schema.prisma` shows the summary fields are also absent at HEAD. The raw migration types `raw_score`/`normalized_score` as `DOUBLE PRECISION`, `score_scale` as `VARCHAR(20)` and `feedback_ref` as `VARCHAR(160)`, whereas the schema model declares `Int`, `Int?` and `VARCHAR(255)`. Prisma-client reads of the raw table need explicit verification (or a documented raw-SQL contract) before claiming a working read path.

## 5. DB-03 — score contract: detail

**Implemented (read-only evidence).** `apps/api/src/writing/dto/writing.dto.ts:21-27,74-89,192-234` defines a `scoreScale` literal of `1|10|100`, requires `maxScore === scoreScale`, and documents `overallScore = round(score / maxScore * 100)`; `:299` implements that formula. `apps/api/src/writing/writing.service.ts:38-127` resolves the scale from explicit `scoreScale`/`maxScore` metadata or a labelled prompt default, records `scoreScaleSource`, and calls `normalizeScore`/`normalizeOptional` for feedback and history paths (`:269-323`). `apps/api/src/learning/dto/learning-attempt.dto.ts:61-104` applies the same explicit formula with scale validation. `apps/api/src/writing/writing.service.spec.ts:228-443` declares edge cases including 0.5/1, 8/10, 100/100, explicit scale precedence and prompt-default metadata.

**Unmeasured / not satisfied.** No test was run. `apps/api/src/writing/writing.controller.ts:155-164` still normalizes stored legacy `ai_feedback` by magnitude (`<= 1 → ×100`, `<= 10 → ×10`, otherwise unchanged), which is the ambiguity DB-03 (`roadmap:600-609`) calls out as confirmed wrong. The FastAPI response schema at `apps/ai-service/app/models/schemas.py` contains no `scoreScale`/`score_scale` field in the inspected matches; the provider contract cannot be claimed complete. Speaking and level estimation were not verified, and null/NaN/negative/overflow/legacy-migration outcomes were not executed.

## 6. DB-04 — profiling and connection budget: detail

**No measurements exist.** All four neighbour benchmark notes are plans: `docs/benchmarks/due-cards.md:3` ("PLAN ONLY"), `docs/benchmarks/chat-history.md:3` ("measurement plan, no results yet"), `docs/benchmarks/history.md:5` ("No EXPLAIN was executed"), `docs/benchmarks/connection-budget.md:3` ("No benchmark, load test, or database query was executed"). No `EXPLAIN`, seed, `ANALYZE`, p95, index-size, write-amplification, N+1, or `SHOW max_connections;` output is available; every such field is `NOT MEASURED`. The connection-budget example values at `connection-budget.md:69-99` are explicitly illustrative arithmetic on assumed inputs, not capacity results.

**Risk.** The untracked invariant migration already creates five candidate indexes (`20261129000000_db_invariants/migration.sql:196-214`) while `docs/benchmarks/due-cards.md:17` explicitly warns that an untracked migration containing a similar index is not evidence of measured benefit and must not be reused as baseline. Until an independently captured before/after run exists against the tracked migration set, these indexes are unproven additions, and the DB-04 "before/after with real numbers" gate cannot be met.

## 7. DB-05 — backup/restore and safe migration: detail

`docs/backup-restore.md:3-8` declares the document a policy/runbook only; the CLI (`scripts/backup-cli.mjs`), scheduled workflow, `apps/api/test/backup-restore.e2e-spec.ts`, and `docs/restore-drill-log.md` are TARGET deliverables (`:325-327`). RTO/RPO values at `:32-37` are proposals, not measurements; no drill evidence exists. The single migration job per release is observed in Compose (`docs/benchmarks/connection-budget.md:44-46`, `migrate` service with `restart: "no"` and API dependency on `service_completed_successfully`); that is a static config observation, not a verified deploy. Expand → migrate → switch → contract is described in the new attempt migration's rollback comments (`20261129001000_learning_attempts/migration.sql:68-81`) but no migration or rollback was executed.

## 8. Re-run protocol (do not inherit these conclusions)

1. Re-check `git rev-parse HEAD` and the dirty-file list; if Sprint 4 code or measurements changed after HEAD `3be6aa3`, re-derive this report rather than reusing its verdicts.
2. On a disposable, migrated and seeded PostgreSQL database only (never production or a shared dev DB), run the migration preflight queries from `20261129000000_db_invariants/migration.sql:24-49`, then apply the tracked migration set plus any new migration under review. Record exact command, UTC timestamp, exit code and first error, as in `docs/dependency-audit.md:85-106`.
3. Run the API unit/e2e suites and capture exit codes and counts. Resolve the `is_legacy` schema/migration drift and the raw-SQL vs Prisma type mismatch before claiming DB-02 complete.
4. Execute the lab plans in `docs/benchmarks/` with fixed-seed fixtures and capture verbatim `EXPLAIN (ANALYZE, BUFFERS)` before/after output, actual row counts, buffers, p95 with run count, index sizes, write overhead and `SHOW max_connections;`. Only then decide whether the candidate indexes stay.
5. Execute a restore drill per `docs/backup-restore.md:177-317`, record manifest id, timings, counts, exit codes and teardown in a real evidence log. Until then DB-05 remains NOT VERIFIED.
6. Fix or explicitly mark the magnitude-based normalization in `apps/api/src/writing/writing.controller.ts:155-161` as legacy-only with evidence, and prove the FastAPI score/scale contract, before treating DB-03 as green.
