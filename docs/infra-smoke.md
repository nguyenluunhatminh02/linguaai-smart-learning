# Infrastructure smoke checklist (TEST-14 / OPS-01 / DB-05)

Executable PASS/FAIL checklist for a **clean-environment** infrastructure smoke test: Docker
build, startup/readiness, migration, dependency failure injection, and backup/restore. Scope
anchors in `LinguaAI_Engineering_Roadmap.md`: TEST-14 (line 833, "Smoke test từ clean env"),
OPS-01 (lines 869–891, Compose correctness and readiness policy), OPS-02 / CI policy
(lines 907–913, fake values, protected environment, migration precheck, no untrusted PR
migrations), and DB-05 (lines 650–658, backup/restore and safe migration).

This document is the **checklist**, not a claim that automation exists. Configuration and
current contracts are in `docker/README.md`; detailed backup encryption, retention, and
restore invariants are in `docs/backup-restore.md`; migration expand/migrate/switch/rollback
policy is in `docs/migration-safety.md`. The CI job in `.github/workflows/ci.yml` is unit-only:
no image builds, readiness, migration, or restore jobs run there yet.

## Evidence and safety rules (apply to every section)

- Commands use placeholders `<...>` only. Replace them locally; never paste real values into
  this file, a log, a ticket, or an issue.
- **Never paste `docker compose config` output** (it contains interpolated secrets) and
  **never paste dump/backup file contents or a `.env` file** into logs, issues, or PRs.
  Evidence is status codes, exit codes, counts, timings, image IDs, and manifest IDs only.
- Run all drills on a **disposable stack**. Set a fresh `COMPOSE_PROJECT_NAME=<smoke-project>`
  so volumes are new; never use `down -v` against a production or shared stack.
- Use fake CI values (the ones already in `.github/workflows/ci.yml`) for tests. Real secrets
  belong in a protected GitHub environment or secret store, never in PR-triggered jobs.
- Record `PASS` / `FAIL`, duration, operator, and an evidence reference for every checkbox.
  A failed gate stops the drill; do not patch forward and mark it PASS.
- `curl -sS -o /dev/null -w '%{http_code}\n'` is enough for probe evidence: store the code,
  not response headers carrying internal details.

## A. Clean-environment prerequisites

| # | Check | Command / evidence | Pass condition |
|---|---|---|---|
| A1 | Toolchain | `docker version --format '<client>/<server>'`; `docker compose version` | Docker/Compose installed and server reachable; versions recorded in evidence. Runtime versions are pinned by the images (Node 22 / Python 3.12 / Postgres 16 / Redis 7), not by the host. |
| A2 | Compose syntax | `docker compose -f docker/docker-compose.yml config --quiet` | Exit `0` and **no output at all**; capture only the exit code. Any missing `${VAR:?...}` is a FAIL. |
| A3 | Env template | `docker/.env` exists, is gitignored, and contains placeholder/fake values only for this stack | `git check-ignore docker/.env` succeeds; no real key is read, printed, or committed. For a smoke stack, copy `.env.example` and replace every `<...>` with a fake value. |
| A4 | Empty volumes | `COMPOSE_PROJECT_NAME=<smoke-project>` unique; `docker volume ls` shows no pre-existing volumes for that project | Fresh project name forces empty `postgres_data` / `redis_data`; no production volume is selected. |
| A5 | Ports | Ports `3000/3001/8000/5432/6379` free on the host (or overridden in a smoke-specific compose override) | No bind conflict; loops below target `127.0.0.1`. |

## B. Build smoke

