# DB-04 — PostgreSQL connection budget (planning note, no measurements)

Status: **formula and source-observed inventory only. No benchmark, load test, or database query was executed for this document.** Every numeric input below is either observed in checked-in source/configuration or explicitly labelled as a library/server default or a policy choice. No value here is a measured capacity or a claim of verified throughput.

## 1. Provenance

| Field | Value |
|---|---|
| Roadmap entry | `LinguaAI_Engineering_Roadmap.md` DB-04, line 648: "Tính connection budget = pool mỗi process × số processes + worker + migration/admin; giữ dưới DB limit với headroom" |
| Supporting entry | `LinguaAI_Engineering_Roadmap.md` PERF-01, lines 937–955; line 955 requires machine, runtime, dataset, commit, env, command, results, and confidence/limitations for anything recorded under `docs/benchmarks/` |
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`, committed 2026-11-28) |
| Document date | 2026-11-28 |
| Sources read | `docker/docker-compose.yml`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/queue/queue.module.ts`, `apps/ai-service/app/services/llm_client.py`, `apps/ai-service/app/rate_limit.py`, `apps/ai-service/app/services/cache.py`, `.github/workflows/ci.yml`, `LinguaAI_Engineering_Roadmap.md` (all paths relative to the repo root) |
| Measurement status | **None.** No `SHOW max_connections;`, no `pg_stat_activity` sample, no load test, no pool-wait observation. |
| Secret handling | No `.env` file was read or printed. No `DATABASE_URL` value, password, or API key is reproduced here; connection strings appear only as variable placeholders copied from Compose, with credentials represented by `${...}` names. |
| Concurrency caveat | Other work was in progress in the working tree at collection time. Re-verify the cited paths and line numbers before treating this inventory as current. |

Related note in the same directory: `docs/benchmarks/chat-history.md` is a DB-04 query/index measurement *plan* with no results yet. It stays separate; neither note invents numbers for the other. The DB-04 index report, when actually measured, belongs in its own file with the PERF-01 provenance fields.

## 2. Formula and policy gate

```text
budget = Σ(process_count_i × pool_max_i) + worker_connections + migration/admin_connections

headroom = verified_DB_limit − budget
```

Where:

- `process_count_i` is the number of simultaneously running OS processes of kind `i` that open PostgreSQL connections (API replicas, one-shot jobs, workers, admin clients).
- `pool_max_i` is the maximum connections each such process may hold (`pg.Pool.max` for the NestJS API). A pool is an upper bound on *idle + checked-out* clients, not a guaranteed concurrent load.
- `worker_connections` covers separate queue worker processes. It is `0` in the current source inventory, not a measured idle value.
- `migration/admin_connections` covers transient `prisma migrate deploy` and human/operator sessions. For a planning budget, reserve capacity rather than assuming these are absent.
- `verified_DB_limit` must come from `SHOW max_connections;` on the actual target server. Until then it is an **unknown variable**, not a number copied from these files.

Policy gate (a choice, not a result): the budget must stay **strictly below** the verified limit, with a reserved slice for migration/admin work and unexpected operator connections. This document does not assert that any particular reserve percentage is sufficient; the reserve becomes a final decision only after the limit is verified and the operational policy is agreed. If `headroom ≤ 0`, do not scale out: reduce replicas or `pool_max`, or raise the verified server limit deliberately.

Terminology discipline: "default" below means a library or server default that must be confirmed on the deployment, not a fact observed in this repository. "Observed" means literally present in the cited file.

## 3. Process inventory (source-observed)

| Process / source | Instances today | PG connections per instance | Basis |
|---|---:|---:|---|
| NestJS API — `apps/api/src/prisma/prisma.service.ts:33` constructs `new Pool({ connectionString: url })` and passes it to `PrismaPg` | 1 container (`api`, fixed `container_name: linguaai-api` in `docker/docker-compose.yml:66–70`) | `P_fg` = pg `Pool.max` **library default, to confirm**; no explicit `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis` is set in the file | Observed construction; value is a default of the installed `pg` version |
| One-shot migration — `migrate` service runs `prisma migrate deploy` with `restart: "no"` (`docker/docker-compose.yml:43–64`); API depends on `condition: service_completed_successfully` (lines 98–104) | 1 transient job per release | `M` = connections held by that job while it runs; after success, 0 | Observed job definition; count not measured |
| Queue workers | 0 processes | 0 | `apps/api/src/queue/queue.module.ts:356–392` only lazily creates a **BullMQ `Queue`** producer against Redis; `bullmq` is not pinned and no `Worker` consumer is constructed. No worker container exists in Compose. If a worker later opens Prisma/pg, add it as a new term. |
| FastAPI service (`ai`) | 1 container (`docker/docker-compose.yml:144–169`) | 0 | `apps/ai-service/app/services/llm_client.py:464–469` uses an `httpx.AsyncClient` with `max_connections=100` for **provider HTTP**, not PostgreSQL; cache/rate-limit clients in `cache.py` and `rate_limit.py` target Redis. No PostgreSQL driver is used in the service. |
| Web (`web`, Next.js) | 1 container (`docker/docker-compose.yml:112–142`) | 0 | Talks to the API over `INTERNAL_API_URL`/`CMS_BACKEND_URL`; no DB client in Compose environment or source |
| PostgreSQL server itself — `postgres:16-alpine` (`docker/docker-compose.yml:2–20`) | 1 | Not a client | Compose sets no `max_connections` flag, so the server default applies until verified with `SHOW max_connections;` |
| Administration / ad-hoc SQL | 0 standing processes | `A` = operator/psql/admin sessions to reserve | Policy input, not observed; may be nonzero at any time |
| CI (`.github/workflows/ci.yml`) | Unit-test job only | 0 against any shared DB | CI has no service containers (lines 1–3 comment, jobs section); `DATABASE_URL` there is a documented fake CI value and no real DB is contacted by this note |

