# Migration safety policy (DB-05 / OPS-01 / OPS-02)

Status: authoritative for schema changes in this repository. Last updated: roadmap slice
`db-22`. This document defines the required process; it does not by itself certify that
every item is implemented. Where code contradicts it, code must be brought into
compliance and the contradiction recorded in the release checklist.

Sources: `LinguaAI_Engineering_Roadmap.md` DB-05 (lines 650-658), DB-02 (lines 575-598),
DB-03 (lines 600-609), OPS-01 line 879, OPS-02 lines 908-913, Definition of Done line
1175; plus the current `docker/docker-compose.yml`, `docker/README.md`,
`apps/api/package.json` and applied Prisma migrations.

## 0. Non-negotiable rules

1. Schema evolution is **expand -> backfill -> switch readers -> switch writers ->
   contract**. No phase is skipped and no phase is merged into a destructive single
   release.
2. **Exactly one new migration directory per release**, applied by **exactly one
   migration job**. No application replica, worker, or sidecar runs migrations at
   boot.
3. Every migration has a precheck, a fresh backup, a tested restore, verification
   commands, and an explicit rollback matrix before it is deployed.
4. The application version being rolled back to must remain compatible with the
   schema at every step. A migration that requires an instantaneous app rollback is
   not safe.
5. Never edit an applied migration file or directory name; that changes the Prisma
   checksum history on databases that already applied it. Corrections are new
   forward migrations.
6. Legacy data is **marked**, never invented. Unknown score scale stays unknown;
   missing attempt history is not reconstructed.

## 1. Phase model

Each phase is a separate release (N, N+1, N+2, N+3). A phase may not ship in the same
release as a later phase unless the schema owner signs off in writing on the concrete
risk; removing that exception is preferred. This separation is what keeps the old app
working after a rollback at any boundary.

| Phase | Release | Allowed changes | Forbidden changes | Exit gate |
| --- | --- | --- | --- | --- |
| **Expand** | N | Add nullable columns with safe defaults, new tables, new indexes, new enum values, marker columns. Keep the old path fully readable and writable. | Dropping/renaming columns or tables, narrowing types, adding `NOT NULL` without a backfilled default, removing enum values, changing a unique key in place. | Old app and new app both run against the expanded schema; `prisma migrate status` and schema parity check pass. |
| **Backfill / migrate** | N+1 | Batched, resumable updates keyed by a durable marker; one bounded batch size; verified counts; legacy/unknown markers where provenance is absent. | Unbounded `UPDATE`, fabricated history, guessed score scale, silent data repair, holding a long transaction or table lock. | Backfill reaches a steady state; batch cursor/marker recorded; verification query passes; no lock incidents. |
| **Switch readers** | N+2 | Readers prefer the new columns/tables; old columns still written and kept in sync. Feature/compatibility gate explicit in config or code. | Dropping old columns, stopping legacy writes, switching writers yet. | Both read paths agree on sampled rows; analytics and export agree with API readers; rollback to N+1 app is safe. |
| **Switch writers** | N+3 | Writers write new and old representations in one transaction; dual-write disagreement detected and alerted; then old-only writes disabled after observation. | Deleting the old representation in the same release as the writer switch. | Dual-write checks clean over a full observation window; rollback to N+2 app is safe. |
| **Contract** | N+4 or later | Drop columns/tables/enum values that no supported app version references. | Contracting while any deployed or rollback-target app still references the object. | Release notes state the minimum app version; restore plan exists because a contract is not reversible by app rollback. |

Contract is deliberately a *later* release: it must be possible to prove from deployed
versions and the rollback matrix that no old app references the object. A destructive
migration needs a restore plan, not a down migration.

### Compatibility gates between phases

- Reader switch gate: a flag/config value selects the new reader; both shapes parse.
- Writer switch gate: dual-write is on, disagreement counter is zero, and the old app
  still reads the legacy representation correctly.
- Contract gate: all deployed replicas are at or above the version that stopped
  reading the legacy object, and the previous release is no longer a rollback target.

## 2. One migration directory, one migration job

- The release contains **one** new directory under `apps/api/prisma/migrations/`
  (normally one `migration.sql`). Multiple new directories in one release, or a PR
  that introduces more than one, are a policy failure: compare the change against the
  release base ref and fail when the count exceeds one.
- A single job applies it: `docker compose run --rm migrate` (or the equivalent
  platform job). It is operator-only and one-shot. Compose already expresses this:
  the `migrate` service has `restart: "no"` and `api` depends on it with
  `condition: service_completed_successfully` (`docker/docker-compose.yml` lines
  43-65 and 98-105). Keep that wiring; do not reintroduce migrations into replicas.
- `apps/api/package.json` must keep `db:migrate` for local development and
  `db:migrate:prod` as the explicit operator entry point. The runtime start command
  must not migrate. `start:prod` currently still runs
  `prisma migrate deploy && node dist/main`; that is a known violation to fix in the
  owning slice, and `Dockerfile.api` / compose must start the app with
  `node dist/main.js` only.
