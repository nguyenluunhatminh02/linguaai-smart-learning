# Migration job per release and compatibility rules (DB-05 / OPS-01 / OPS-02)

Status: authoritative runbook for **how a schema change is applied** in this
repository. Related policies: [`docs/migration-safety.md`](migration-safety.md)
for phase design and lock guardrails, [`docs/backup-restore.md`](backup-restore.md)
for backup/restore drills, and [`docs/runbooks.md`](runbooks.md) for incident
handling. This document records rules and evidence requirements; it does not by
itself certify that a release was executed correctly.

Roadmap source: `LinguaAI_Engineering_Roadmap.md` DB-05 lines 650–658 (one
migration job per release, expand → migrate/backfill → switch readers/writers →
contract, rollback-compatible schema, separate restore plan for destructive
changes), OPS-01 lines 869–891, OPS-02 lines 908–913, Definition of Done line
1175.

## CURRENT state at the time of writing

Verified from checked-in files, not from a live deployment:

- `docker/docker-compose.yml` already defines exactly one one-shot `migrate`
  service (`restart: "no"`, `entrypoint ["sh", "-c"]`, command
  `node_modules/.bin/prisma migrate deploy`). It has no seed step. `api` waits on
  `migrate` with `condition: service_completed_successfully`; `web` waits on
  `api`; `ai` waits on `redis`. Neither `api`, `web`, nor `ai` runs a migration.
- `docker/Dockerfile.api` ends with `CMD ["node", "dist/main.js"]`, i.e. the
  container image does not migrate.
- `apps/api/package.json` still declares
  `start:prod: "prisma migrate deploy && node dist/main"` (line 9). This is the
  known open violation: any replica started with `start:prod` outside Compose
  can run migrations concurrently. The same file declares `db:migrate` (dev),
  `db:migrate:prod` (operator deploy), and `db:seed` / `db:seed:bench` as
  explicit commands.
- `README.md` (line 78) and `SETUP.md` (line 230) still instruct operators to
  use `start:prod`, so the violation is reachable from documentation.
- `.github/workflows/ci.yml` currently runs lint/type-check/unit checks only;
  it has no migration-precheck job and no DB-backed migration test. There is no
  `scripts/check-migration-policy.mjs` in the repository.
- Installed tooling is Prisma 7.5.0 with `apps/api/prisma.config.ts`. Available
  CLI verbs include `prisma migrate deploy`, `prisma migrate status`,
  `prisma migrate resolve`, and `prisma migrate diff`. Do not copy commands from
  newer online documentation without verifying them against the installed CLI.
- `apps/api/prisma/migrations/20250104000000_clean_notification_type_enum/migration.sql`
  remaps legacy enum values to `SYSTEM`. It is therefore **not** safely
  reversible with a down script; it belongs to the backup/restore rollback
  class defined below.
- `docs/migration-safety.md` §2 already states the one-job rule; §9 lists the
  same out-of-scope fixes. This runbook is the operational counterpart: what the
  operator runs, checks, and records for each release.

## 1. Non-negotiable rules

1. **One release, one new migration directory, one migration job.** A release
   adds at most one new directory under `apps/api/prisma/migrations/`. It is
   applied once by the `migrate` job — `docker compose run --rm migrate` or the
   platform equivalent — and by nothing else.
2. **No replica migration.** No API replica, worker, sidecar, web process, or AI
   service applies schema changes at boot. Application start is
   `node dist/main.js` only. `start:prod` must not contain `migrate`; until it
   is fixed, operators must explicitly avoid it in production and record the
   deviation in the release ticket.
3. **Applied migrations are immutable.** Never edit a `migration.sql` in an
   applied directory, rename its directory, or delete/re-insert its
   `_prisma_migrations` row. That changes the checksum history. Corrections are
   new forward migrations in a later release.
4. **Compatibility in both directions during rollout.** New code must tolerate
   the old schema (it can start before/while the migration runs), and old code
   must tolerate the new schema (it must remain usable after a rollback to the
   previous app image). If either direction fails, the change is not safe to
   ship in that release.
5. **Expand → backfill → switch readers → switch writers → contract, across
   releases.** One phase per release. No destructive change in the same release
   as the code that requires it. See `docs/migration-safety.md` §1 for the
   per-phase allowed/forbidden change table and exit gates.
6. **App rollback is the default lever until contract.** The previous app image
   must remain schema-compatible with the migrated database. After a contract
   (drop/rename/removal), an app rollback alone is insufficient: the only
   rollback is a rehearsed restore from the pre-contract backup.
7. **Destructive changes require an explicit backup/restore plan.** A migration
   that drops or renames data, narrows a type, removes an enum value, changes a
   unique key, or rewrites historical values is destructive even if it is
   idempotent. It requires a tagged pre-migration backup, a verified restore
   drill into an isolated database, and named approval before release.
8. **Seed is a separate operator job.** `db:seed` / `db:seed:bench`
   (`ts-node --transpile-only prisma/seed.ts` / `prisma/seed-bench.ts`) are never
   part of `migrate` or of any replica start. Run them explicitly only on a
   disposable or intentionally seeded environment.