| # | Check | Command / evidence | Pass condition |
|---|---|---|---|
| B1 | Build all images | `docker compose -f docker/docker-compose.yml build api web ai migrate` | Exit `0` for `Dockerfile.api`, `Dockerfile.web`, `Dockerfile.ai`; image IDs/tags recorded. |
| B2 | Multi-stage | Inspect each `docker/Dockerfile.*`: `deps`/`builder` stages separate from `runner` | Final stage contains only runtime artifacts; build tools and source trees from builder stages are not copied wholesale. |
| B3 | Non-root runtime | `docker run --rm --entrypoint sh <image> -c 'id -u'` for each built app image | UID is non-zero (`appuser`/`nextjs`/`aiuser`, uid 1001). |
| B4 | Ignore rules | `docker build` context check: `.dockerignore` excludes `.env`, `.env.*`, `docs/`, `__pycache__`, `*.log` | No env file or docs directory present in the build context; `!.env.example` is the only exception and is not a secret. |
| B5 | Healthchecks present | `docker inspect --format '{{json .Config.Healthcheck}}' <image>` for api/ai | API probes `/api/health` (liveness), AI probes `/health`; intervals/retries as checked in. |
| B6 | Build-time public URL | Build `web` with `NEXT_PUBLIC_API_URL=<public-api-origin>/api/v1` as the build arg; search built client JS under `.next/static` for that value | Value appears in the **client bundle only**; no server-only secret (`JWT_*`, `MFA_ENCRYPTION_KEY`, `GROQ_API_KEY`, `AI_SERVICE_API_KEYS`) appears there. Changing the runtime env does not rewrite the inlined value — verify a rebuild is required. Record the observed boolean, not the secret values. |
| B7 | Migration image | `docker compose ... images migrate` uses the API image | One-shot job is built from the same image; no separate ad-hoc migration image. |

## C. Startup and migration smoke

| # | Check | Command / evidence | Pass condition |
|---|---|---|---|
| C1 | Start stack | `COMPOSE_PROJECT_NAME=<smoke-project> docker compose -f docker/docker-compose.yml up -d` | Exit `0`; all long-lived services start; `migrate` starts once. |
| C2 | Migration order | `docker compose ... ps -a --format json` / `docker inspect` on `api` | `migrate` has `service_completed_successfully` (exit `0`) **before** `api` becomes healthy; `postgres` and `redis` are healthy first. No API replica runs `prisma migrate deploy`. |
| C3 | Migration status | `docker compose ... exec -T api sh -c 'cd /app/apps/api && node_modules/.bin/prisma migrate status'` | Reports all checked-in migrations applied and no pending migrations; exit `0`. Compare against `apps/api/prisma/migrations`. |
| C4 | API liveness | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health` | `200` with `{"status":"ok"}` shape. Deliberately ignores dependencies. |
| C5 | API readiness | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/health/ready` | `200` with `status: ready`; body exposes only `status`, per-check `status`, `latencyMs`, `timestamp` — no connection strings, stack traces, or raw dependency errors. |
| C6 | AI liveness | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/health` | `200`. Note this probe does not check Redis; dependency ordering is enforced by compose. |
| C7 | Web | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/` | `200` from the Next.js standalone server (`node apps/web/server.js`), not a dev server. |
| C8 | Routes | Server routes use `INTERNAL_API_URL` / `CMS_BACKEND_URL`; browser gets `NEXT_PUBLIC_API_URL` | No Docker service hostname (`api:3001`) appears in client bundle; no `localhost` fallback is used for server-side fetch in the built image. |
| C9 | Volumes | `docker volume ls` filtered by `<smoke-project>` | `postgres_data` and `redis_data` are named and attached; API/web write no durable state to their own layers. Uploaded bytes remain a separate REL-04 concern. |
| C10 | Re-run idempotence | `docker compose ... run --rm migrate` a second time | Exit `0`, no pending migrations, no destructive re-application; deploy traffic remains unaffected. |

## D. Dependency-failure drill (disposable stack only)

Before each drill, record baseline codes: liveness `200`, readiness `200`, AI `200`.

