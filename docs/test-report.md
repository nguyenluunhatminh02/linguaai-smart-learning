# TEST-23 — Test report (observed evidence only)

## 1. Provenance and scope

| Field | Observed value |
|---|---|
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`, commit date `2026-11-28T08:21:37+07:00`) |
| Working tree | Dirty at collection time: 238 modified tracked files and 83 untracked paths (`git status --short`); concurrent agents were editing and running lint/fix commands. |
| Report slice | TEST-23 from `LinguaAI_Engineering_Roadmap.md`; only `docs/test-report.md` is in scope. No source, config, package, test, or database file was edited by this slice. |
| Evidence source | Results in sections 3–5 are the commands and results actually observed in this workspace at the HEAD above. A command with no observed invocation is `NOT RUN`, never green. |
| Secrets | No `.env` file, API key, real provider response, or transcript content was read, copied, or recorded. No database reset/truncate was executed by this slice. |
| Snapshot warning | Every result below is point-in-time and may already be stale. Re-run before treating any row as a release gate. |

`docs/baseline.md` is a **superseded snapshot** taken at HEAD `384f82797419d919bf626e8526add1c1e3c111f9`. Its `74 passed / 6 failed` AI-service result and its later `1 failed, 95 passed` follow-up are stale for this tree; do not quote either as current. This report does not edit `docs/baseline.md`.

The status vocabulary is deliberately narrow: **RUN/PASS** and **RUN/FAIL** mean an invocation with an observed exit code and output; **BLOCKED** means an invocation was attempted but could not complete for the stated reason; **UNRESOLVED** means no trustworthy result was observed; **NOT RUN** means no invocation was observed; **CONTRACT ONLY** means a spec/test file exists and was read but its scenario was not executed against the required runtime. File presence, CLI `--version`, container presence, and passing unit suites are not evidence that a test case passed.

## 2. Runtime and tooling actually observed

| Tool | Observed value / command |
|---|---|
| Node | `v24.18.1` — `node -v` |
| pnpm | `9.15.9` — `pnpm -v` (root `package.json` declares `packageManager: pnpm@9.15.0`) |
| Python | `Python 3.12.3` — `python3 --version` |
| Docker Compose | `Docker Compose version v5.5.1` — `docker compose version` |
| AI-service test interpreter | Existing ephemeral `/tmp/ai-provider-venv/bin/python` used by absolute path; no fresh venv was created and no package install was performed in this slice. |
| Repo pin | Root `pnpm@9.15.0`; scripts used below are from root `package.json`, `apps/api/package.json`, and `apps/web/package.json`. |

## 3. Exact command / result matrix

Commands were observed from the repository root unless the row says otherwise. No package manager install command was run.

| Command | Status | Observed result / first blocker |
|---|---|---|
| `node -v` | RUN/PASS | `v24.18.1`, exit 0. |
| `pnpm -v` | RUN/PASS | `9.15.9`, exit 0. |
| `python3 --version` | RUN/PASS | `Python 3.12.3`, exit 0. |
| `docker compose version` | RUN/PASS | `Docker Compose version v5.5.1`, exit 0. |
| `pnpm --filter api type-check` | RUN/PASS | Exit 0. |
| `pnpm --filter web type-check` | RUN/PASS | Exit 0. |
| `pnpm --filter web test:run` | RUN/PASS | Exit 0; 9 files, 59 tests passed. |
| `pnpm --filter api test -- --runInBand` | RUN/PASS | Exit 0; 52 suites, 632 tests passed. |
| From `apps/ai-service`: `/tmp/ai-provider-venv/bin/python -m pytest -q --tb=line` | RUN/PASS | Exit 0; `107 passed, 1 warning in 1.07s`. This is the observed count for this tree and supersedes the counts in `docs/baseline.md`. |
| `pnpm --filter web lint` | RUN/FAIL | Exit 1; 638 problems: 41 errors, 597 warnings. Predominant errors are `@typescript-eslint/no-explicit-any` / `Unexpected any`. |
| `pnpm build` | RUN/FAIL | Exit 1; `web#build` failed with `Error: Cannot find module '../lightningcss.linux-x64-gnu.node'`. Only the Windows native lightningcss package was found in `node_modules`. |
| `docker compose -f docker/docker-compose.yml config --quiet` | RUN/FAIL | Exit 1; interpolation requires `MFA_ENCRYPTION_KEY` (no value inspected or recorded). |
| `pnpm --filter api lint` | UNRESOLVED / CONCURRENT | No reliable result: the command remained running for more than 7 minutes and a concurrent `eslint --fix --quiet` process was observed. Do not mark green and do not quote a count. |
| `pnpm install --frozen-lockfile` | NOT RUN | No package-manager install was performed. |
| `pnpm --filter api db:generate` | NOT RUN | Prisma generation not verified in this slice. |
| `cd apps/ai-service` | RUN (context only) | Shell context for the Python command above; not a test result. |
| `python3 -m venv .venv` | NOT RUN | No venv was created; the pre-existing `/tmp/ai-provider-venv` was used instead. |
| `source .venv/bin/activate` | NOT RUN | Interpreter was invoked by absolute path. |
| `python -m pip install -r requirements.txt` | NOT RUN | No dependency installation was performed. `apps/ai-service/requirements-dev.txt` pins pytest `8.3.4` and pytest-asyncio `0.25.2`; `pytest.ini` sets `testpaths = tests`, `asyncio_mode = auto`. |
| `python -m pytest -q` (exact roadmap form) | NOT RUN | Only the equivalent absolute-path invocation with `--tb=line` above was observed. |
| API E2E: `pnpm --filter api test:e2e` | NOT RUN | Requires a disposable, migrated, seeded PostgreSQL database. `apps/api/test/setup.ts` executes `TRUNCATE TABLE users CASCADE` in seed/cleanup, so it must never be pointed at a shared or production DB. Direct `jest --config ./test/jest-e2e.json --listTests` enumerated 4 files: `chat-billing.e2e-spec.ts`, `chat-billing-orchestrator.spec.ts`, `tokens.e2e-spec.ts`, `srs-review.e2e-spec.ts`; enumeration is not execution. |
| Web E2E: `pnpm --filter web exec playwright test` | NOT RUN | No browser E2E invocation or result was observed. Playwright specs exist under `apps/web/e2e/` but were not executed. |
| Fresh repo venv install | NOT RUN | See venv/install rows above. |