- CI must enforce the same rule mechanically (a dependency-free checker is the
  proposed `scripts/check-migration-policy.mjs`, driven by
  `.github/workflows/ci.yml`). It must fail when a runtime start command contains
  `migrate`, when more than one new migration directory appears relative to the base
  ref, or when compose loses the one-shot `migrate` service or the
  `service_completed_successfully` gate. CI uses only disposable database values and
  fake provider values; no production database, real secrets, or live provider keys.

## 3. Precheck, backup, restore drill

Before applying any migration to a real environment:

1. **Precheck.** Confirm one new migration directory; confirm no applied file changed;
   confirm the app image is the compatibility-approved version; confirm the code
   supports both old and new shapes at this phase; run `prisma migrate status` against
   the target database and require no pending history drift; run the schema parity
   check below. Record expected row counts and constraint checks for affected tables.
2. **Backup.** Take an encrypted backup with retention and access control, stored off
   the primary host. Note its identifier and the recovery target time in the release
   record. Do not deploy without a restorable backup.
3. **Restore drill.** Restore the backup into an **independent** test database (never
   the live one). Verify constraints, sample counts, and representative business
   queries (attempt insert, summary read, analytics read, score read). For destructive
   migrations, rehearse the restore-based rollback end to end before release.
4. **Apply.** Run the single migration job once. Watch locks and long transactions.
5. **Verify.** Re-run status/parity checks, run idempotent re-application, smoke the
   API and read endpoints, and only then route traffic.

Required verification commands (names only; values come from the environment, never
from committed secrets):

```bash
prisma migrate status
prisma migrate deploy                 # idempotent second run must succeed and apply nothing
prisma migrate diff \
  --from-migrations apps/api/prisma/migrations \
  --to-schema-datamodel apps/api/prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```

`--exit-code` must be `0`: the migration history and `schema.prisma` must agree. Run
the same checks on a clean ephemeral database in CI, then re-run `migrate deploy` to
prove idempotency. Note that raw-SQL-only tables deliberately absent from
`schema.prisma` need explicit inventory-based parity checks instead of relying on the
generated client alone.

## 4. Lock and statement timeout guardrails

- Every migration session sets bounded limits, for example `lock_timeout = '2s'`,
  `statement_timeout = '5min'`, and
  `idle_in_transaction_session_timeout = '60s'`; tune per environment and record the
  values. A migration that exceeds them fails fast rather than blocking traffic.
- DDL that needs an `ACCESS EXCLUSIVE` lock is short and separately reviewed. Create
  indexes concurrently where the migration tooling allows it; if Prisma's migration
  transaction prevents `CONCURRENTLY`, move that step into the reviewed runbook and
  never bury it in a long transaction.
- Backfills are **batched and resumable**: update a bounded slice at a time (by key
  range or cursor), commit between batches, record progress in a durable marker, and
  support safe re-runs. A long backfill must not be an unbounded statement inside the
  DDL transaction.
- Monitor `pg_stat_activity` and lock waits during deployment; abort on unexpected
  blocking queries. Backpressure or replica lag pauses the migration, not the
  application's error budget.
- Dual-write disagreement, retry inflation, and out-of-order completion are monitored
  during the switch phases; the writer switch is blocked while any counter is nonzero.

## 5. Rollback matrix

| Failure point | Safe action | Unsafe action |
| --- | --- | --- |
| Precheck fails / backup missing | Stop release | Apply migration anyway |
| Migration fails during expand | Re-run the same one-shot job after fixing the cause; expand is additive and idempotent | Edit the applied migration file or rename its directory |
| Migration fails after some migrations applied | Reconcile with `prisma migrate status`, restore from backup only if history is inconsistent | Delete `_prisma_migrations` rows to "reset" |
| Validation fails after expand | Roll back the **app** to the previous image; expanded schema remains compatible | Contract the schema as the rollback step |
| Backfill slow/locking | Pause batches, keep marker, resume later | Cancel into a half-marked state without recording progress |
| Reader switch misbehaves | Flip the compatibility gate back to the old reader; old columns still exist and are maintained | Drop old columns |
| Writer switch misbehaves | Restore previous writer version; dual-write kept the legacy representation current | Assume the new representation is authoritative without reconciliation |
| Contract already applied | Restore from the pre-contract backup into a controlled environment and replay forward | Down migration or app rollback alone; dropped data is gone |
| Destructive migration required | Separate restore plan, rehearsed drill, explicit approval | Treat it as an ordinary reversible release |

Rule of thumb: **app rollback is the default lever until contract; restore is the only
lever after contract.**

## 6. DB-02 worked example — learning attempts and summary

Current shape: `learning_completions` keeps its identity/unique key
`(user_id, activity_type, activity_id)`; additive summary columns
`first_completed_at`, `last_completed_at`, `attempt_count`, `best_score`,
`latest_score`, `total_duration_seconds`, `is_legacy` were added by
`20261129001000_learning_attempts`. `learning_attempts` is append-only with
`UNIQUE(user_id, client_attempt_id)` so a retry of the same client intent does not
inflate `attempt_count` or re-credit XP.

- **Expand (N):** additive summary columns plus the new attempt table and indexes;
  the summary-only reader keeps working. No unique-key change: existing activity IDs
  are not proven language-scoped.