| # | Check | Action | Pass condition |
|---|---|---|---|
| D1 | Redis down | `docker compose -f docker/docker-compose.yml stop redis` | `GET /api/health` stays `200`; `GET /api/health/ready` returns `503` with `status: degraded` and **no raw error text**. Redis is mandatory (limiter/queues). |
| D2 | Redis recovery | `docker compose ... start redis`; poll readiness | Returns `200` after Redis is healthy; one representative API request succeeds again; record recovery time. |
| D3 | Postgres down | `docker compose ... stop postgres` | Liveness still `200`; readiness `503` without raw connection-string/error detail. Accept the test-only side effect that the detached database may be unhealthy; never do this outside a disposable stack. |
| D4 | Postgres recovery | `docker compose ... start postgres`; poll readiness | Readiness `200`; `SELECT 1` via `docker compose ... exec -T postgres psql -U <user> -d <db> -c 'SELECT 1'` succeeds; one authenticated read (e.g. progress or token balance) succeeds. |
| D5 | No secret leakage | Search captured probe responses for `<password>`, key names, URLs with credentials | No match. Full causes stay in server-side logs; public probes expose status only. |

## E. Migration drill

| # | Check | Action | Pass condition |
|---|---|---|---|
| E1 | Empty DB | Fresh volumes, `migrate` then `api` | `prisma migrate deploy` exits `0` on an empty database; all migrations applied; API serves `200` readiness. |
| E2 | Fixture DB | Seed a representative fixture explicitly (for example `pnpm db:seed` outside compose, or a fixture import into the smoke DB) | Migrations remain idempotent; fixture rows survive; no replica auto-seeds on boot. |
| E3 | Backup before deploy | Capture a verified backup (section F) immediately before any destructive migration | Manifest id and verification recorded; no deploy proceeds without it. |
| E4 | One migration job | Inspect compose and CI/deploy plan; count migration invocations per release | Exactly one migration job per release; no PR/untrusted job runs production migrations; no replica migrates at boot. |
| E5 | Replicas | If scaling `api` in the smoke stack, check all replicas' startup logs | No replica runs migrations or seeds; all depend on the completed migrate job. |
| E6 | Rollback compatibility | Confirm rollback target image is compatible with the current schema (expand → migrate/backfill → switch → contract per `docs/migration-safety.md`) | Previous app image can start against post-migration schema; no down-migration is executed at rollback. |
| E7 | Destructive migration gate | For drops/renames/truncates/backfills, require E3 dump + E1/E2 re-run on isolated restore | Both PASS before the migration is allowed; deviations itemized with manifest id. |

## F. Backup / restore drill

Follows `docs/backup-restore.md` §3, §6, §8. All commands use placeholders; use an **isolated
restore stack** with a different compose project and non-default host ports. Never restore into
the running stack or a shared developer DB.