## 4. Blocker register

| ID | Blocker | Evidence | Unblock step |
|---|---|---|---|
| B1 | Dirty tree with concurrent edits | 238 modified tracked files, 83 untracked paths; a concurrent `eslint --fix --quiet` process was observed. | Stop concurrent edits, commit or stash, then rerun every row in section 3 at a fixed HEAD. |
| B2 | API lint unresolved | `pnpm --filter api lint` exceeded 7 minutes with no trustworthy completion while another ESLint process ran. | Rerun alone after other ESLint processes exit; record exit code and error count. |
| B3 | Web build broken | `web#build`: missing `../lightningcss.linux-x64-gnu.node`; only Windows lightningcss native package present. | Restore/install the Linux native lightningcss binding in `node_modules` using the platform-appropriate dependency flow, then rerun `pnpm build`. |
| B4 | Compose config fails | `docker compose -f docker/docker-compose.yml config --quiet` needs `MFA_ENCRYPTION_KEY` interpolation. | Supply a local, randomly generated test value through the intended local env mechanism (never commit it), then rerun config validation. |
| B5 | API DB E2E unavailable | `apps/api/test/setup.ts` truncates `users` with `CASCADE`; no disposable migrated/seeded DB run was observed. Container presence is not test-DB evidence. | Provision a disposable PostgreSQL database, apply migrations and synthetic seed, point `DATABASE_URL` at it, and only then run `pnpm --filter api test:e2e`. |
| B6 | Web lint red | 41 errors (mostly explicit `any`) alongside 597 warnings. | Fix the 41 errors in the owning code slices and rerun `pnpm --filter web lint`; this report does not change source. |
| B7 | Install/generation unverified | `pnpm install --frozen-lockfile` and `pnpm --filter api db:generate` were not run. | Run them in a controlled environment and record exit codes/first errors. |

## 5. Roadmap test-case coverage map

Existing test files were read where useful; reading a file is not execution. Unit-suite totals confirm that the named suites ran, but per-test-case attribution below is limited to what the file names and test names make explicit.

### TEST-01..TEST-15