- **Backfill (N+1):** for summaries with `attempt_count = 0 AND is_legacy = false`,
  seed `first_completed_at`/`last_completed_at` from `completed_at`, and
  `best_score`/`latest_score` from the single stored `score`, while setting
  `is_legacy = true`. The guard makes the update a no-op on re-run. **Do not create
  synthetic `learning_attempts` rows for history that was never recorded.** Run the
  update in bounded batches with a durable marker.
- **Switch readers (N+2):** attempt history and analytics read `learning_attempts`;
  UI summary reads the new additive fields; legacy rows still display `is_legacy`
  explicitly. Old readers remain supported behind the gate.
- **Switch writers (N+3):** insert attempt and update summary atomically; increment
  `attempt_count` only for a new `client_attempt_id`, with `best_score`/`latest_score`
  rules defined; keep the legacy summary columns in sync during dual-write.
- **Contract (N+4+):** only after every deployed version has stopped reading the
  legacy-only summary columns, if any are to be removed. Never contract the
  `learning_completions` unique key in the same release as a language change.

Required known-issue follow-up (recorded, not fixed here): the applied migration
creates `learning_attempts.raw_score`/`normalized_score` as `DOUBLE PRECISION` and
`score_scale` as `VARCHAR(20)`, while `apps/api/prisma/schema.prisma` declares them as
`Int` and has no `is_legacy` model field. Reconcile this in a **new forward migration**
plus schema/client regeneration, with a parity check; do not edit the applied SQL or
silently coerce values. Until then, readers must tolerate both representations.

## 7. DB-03 worked example — raw and normalized Writing/Speaking score

Confirmed defect (roadmap DB-03): Writing normalized in new feedback but multiplied
`rawScore * 10` in history/detail; inferring scale from magnitude is ambiguous
(`1` could mean 1/10 or 1/1).

- **Contract at the boundary:** the FastAPI score response supplies `score`,
  `scoreScale` (or `maxScore`), and rubric/version; out-of-domain values are rejected.
- **Single normalization boundary:** `normalized = round(raw / max * 100)` on a
  0-100 scale. Never infer scale from `raw <= 1`. Store raw and normalized together
  for audit (`learning_attempts.raw_score`, `score_scale`, `normalized_score`) and make
  every read endpoint use the same contract.
- **Legacy rows:** if a prompt/schema version provides evidence, map the scale from
  that evidence; otherwise set `scoreScale = unknown` / review marker. Do not silently
  rewrite historical scores. Writing is a confirmed case; Speaking and level
  estimation require their own tests before claiming the same bug.
- **Rollout:** expand nullable audit columns (N); backfill with explicit unknown
  markers in batches (N+1); switch readers to normalized values while retaining raw
  (N+2); switch writers to the new score contract (N+3); contract only after all
  consumers have migrated. Test `0`, `1/10`, `1/1`, `8/10`, `100/100`, `null`, `NaN`,
  negative, overflow, and legacy migration rows.

## 8. Historical comment that is no longer authoritative

`apps/api/prisma/migrations/20250104000000_clean_notification_type_enum/migration.sql`
lines 12-13 say that blocking `prisma migrate deploy` blocks "the API container
startup, which runs migrate deploy before the app". That was a true observation when
written, but it describes the **old** startup behaviour and is now stale: the one-shot
`migrate` job is the only place that applies migrations, and the app start command must
not migrate. Do **not** edit that applied migration to fix the comment — doing so
changes its checksum. This policy supersedes the comment; the stale line is a known
documentation debt to be handled in a new, non-applied artifact or release note.

## 9. Definition of done for a migration release

- [ ] One new migration directory relative to the release base ref; no applied file edited.
- [ ] Phase named (expand / backfill / reader switch / writer switch / contract) and in its own release.
- [ ] App version at this phase is compatible with rollback to the previous app version.
- [ ] Precheck, encrypted backup, and restore drill recorded; restore verified on an independent DB.
- [ ] `prisma migrate status` clean; `prisma migrate diff --exit-code` returns 0; idempotent re-run passes.
- [ ] Backfill batched, resumable, marker-based; no fabricated attempts and no guessed score scale.
- [ ] Lock/statement timeout limits set and monitored; no unbounded transaction.
- [ ] Rollback matrix row for this phase reviewed; CI policy checks pass with disposable values only.
- [ ] Docs and API contracts updated with the source change.

### Open work outside this document's edit scope

These changes are required by this policy but are owned by other slices and are not
made by the `db-22` documentation edit:

- Change `apps/api/package.json` `start:prod` to `node dist/main` (keep
  `db:migrate:prod` operator-only and `db:migrate` for local development).
- Add the dependency-free policy checker at `scripts/check-migration-policy.mjs` and
  wire a migration-policy job into `.github/workflows/ci.yml` with an ephemeral
  PostgreSQL service.
- Add the one-migration-job-per-release and backup/precheck wording to
  `docker/README.md`, with a link to this document.
- Reconcile the DB-02 Prisma/SQL type and `is_legacy` mismatch via a new forward
  migration and regenerated client.