| # | Check | Command / evidence | Pass condition |
|---|---|---|---|
| F1 | Backup | `docker compose -f docker/docker-compose.yml exec -T postgres pg_dump -Fc --no-owner --no-privileges <db> > <private-dump-path>` | Custom-format dump created; exit `0`; dump is written to a private temporary location (tmpfs), never committed or pasted. |
| F2 | Off-host storage | Encrypt with the documented envelope scheme, upload to `<backup-bucket>/<prefix>`, record manifest id | Encrypted off-host object exists; manifest records size + SHA-256 of ciphertext; retention/access owner and Object Lock mode recorded; no private key on the DB host. |
| F3 | Verify | `node scripts/backup-cli.mjs verify --manifest-id <id>` (TARGET tooling per `docs/backup-restore.md`; until it exists, record manual digest/tag verification and mark tooling gap) | Manifest schema valid, digest and GCM tag verified; FAIL if verification is skipped. |
| F4 | Isolated target | Start a new compose project `<restore-project>` with fake keys, different port, empty DB; set `RESTORE_TARGET_DB=<isolated-db>` and `CONFIRM_RESTORE=<explicit-token>` | Target name is not a production name and is not the source host; no production volume is attached. |
| F5 | Import | `pg_restore --no-owner --no-privileges --exit-on-error` into the isolated DB | Exit `0`, no unhandled errors; migration state matches the repo. |
| F6 | Migration rows | `psql -v ON_ERROR_STOP=1` query of `_prisma_migrations` (names, `finished_at`, `rolled_back_at`) | Expected migration count equals observed applied count; rolled-back and unfinished counts are `0`. |
| F7 | Row counts | Compare source-at-backup vs restored counts for `users`, `decks`, `cards`, `user_card_progress`, `user_token_balance`, `token_transactions`, `ai_operations`, `daily_credit_grants`, `mfa_secrets` | Every pair is equal; include `chat_conversations`, `chat_messages`, `srs_review_events`, `audit_logs`, and `outbox_events` (or "table absent") from `docs/backup-restore.md` §6.3. |
| F8 | Constraints / invariants | `psql -v ON_ERROR_STOP=1` invariant query from `docs/backup-restore.md` §6.3 | All violation columns are `0`: orphan chat messages, orphan SRS users, duplicate progress, duplicate SRS IDs, negative balances, duplicate ledger keys, duplicate operations, overcharged operations, duplicate grants, duplicate MFA secrets. PK/FK/unique checks pass. Do not decrypt `mfa_secrets` values. |
| F9 | Business smoke | Point a disposable API at the isolated DB with fake keys; log in with a fixture user, read learning progress and token balance, check ledger/balance consistency | Reads succeed; balance equals ledger sum for the fixture; one operation returns its original hash/pricing/reservation from the fixture. No live provider is called. |
| F10 | Evidence | Fill the template from `docs/backup-restore.md` §8: operator, approver, ticket, manifest id, target, timings (fetch/verify/decrypt/restore/verify/teardown), measured RPO/RTO, counts, invariants, deviations, sign-off | Every field filled (`N/A` with reason where applicable); no secret values, PII, or dump contents in evidence. |
| F11 | Teardown | Drop isolated DB, remove plaintext temp files, revoke short-lived grants; `docker compose ... down -v` **only for `<restore-project>`** | No plaintext dump remains; production volumes untouched; evidence saved before teardown. |

A restore FAIL means the backup is not restorable and the DB-05 sprint gate is not met. Record
the manifest id, keep the failing target for investigation, and repeat from a fresh target.

## G. Teardown and reporting

| # | Check | Action | Pass condition |
|---|---|---|---|
| G1 | Disposable teardown | `COMPOSE_PROJECT_NAME=<smoke-project> docker compose -f docker/docker-compose.yml down -v` | Exit `0`; smoke volumes and network removed; no orphaned containers. |
| G2 | Production safety | `docker volume ls` / `docker ps` after teardown | Production volumes and containers unchanged. `down -v` was never run against them. |
| G3 | Result record | For each gate record `PASS`/`FAIL`, timestamp (UTC), duration, operator, evidence ref (log/ticket id, not secret contents) | Every checkbox has a result; failures itemized with reproduction step and manifest id where relevant. |

## Current gaps to report (do not mark as PASS)

- `.github/workflows/ci.yml` is unit-only; there is no opt-in build/readiness/migration/restore
  job yet (OPS-02). Any automation must be `workflow_dispatch` or protected-staging only,
  never an untrusted PR gate, and must use fake CI values plus protected-environment secrets.
- No backup/restore CLI or scripted drill wrapper exists in `scripts/`; section F is currently a
  manual runbook with TARGET tooling gaps recorded in `docs/backup-restore.md` §9.
- `docker/README.md` still needs to be reconciled with the verified `200`/`503` readiness
  contract in `apps/api/src/health/health.controller.ts` (it currently calls `503` an open
  interface requirement).
- `docs/migration-safety.md` and `docs/backup-restore.md` define the policy; this checklist
  does not replace their approval decisions (RPO/RTO, Object Lock mode, replica location).