| Case | Roadmap scope | Evidence in this tree | Status |
|---|---|---|---|
| TEST-01 | Pricing, transition, score normalization, daily grant policy (unit) | API unit run passed 632 tests; files `apps/api/src/tokens/pricing.spec.ts`, `apps/api/src/tokens/daily-grant.spec.ts`, `apps/api/src/writing/score-normalization.spec.ts`, `apps/api/src/srs/{fsrs,sm2}.algorithm.spec.ts`, `apps/api/src/tokens/tokens.service.spec.ts` exist. AI-service has `tests/test_cost_policy.py`. No per-case assertion output was recorded beyond the suite totals. | PARTIAL — deterministic unit coverage exists and suite is green; edge-case assertion detail not separately verified. |
| TEST-02 | Token debit/refund/replay with real PostgreSQL | `apps/api/test/tokens.e2e-spec.ts`, `tokens-db.e2e-spec.ts`, `tokens-reconciliation.e2e-spec.ts`, and `apps/api/src/tokens/tokens-reconciliation.service.spec.ts` exist; DB E2E not run (B5). | PARTIAL (unit/contract) / NOT RUN (DB integration). |
| TEST-03 | Concurrent SRS review on same card/operation | `apps/api/test/srs-review.e2e-spec.ts` exists and was enumerated but not executed; `apps/api/src/srs/srs.service.spec.ts` exists in the passing unit run. | PARTIAL / NOT RUN on real DB. |
| TEST-04 | Learning attempts and summary; retry/best/latest | `apps/api/test/learning-attempts.e2e-spec.ts` exists; `apps/api/src/learning/learning.service.spec.ts` is in the passing unit run. DB E2E not run (B5). | PARTIAL / NOT RUN on real DB. |
| TEST-05 | Redis cache outage, stale read, distributed limiter | `apps/api/test/redis-outage.e2e-spec.ts` exists; `apps/api/src/common/services/{redis,rate-limiter,circuit-breaker}.service.spec.ts` exist; AI-service `tests/test_cache.py` is part of the 107 passing tests. Real-outage/integration run not observed. | PARTIAL / NOT RUN for outage and distributed policy. |
| TEST-06 | Auth, ownership, admin, forbidden routes (API E2E) | `apps/api/test/auth-ownership.e2e-spec.ts` exists; unit specs include `apps/api/src/auth/guards/authorization-matrix.spec.ts` and `apps/api/src/admin/admin.controller.spec.ts`. E2E not run (B5). | PARTIAL / NOT RUN. |
| TEST-07 | Chat SSE + billing + persistence; CHAT-04 pass | `apps/api/test/chat-billing.e2e-spec.ts` and `chat-billing-orchestrator.spec.ts` exist; see CHAT-04 map below. DB E2E not run (B5). | PARTIAL (contract specs only) / NOT RUN. |
| TEST-08 | Writing history/detail, speaking uploads | `apps/api/test/writing-speaking.e2e-spec.ts` exists; `apps/api/src/writing/writing.service.spec.ts` and `apps/api/src/speaking/*` unit specs exist; web `speaking.spec.ts` / `speaking.test.ts` are in the 59 passing web tests. E2E not run. | PARTIAL / NOT RUN. |
| TEST-09 | NestJS ↔ FastAPI schemas/errors contract | `apps/api/test/contract.e2e-spec.ts`, `apps/api/src/common/services/ai-client.service.spec.ts`, AI-service `tests/test_contract.py` and `tests/test_core_validation.py` exist; API/AI unit suites passed. Cross-service live contract run not observed. | PARTIAL. |
| TEST-10 | Worker queue retry, crash, duplicate, outbox | `apps/api/test/queue.e2e-spec.ts` exists; `apps/api/src/queue/queue.service.spec.ts` exists in the passing unit run. Queue/crash integration not run (B5 and no worker harness evidence). | PARTIAL / NOT RUN. |
| TEST-11 | Browser signup/login, flashcard, chat, writing, daily plan | `apps/web/e2e/auth-flow.spec.ts`, `learning-flow.spec.ts`, `review-session.spec.ts` exist; `pnpm --filter web exec playwright test` not run. Web unit suite (59 tests) is unrelated to full browser flows. | NOT RUN. |
| TEST-12 | Browser conversation switch, cancel audio, token refresh; state isolation | `apps/web/e2e/state-isolation.spec.ts` exists; `apps/web/src/lib/sse-parser.spec.ts` and `apps/web/src/stores/{auth-store,token-store}.spec.ts` are in the passing web unit run. Playwright not run. | PARTIAL (unit) / NOT RUN (browser). |
| TEST-13 | AI eval golden dataset | `apps/ai-service/evals/test_eval_runner.py` and `docs/ai-eval-baseline.md` exist; no eval command invocation was observed in this slice. | NOT RUN. |
| TEST-14 | Docker build, readiness, migration, restore from clean env | `docker compose version` passed and `docker compose ... config --quiet` failed on missing interpolation value (B4); no build/readiness/migration/restore smoke run observed. | BLOCKED / NOT RUN. |
| TEST-15 | Load: API/DB/SSE/worker separately against staging baseline | No load command or result observed. `docs/benchmarks/` and `docs/load-test-plan.md` exist but are not execution evidence. | NOT RUN. |

### CHAT-04 T01–T20

`apps/api/test/chat-billing.e2e-spec.ts` contains named cases T01–T08 and T11–T16/T18–T20; `apps/api/test/chat-billing-orchestrator.spec.ts` contains in-process state-transition specs labelled T09, T10, T11, and T12. `apps/web/src/lib/sse-parser.spec.ts` (part of the passing 59-test web suite) covers arbitrary byte splits, multi-event chunks, terminal/failure/cancel handling, EOF, and `[DONE]`. None of the API E2E labels were executed against PostgreSQL in this slice, so no row below is marked green on the strength of file presence or unit-suite totals alone.