9. **No secrets in docs, logs, or evidence.** Never read, print, copy, or paste
   `.env` values, database URLs containing credentials, API keys, JWT secrets,
   `MFA_ENCRYPTION_KEY`, provider keys, or raw `docker compose config` output.
   Use variable **names** and status/exit codes only. Never run a migration from
   an untrusted PR job with production credentials.

## 2. Release checklist (operator)

### 2.1 Precheck — before touching the target database

- [ ] Record release identifier, commit SHA, phase name (expand / backfill /
      reader switch / writer switch / contract), and the app image digest that
      will be deployed.
- [ ] Compare the release branch against the release base ref: exactly **one**
      new migration directory. If the count is not 1, stop and split the change.
- [ ] Confirm no applied migration file or directory name changed in the diff.
- [ ] Confirm the chosen app image satisfies both compatibility directions
      (§1 rule 4) and that the previous image is still deployable at this phase.
- [ ] Set bounded migration session limits before applying: for example
      `lock_timeout = '2s'`, `statement_timeout = '5min'`,
      `idle_in_transaction_session_timeout = '60s'`; record the values used.
- [ ] Run the status and parity checks against the target DB using credentials
      from the operator environment (never from a committed file), and record
      exit codes only:

      ```bash
      pnpm --filter api db:migrate:status
      pnpm --filter api db:migrate:check
      ```

      Expected: status reports no pending/unapplied history drift (every applied
      migration is recorded, nothing unexpectedly pending or failed) and
      `db:migrate:check` exits `0`. A non-zero exit stops the release. Note that
      raw-SQL-only tables deliberately absent from `schema.prisma` (see
      `docs/database-inventory.md`) need the inventory-based parity check as
      well; a clean Prisma diff alone is not proof for them.
- [ ] For a destructive change: create a tagged pre-migration backup
      (`reason=pre-migration`, with the release SHA), verify its manifest, then
      restore it into an **independent** database and run the structural and
      business-sample checks from `docs/backup-restore.md` §6. Do not deploy
      without a verified, restorable backup. The
      `20250104000000_clean_notification_type_enum` remap is in this class.
- [ ] Record expected row counts and invariant checks for affected tables, and
      identify the rollback target image.

### 2.2 Apply — exactly once

- [ ] Run the single migration job once from the repository root:

      ```bash
      docker compose -f docker/docker-compose.yml run --rm migrate
      ```

      This is an **explicit operator action**, not a per-replica action. Do not
      add a second migration mechanism (init container, entrypoint hook,
      `start:prod`, manual `psql` DDL) alongside it.
- [ ] In the Compose startup path, the `migrate` service runs automatically as
      the one gated job and `api` waits for
      `service_completed_successfully`. Confirm the exit code without printing
      environment values:

      ```bash
      docker inspect --format '{{.State.ExitCode}}' linguaai-migrate
      ```

      Expected: `0`. A non-zero exit stops the release; see §3.
- [ ] Watch lock waits and long transactions during the run (for example
      `pg_stat_activity`). Abort on unexpected blocking queries rather than
      waiting indefinitely.
- [ ] Do not seed in this step. `docker compose run --rm migrate` applies
      schema history only.

### 2.3 Verify — before routing traffic

- [ ] Re-run both checks from §2.1 and record their exit codes:

      ```bash
      pnpm --filter api db:migrate:status
      pnpm --filter api db:migrate:check
      ```
- [ ] Re-run the same migration job a second time on the same database and
      confirm it applies nothing new and exits `0` (idempotency proof). Do not
      treat a second "applied" line as success.
- [ ] Compare affected row counts/invariants with the recorded precheck values.
- [ ] Smoke the API liveness/readiness and one representative read per domain,
      using status-only output (`curl -sS -o /dev/null -w '%{http_code}\n' ...`).
      Expected: `200` for liveness and readiness on a healthy stack; `503` from
      readiness is expected only when a mandatory dependency was deliberately
      stopped on a test stack (see `docker/README.md`).
- [ ] Only then route traffic to the new app image. Keep the previous image
      available for rollback until the next release.

### 2.4 Release record — evidence to attach

Record, with no secret values: release SHA and phase; the single new migration
directory name; precheck status/parity exit codes; backup manifest id and
verified drill result (for destructive changes); lock/statement timeout values;
migration job exit code; idempotent re-run result; status/parity exit codes after
apply; smoke status codes; rollback target image; approver names and UTC times.
If a gate was not executed, write `NOT RUN` — never infer a pass.

## 3. Failure handling

- **Do not guess and do not delete history.** Re-run `db:migrate:status` first;
  it is read-only and tells you which migration is pending, failed, or missing.
- **A failed expand migration** (additive, no data rewrite) may be retried with
  the same one-shot job after the cause is fixed. Keep the migration file
  unchanged.