Two defaults that are **not** repo facts and must be verified on the target server before the formula is used with numbers:

1. `pg` `Pool.max` — the effective `P_fg` when `max` is omitted in `prisma.service.ts`.
2. PostgreSQL `superuser_reserved_connections` — part of how much of the nominal `max_connections` is actually available to ordinary application roles.

Neither has been read from a running instance or from environment values for this note.

## 4. Worked examples (symbolic, not measured)

Present-state expression, with the one API process and no worker:

```text
budget_today = 1 × P_fg + M + A
headroom_today = L − (P_fg + M + A),  where L = SHOW max_connections; on the target server
```

Example with defaults-labelled inputs, for arithmetic only:

| Symbol | Value used in example | Status of the value |
|---|---:|---|
| `L` | 100 | Illustrative value only; **not** a verified server limit. Replace with `SHOW max_connections;` output. |
| `P_fg` | 10 | Illustrative pg `Pool.max` default; confirm the installed `pg` version and any injected configuration. |
| `M` | 1 | Illustrative one-shot migration connection allowance. |
| `A` | 5 | Illustrative reserved admin allowance; a policy choice, not a measurement. |
| `R` | 0 | Current worker processes observed in source. |

```text
budget_example = 1 × 10 + 0 + (1 + 5) = 16
headroom_example = 100 − 16 = 84   (derived arithmetic from the assumed L, not a load-test result)
```

Scaling table, parameterized by API replica count `N` and per-replica pool maximum `P` (using the same illustrative `L = 100`, `M + A = 6`, `R = 0`; every cell is arithmetic on assumptions, not measured capacity):

| API replicas `N` | `P = 10` | `P = 20` | `P = 50` |
|---:|---:|---:|---:|
| 1 | 16 | 26 | 56 |
| 2 | 26 | 46 | 106 (over assumed limit) |
| 4 | 46 | 86 | 206 (over assumed limit) |

Break-even for this illustrative setup:

```text
N × P + 6 < L = 100
N × P < 94
```

With `P = 10`, the largest integer `N` satisfying the strict inequality is `9` (budget `96`); `N = 10` gives `106` and fails. With `P = 20`, `N = 4` gives `86` and `N = 5` gives `106`. These thresholds are **not** safe replica recommendations: they ignore `superuser_reserved_connections`, peak migration overlap, pooler behaviour, and any other client of the same server. They exist only to show how the formula is applied and why headroom must be checked before scaling.

Re-check the formula whenever any of these change:

- Compose sets `max_connections`, or the deployment moves to a managed PostgreSQL with a different documented limit.
- A pooler such as PgBouncer is placed between API and PostgreSQL (this changes what a "connection" counts against).
- API replicas are added; note that `container_name` and fixed host port in `docker/docker-compose.yml` currently block straightforward Compose scaling (also flagged in PERF-02, line 959).
- A real BullMQ worker that opens its own Prisma/pg connection is introduced (the current `queue.module.ts` only creates a Redis-backed producer).
- `PrismaService` starts setting `max` explicitly, or a connection string injects a pool size.

## 5. Out of scope and limitations

- **No pool-wait, latency, throughput, or saturation numbers.** DB-04 index before/after results and PERF-01 load-test results are separate deliverables; none are claimed here.
- **No verified DB limit or verified default.** `SHOW max_connections;` has not been run for this note. The `pg` pool default and PostgreSQL reserved connections are labelled assumptions, not repository facts.
- **No `.env` values, local credentials, or secret-bearing `DATABASE_URL`s.** Compose placeholders are quoted only as variable names; CI's documented fake value is not a credential to reuse.
- **No claim that the current deployment is safe or unsafe.** The gate in section 2 can only be evaluated after the limit and effective pool size are verified.
- **No changes to source, Compose, schema, or tests.** This is a documentation slice. One out-of-scope follow-up is proposed but not done: make `max`, `idleTimeoutMillis`, and `connectionTimeoutMillis` explicit and documented in `apps/api/src/prisma/prisma.service.ts` so the pool size used by the formula is verifiable in code rather than inherited from a library default. That change needs a small unit test and a rollout note.
- **Metrics not yet implemented here.** OPS-03 (`LinguaAI_Engineering_Roadmap.md:927`) names `db_pool_wait_seconds` with label `pool` as the intended saturation signal, and line 932 asks for DB connections on the dashboard. These are roadmap targets, not metrics observed in this note; when implemented, they should supply empirical inputs for the terms marked "to measure" above. Use low-cardinality labels (for example a fixed `pool` identifier), never user IDs, request IDs, or raw URLs.

## 6. How to fill this in later

Run these only against a disposable/authorized database; never against a production or shared development instance for a documentation exercise. Redact host, user, and database names from any published result.

```sql
-- 1. Verified server limit (assign to L in section 4).
SHOW max_connections;

-- 2. Current clients grouped by application_name; no credentials in output.
SELECT application_name, count(*) AS connections
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY application_name
ORDER BY connections DESC;
```

```bash
# 3. Validate Compose interpolation without printing resolved environment values.
docker compose -f docker/docker-compose.yml config --quiet
```

Then replace every illustrative input in section 4 with the verified values, recompute `budget` and `headroom`, and apply the strict policy gate. If a future measurement is added under `docs/benchmarks/`, record machine, runtime, dataset, commit, env, exact command, results, and confidence/limitations as required by PERF-01 (line 955). Keep measured results in a separate file; do not convert the symbolic examples in this note into claimed measurements.