| Test | Evidence observed | Status |
|---|---|---|
| T01 Balance sufficient, fake LLM success; one attempt/debit, two messages, completed after commit | Named `it('T01 …')` in `apps/api/test/chat-billing.e2e-spec.ts`; orchestrator has generic success/commit specs. `apps/api/test/fixtures/chat-billing.fixture.ts` provides `FakeLlmProvider`, `FakeRedis`, `seedChatBillingFixtures`, `readChatBillingState`, `parseSseEvents`. | CONTRACT ONLY — DB E2E NOT RUN (B5). |
| T02 Insufficient balance; no LLM, debit, or message | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T03 Invalid language; 400 before side effects | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T04 Other user's conversation; 404/403, no debit/leak | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T05 Same key/payload sequential replay; no extra debit | Named E2E case present; orchestrator spec covers same-key `findOrCreate` idempotence in memory. | CONTRACT ONLY — DB E2E NOT RUN. |
| T06 Same key concurrent; one claim, one debit | Named E2E case present; operation service contract includes `claimLease`. | CONTRACT ONLY — DB E2E NOT RUN. |
| T07 Same key different payload; 409, original unchanged | Named E2E case present; orchestrator spec has a matching in-memory variant. | CONTRACT ONLY — DB E2E NOT RUN. |
| T08 Same key different user; isolated scope | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T09 Provider timeout before delta; terminal failure/UNKNOWN, at most one refund | Two named specs in `apps/api/test/chat-billing-orchestrator.spec.ts`; these are in-process specs, not the DB E2E row. | CONTRACT SPEC ONLY — no specific timed-out provider/DB run verified. |
| T10 Provider error after delta; no completed, UI incomplete | Named orchestrator spec present; web parser spec covers safe `failed` outcome. | CONTRACT SPEC ONLY — UI/DB run not verified. |
| T11 Disconnect before commit; recovery preserves ledger | Named E2E case plus orchestrator cancelled-before-commit variant; web parser spec covers abort terminal handling. | CONTRACT ONLY — DB E2E NOT RUN. |
| T12 Disconnect after commit before completed event; replay returns saved result | Named E2E case plus orchestrator immutable-SUCCEEDED variant. | CONTRACT ONLY — DB E2E NOT RUN. |
| T13 Crash after reserve before provider; lease recovery | Named E2E case present in `chat-billing.e2e-spec.ts`. | CONTRACT ONLY — DB E2E NOT RUN. |
| T14 Crash after provider before commit; UNKNOWN/reconcile | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T15 Two turns on one conversation; single in-flight | Named E2E case present. | CONTRACT ONLY — DB E2E NOT RUN. |
| T16 Redis down; billing correct, limiter policy | Named E2E case present. No Redis-down integration run observed (also see TEST-05). | CONTRACT ONLY — DB E2E NOT RUN. |
| T17 P2034 during reserve/finalize; bounded retry, no blind LLM retry | No specifically named T17 invocation/file verified in the observed runs. | NOT RUN unless a matching test is identified and executed in a rerun. |
| T18 Repeated refund; never double credit | Named E2E case present; refund ledger key/fencing exists in the operation service contract. | CONTRACT ONLY — DB E2E NOT RUN. |
| T19 SSE chunk split; Unicode preserved, no lost events | Web `sse-parser.spec.ts` explicitly tests byte-by-byte multi-byte chunks and multiple events per chunk; named API E2E case present. | PARTIAL (web unit passed) / API DB E2E NOT RUN. |
| T20 EOF without completed; no success | Web `sse-parser.spec.ts` explicitly asserts EOF/`[DONE]` are incomplete; named API E2E case present. | PARTIAL (web unit passed) / API DB E2E NOT RUN. |

## 6. Risks and next actions

1. Do not call the tree green: TypeScript checks and unit suites are green, but web lint and build fail, API lint is unresolved, compose config is blocked, and all DB/browser/load evidence is missing.
2. Highest-risk unverified area is billing/SSE correctness under real PostgreSQL concurrency and crashes (TEST-02, TEST-03, TEST-07 and CHAT-04 T01–T20). Pass the unit suites only after the disposable-DB run in B5; use synthetic users and the fake provider fixture, never production data or paid provider calls.
3. Re-run in this order after stabilizing the tree: (a) fix B6/B2/B3/B4 in their owning slices; (b) run `pnpm install --frozen-lockfile` and `pnpm --filter api db:generate`; (c) rerun typechecks and unit suites; (d) provision disposable PostgreSQL and run API E2E; (e) run Playwright; (f) run infra smoke and load tests.
4. Record new exit codes, counts, and first errors against the new HEAD in a fresh report revision. Supersede this document rather than silently overwriting observed results.