- **A partially applied history** requires human diagnosis from the status
  output plus the operator ticket. `prisma migrate resolve` is permitted **only
  after that diagnosis and an explicit decision**, because it marks a migration
  as applied or rolled back without running its SQL. Never use it to "make the
  check green", and never use it on an untrusted PR job or with production
  credentials from CI.
- **Backup/restore cases** (destructive or contract migration): follow
  `docs/backup-restore.md` §6. Restore only into an isolated database, with a
  ticket and second-person approval. Do not repair live rows by hand.
- **Validation failure after apply:** roll back the **app image** to the
  compatibility-approved previous version; leave the additive/schema state in
  place. Do not contract or hand-edit the schema as a rollback.
- **Backfill slow/locking:** pause batches, keep the durable marker, and resume;
  never cancel into an unmarked half state. Batch/resume rules are in
  `docs/migration-safety.md` §4.
- **Anything involving lost or rewritten data:** escalate to the data owner;
  app rollback is not sufficient. Record the incident in `docs/runbooks.md`
  style (symptoms, checks, mitigation, recovery, owner) without user data or
  secrets.

## 4. Compatibility rules by phase

Each row is a **separate release**. Full allowed/forbidden lists are in
`docs/migration-safety.md` §1; this table is the operator-facing summary.

| Phase | Schema action | New code | Previous code after rollback | Rollback lever |
| --- | --- | --- | --- | --- |
| Expand (N) | Add nullable columns/tables/indexes/enum values; keep old path writable | Tolerates absence of new objects and old rows | Works unchanged | App image rollback |
| Backfill (N+1) | Batched, marker-based updates; no unbounded `UPDATE`, no invented history | Reads/writes both shapes while backfill runs | Still reads legacy representation | App image rollback; pause/resume batches |
| Switch readers (N+2) | No removals; old columns still written | Prefers new shape behind an explicit gate; both shapes parse | Reads legacy shape correctly | Flip gate back, then app rollback |
| Switch writers (N+3) | No removals; dual-write kept in sync | Writes new and old representations atomically; disagreement is detected | Continues legacy writes/reads | App image rollback after reconciliation |
| Contract (N+4+) | Drop only objects no supported app version references | No reference to removed objects | Not a rollback target any more | Restore from pre-contract backup; app rollback alone is unsafe |

Worked examples for this repository (attempts/summary and raw vs normalized
scores) are in `docs/migration-safety.md` §6–7. They show why synthetic history
and inferred score scales are forbidden: unknown stays unknown and is marked.

## 5. Companion script contract (for the owning slice)

The runtime scripts below are the intended operator entry points. `start:prod`
must be `node dist/main` (or `node dist/main.js`) with **no** `prisma migrate`
prefix. `db:migrate:prod` remains the only deploy command; `db:migrate` is
dev-only. `db:seed` remains explicit.

| Script | Command | Use |
| --- | --- | --- |
| `db:migrate:status` | `prisma migrate status` | Read-only precheck/postcheck |
| `db:migrate:check` | `prisma migrate diff --exit-code --from-migrations prisma/migrations --to-schema prisma/schema.prisma` | Parity gate; exit `0` required |
| `db:migrate:prod` | `prisma migrate deploy` | The single operator migration command |
| `db:seed` | `ts-node --transpile-only prisma/seed.ts` | Separate operator job, never at boot |

These scripts are a **TARGET** for the `apps/api/package.json` owning slice; as
of this document they do not all exist. Until then, invoke the underlying Prisma
commands from `apps/api` (`pnpm --filter api exec prisma migrate status`, etc.)
with the same rules, and record the tooling gap in the release ticket. Do not
install packages or edit out-of-scope files to work around it.

CI enforcement (TARGET): a dependency-free policy checker should fail a PR when
more than one new migration directory appears relative to the release base ref,
when a runtime start command contains `migrate`, or when Compose loses the
one-shot `migrate` service or the `service_completed_successfully` gate. It
must use only disposable DB values and fake provider values — no production
database, real secrets, or live provider keys. `docs/ci-policy.md` §1 currently
describes an `integration` job with `prisma migrate deploy` on ephemeral
PostgreSQL 16; that is the right class of check but is not yet wired in
`.github/workflows/ci.yml`.

## 6. Definition of done for a migration release

- [ ] Exactly one new migration directory; no applied file changed.
- [ ] Exactly one migration job ran; no replica, worker, or sidecar migrated.
- [ ] Runtime start command contains no migration; seed remained a separate job.
- [ ] Phase named and isolated in its own release; both compatibility directions verified.
- [ ] Precheck, backup and (where required) restore drill recorded with exit codes/manifest id only.
- [ ] `prisma migrate status` clean; `prisma migrate diff --exit-code` = 0; idempotent re-run passed.
- [ ] Bounded lock/statement timeouts set; no unbounded transaction or unmonitored lock wait.
- [ ] Rollback matrix reviewed (`docs/migration-safety.md` §5); previous app image remains deployable, or a restore plan is approved for a contract.
- [ ] Evidence attached with no secrets, `.env` values, user data, or raw log/config dumps.
- [ ] Any unimplemented companion change is recorded as a blocker rather than silently assumed.
