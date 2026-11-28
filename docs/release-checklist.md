# Release checklist — v0.2 through v1.0

**Status:** Living gate register. Every cell is `NOT RUN` until an operator records a real command, exit code, artifact path, commit SHA, environment and UTC timestamp against it. A cell that reads `NOT RUN` is not a failure; it is an unexecuted gate. A cell that reads `PASS` must carry the evidence tuple; a cell that reads `FAIL` must carry the first error and the owning slice. A cell that reads `WAIVED` is only valid for P1/P2 gates and must carry owner, rationale, compensating control and expiry.

**Scope anchor:** `LinguaAI_Engineering_Roadmap.md` section 13.1 (release milestones lines 1092–1101), section 13.5 (Definition of Done lines 1169–1178), section 13.6 (portfolio deliverables lines 1180–1203). Neighbouring policies: `docs/ci-policy.md`, `docs/infra-smoke.md`, `docs/backup-restore.md`, `docs/data-retention.md`, `docs/pilot-policy.md`, `docs/load-test-plan.md`, `docs/horizontal-scaling.md`, `docs/test-report.md`, `docs/baseline.md`, `docs/ai-eval-baseline.md`.

**Evidence rules (apply to every row):**

1. Evidence is exit codes, counts, timings, image IDs, manifest IDs and artifact paths only. Never paste `docker compose config` output, dump contents, `.env` values, API keys, credentials, learner text, transcripts or audio.
2. A `PASS` row must record: command executed, artifact path (JUnit XML, coverage JSON, image digest, manifest id, benchmark report), commit SHA, environment (local disposable / CI / staging), and UTC timestamp.
3. A command that was not executed is `NOT RUN`, never green. A number from an older tree is `STALE (superseded by <ref>)` as `docs/baseline.md` section 6 does.
4. P0 gates cannot be waived. If a P0 gate is not `PASS`, the release is blocked.
5. P1/P2 gates may be `WAIVED` only with: owner name, rationale, compensating control, and expiry date (maximum 30 days). After expiry the waiver lapses and the gate reverts to `NOT RUN`.
6. File presence, CLI `--version`, container presence and passing unit suites are not evidence that an integration, E2E or load gate passed. `docs/test-report.md` section 1 defines the vocabulary.

**Current baseline snapshot (2026-11-28, HEAD `3be6aa3`):**

- API unit suite: 632 tests PASS. Web unit suite: 59 tests PASS. AI-service unit suite: 107 tests PASS (at HEAD `3be6aa3`; supersedes the stale `74/6` and `1/95` counts in `docs/baseline.md`).
- Web lint: FAIL (41 errors, 597 warnings). Web build: FAIL (missing `lightningcss.linux-x64-gnu.node`). API lint: UNRESOLVED (concurrent ESLint processes at observation time). Compose config: BLOCKED on `MFA_ENCRYPTION_KEY` interpolation.
- API E2E (`pnpm --filter api test:e2e`): NOT RUN — requires a disposable, migrated, seeded PostgreSQL database. `apps/api/test/setup.ts` truncates `users` with `CASCADE`; it must never be pointed at a shared or production DB.
- Web E2E (`pnpm --filter web exec playwright test`): NOT RUN.
- Load tests, horizontal scaling lab, backup/restore drill, observability stack, AI eval golden dataset: all NOT RUN.
- Token purchase route (`POST /tokens/purchase`): still mints tokens without payment verification (BUG-01 / BILL-01 open). v0.2 gate requires this closed.
- Score contract (DB-03): `apps/api/src/writing/writing.controller.ts:155-161` still infers scale from raw magnitude; FastAPI schema has no `scoreScale` field. v0.3 gate requires this resolved.
- CHAT-04 T13/T14/T17: covered at service/repository level in `apps/api/test/chat-billing-orchestrator.spec.ts` and `apps/api/src/tokens/tokens.service.spec.ts`. T15/T16/T18 are cross-cutting API-level. T19/T20 have web unit coverage in `apps/web/src/lib/sse-parser.spec.ts`. All API DB E2E labels are CONTRACT ONLY until the disposable-DB run is executed.

---

## 1. v0.2 — Correctness

Roadmap line 1096: "Baseline, BILL/CHAT P0, security regression, token purchase disabled."

All gates in this section are **P0** and cannot be waived.

| # | Gate | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|
| v0.2-01 | BASE-01/02 baseline report recorded | `docs/baseline.md` and `docs/test-report.md` exist with HEAD SHA, timestamps, and per-command status | Every BASE-01 command has a recorded status; nothing is silently marked green | NOT RUN | — |
| v0.2-02 | BILL-01 — token purchase disabled | `POST /tokens/purchase` returns 4xx or is removed; balance unchanged after a valid-format request; test asserts DB no-op | Route does not mint tokens for a normal authenticated user; test passes on disposable PostgreSQL | NOT RUN | BUG-01 is currently open per `docs/endpoint-inventory-chat-tokens.md:52,112,156` |
| v0.2-03 | BILL-02 — server-authoritative pricing | Pricing catalog is server-side; feature→handler→billing owner inventory recorded (`docs/billing-call-sites.md`) | No client-side balance check is the security control; one successful turn = one net debit | NOT RUN | — |
| v0.2-04 | BILL-03 — durable AI operation | `ai_operations` table exists with unique `(user_id, feature, client_operation_id)`; migration applied; state machine enforced | Terminal states do not revert to RUNNING; same key+payload returns existing state; different payload returns 409 | NOT RUN | Schema and service exist; runtime not verified against disposable DB |
| v0.2-05 | BILL-04 — reserve/settle/refund atomic | `pnpm --filter api test:e2e -- tokens` on disposable PostgreSQL; ledger invariant: balance non-negative, no duplicate charge | All token E2E specs pass; reconciliation job shows zero mismatch | NOT RUN | Requires disposable migrated DB (blocker B5 in `docs/test-report.md`) |
| v0.2-06 | BILL-05 — daily top-up UTC | `daily_credit_grants` unique `(user_id, grant_type, day)`; test covers UTC midnight, balance>=30, concurrent grant+debit | No double grant; marker is DB-authoritative, not Redis-only | NOT RUN | — |
| v0.2-07 | CHAT-01/02 — unified stream orchestration | `POST /api/v1/chat/stream` with `Idempotency-Key`; terminal event `completed` only after DB commit; persisted result replayable | One operation key = one provider call = one debit; replay returns saved result without re-calling provider | NOT RUN | Contract specs exist in `apps/api/test/chat-billing-orchestrator.spec.ts`; DB E2E NOT RUN |
| v0.2-08 | CHAT-03 — frontend SSE parser | `pnpm --filter web test:run` includes `apps/web/src/lib/sse-parser.spec.ts` covering byte splits, multi-event chunks, EOF, `[DONE]` | All parser specs pass; no lost events on multi-byte token split | PASS (unit) | 59 web unit tests passed at HEAD `3be6aa3`, `2026-11-28` |
| v0.2-09 | CHAT-04 matrix T01–T20 | `pnpm --filter api test:e2e -- chat-billing` on disposable PostgreSQL; web parser specs | Every T01–T20 case passes against real PostgreSQL; see section 9 for per-test attribution | NOT RUN (DB E2E) / PASS (web parser unit) | Fixtures in `apps/api/test/fixtures/chat-billing.fixture.ts` |
| v0.2-10 | SEC-01/02 — authorization matrix and ownership | `pnpm --filter api test -- --runInBand` includes `authorization-matrix.spec.ts`, `admin.controller.spec.ts`; E2E `auth-ownership.e2e-spec.ts` | User B cannot read/write/delete user A's resources; unauthenticated returns 401; wrong role returns 403 | NOT RUN (E2E) / PASS (unit) | Unit suite 632 tests passed at HEAD `3be6aa3` |
| v0.2-11 | SEC-06/07 — rate limiter and input limits | Limiter returns 429 with `Retry-After`; body/upload/audio/message over limits rejected before expensive processing | Distributed limiter works across two instances (currently a known gap — `ThrottlerModule` has no shared storage per `docs/endpoint-inventory-learning.md:15`) | NOT RUN | SEC-06 multi-instance gap is open |
| v0.2-12 | SEC-10 — no exposed secrets | `node scripts/check-secrets.mjs` exits 0; client bundle contains no provider key, JWT secret, or MFA key | No secret in `apps/web/.next/static/**`, no secret in logs, no secret in repo history (gitleaks/trufflehog clean) | NOT RUN | Script exists at `scripts/check-secrets.mjs` |
| v0.2-13 | Security regression suite green | `pnpm --filter api test -- --runInBand` exits 0; no P0 security issue open | All auth, ownership, limiter, input-limit, and secrets specs pass | PASS (unit) | 632 API unit tests passed at HEAD `3be6aa3` |
| v0.2-14 | Quota enforced at server | Every AI feature rejects with `INSUFFICIENT_CREDITS` before provider call when balance < price | Test asserts no provider call on insufficient balance (CHAT-04 T02) | NOT RUN (DB E2E) | Contract spec exists |
| v0.2-15 | v0.2 sprint gate | All P0 gates above are PASS; no P0 issue open | Release blocked until every row in this section is PASS | NOT MET | — |

---

## 2. v0.3 — Private beta

Roadmap line 1097: "Score/progress, Docker, backup, observability cơ bản, user deletion, all critical tests green."

| # | Gate | Priority | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|---|
| v0.3-01 | DB-03 score contract | P0 | FastAPI schema exposes `scoreScale`; `apps/api/src/writing/writing.controller.ts:155-161` no longer infers scale from magnitude; null/NaN/negative/overflow tests pass | Score is unambiguous across writing, speaking, and level estimation; no legacy magnitude guessing | NOT RUN | Currently ambiguous per `docs/sprint4-report.md:51` |
| v0.3-02 | DB-02 learning attempts | P0 | `pnpm --filter api test:e2e -- learning-attempts` on disposable PostgreSQL; unique `(user_id, client_attempt_id)`; retry does not increment count; best/latest correct | No duplicate attempt; summary fields consistent | NOT RUN | Schema and service exist; DB E2E NOT RUN |
| v0.3-03 | OPS-01 Docker Compose correctness | P0 | `docs/infra-smoke.md` sections A–C executed on disposable stack; exit codes recorded | All A1–A5, B1–B7, C1–C10 PASS; web server uses `INTERNAL_API_URL` for server-side calls (currently broken — `apps/web/src/app/api/speaking/topic/route.ts:5` etc. use `NEXT_PUBLIC_API_URL`) | NOT RUN | Web routes broken per `docs/sprint8-report.md:39` |
| v0.3-04 | OPS-01 dependency-failure drill | P0 | `docs/infra-smoke.md` section D on disposable stack | Redis down → readiness 503, liveness 200, no secret leakage; recovery returns 200 | NOT RUN | — |
| v0.3-05 | DB-05 / OPS-01 backup and restore drill | P0 | `docs/infra-smoke.md` section F on isolated restore stack; `docs/backup-restore.md` §8 evidence template filled | F1–F11 PASS; row counts match; invariants zero; RPO/RTO measured | NOT RUN | CLI tooling (`scripts/backup-cli.mjs`) is TARGET, not implemented |
| v0.3-06 | OPS-03 observability cơ bản | P1 | `/metrics` endpoint returns Prometheus text on API and AI service; structured logs include `requestId`; correlation ID propagates NestJS→FastAPI | At least `http_request_duration_seconds`, `ai_requests_total`, `ai_provider_duration_seconds` are scraped; one dashboard renders them | NOT RUN | Metrics middleware not wired per `docs/sprint8-report.md:32` |
| v0.3-07 | SEC-11 user deletion end-to-end | P0 | `DELETE /users` → 30-day grace → final purge via `ScheduledDeleteService.permanentlyDeleteExpiredAccounts()`; purge removes chat, writing, speaking, reading, quiz, SRS, notifications, avatar, owned objects, raw-SQL rows (`skill_proficiency`, `placement_attempts`) | Anonymised `users` row has no owned content left; financial/audit records preserved per policy; object keys under owner prefix deleted | NOT RUN | `ScheduledDeleteService` does not call `purgeUserData()` today per `docs/data-retention.md:65` |
| v0.3-08 | All critical tests green | P0 | `pnpm --filter api type-check`, `pnpm --filter web type-check`, `pnpm --filter api lint`, `pnpm --filter web lint`, `pnpm --filter api test -- --runInBand`, `pnpm --filter web test:run`, `pytest -q` all exit 0 | No lint error, no type error, no unit failure | NOT RUN | Web lint FAIL, web build FAIL, API lint UNRESOLVED at HEAD `3be6aa3` |
| v0.3-09 | API E2E suite green | P0 | `pnpm --filter api test:e2e` on disposable PostgreSQL exits 0 | All E2E specs pass including chat-billing, tokens, SRS review, auth-ownership, learning-attempts, writing-speaking, queue, contract, redis-outage, horizontal-scaling | NOT RUN | Blocker B5 in `docs/test-report.md` |
| v0.3-10 | Web lint and build green | P1 | `pnpm --filter web lint` exits 0; `pnpm build` exits 0 | No `@typescript-eslint/no-explicit-any` error; Linux lightningcss binding present | NOT RUN | 41 lint errors and missing lightningcss at HEAD `3be6aa3` |
| v0.3-11 | Pilot policy signed off | P1 | `docs/pilot-policy.md` reviewed by product, engineering, legal/privacy owners; version and effective date recorded; all section 7 checkboxes ticked | Consent default-off, withdrawal tested, event whitelist verified, provider retention verified, minors excluded by enforced check | NOT RUN | Policy is documented but not implemented per `docs/pilot-policy.md:3` |
| v0.3-12 | v0.3 sprint gate | P0 | All P0 gates in this section PASS; P1 gates PASS or WAIVED with owner/rationale/compensating-control/expiry | Private beta blocked until every P0 row is PASS | NOT MET | — |

---

## 3. v0.4 — Reliability

Roadmap line 1098: "Unified AI route migration, durable queue khi cần, shared storage, failure tests."

| # | Gate | Priority | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|---|
| v0.4-01 | REL-01 — unified AI client | P1 | `apps/api/src/common/services/ai-client.service.ts` is the sole adapter to FastAPI; `groq.service.ts` removed or gated to migration-only; error codes from roadmap line 480 honoured | No NestJS route calls a provider directly; error contract includes `requestId`, `operationId`, `code`, `retryable` | NOT RUN | — |
| v0.4-02 | REL-02 — AI route migration | P1 | Each Next.js AI route in roadmap line 501–509 table has a corresponding NestJS+FastAPI handler; characterization tests exist; canary shows no direct provider call | `rg -n 'GROQ_API_KEY\|openai\|groq-sdk' apps/web` returns no runtime caller | NOT RUN | — |
| v0.4-03 | REL-03 — durable queue | P1 | `pnpm --filter api test:e2e -- queue` on disposable PostgreSQL; worker retry, crash, duplicate, outbox tests pass | No duplicate charge/result when retry/crash; poison job retained with alert; graceful shutdown releases lease | NOT RUN | — |
| v0.4-04 | REL-04 — shared storage | P1 | `StoragePort` interface implemented; S3-compatible staging adapter; upload on instance A readable/deletable on instance B; signed URL with `STORAGE_SIGNING_SECRET` verified with `timingSafeEqual` | Horizontal-scaling T06/T07 PASS; no file lost on restart | NOT RUN | Current storage is local `uploads/` per `docs/sprint8-report.md:41` |
| v0.4-05 | Failure tests | P1 | Provider timeout, provider error mid-stream, Redis outage, PostgreSQL serialization conflict (P2034), worker crash — each has a test asserting the correct terminal state and ledger outcome | CHAT-04 T09/T10/T13/T14/T16/T17 all PASS | NOT RUN | Contract specs exist; DB E2E NOT RUN |
| v0.4-06 | v0.4 sprint gate | P1 | All P1 gates PASS; feature migrated off frontend provider calls; async job has recovery and idempotency; file not lost on restart | Reliability release blocked until gates PASS | NOT MET | — |

---

## 4. v0.5 — AI quality

Roadmap line 1099: "Prompt versions, eval, cost accounting, router theo evidence."

| # | Gate | Priority | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|---|
| v0.5-01 | AI-01 prompt registry | P1 | `apps/ai-service/app/prompts/registry.py` declares every prompt with id, version, locale, input/output schema, changelog | Changing a prompt requires a version bump; old version still callable during canary | NOT RUN | Registry exists with 8 prompt IDs per `docs/ai-eval-baseline.md:67` |
| v0.5-02 | AI-02 structured output validation | P1 | Pydantic response models reject malformed provider output; `INVALID_AI_OUTPUT` error code returned; no raw LLM HTML executed | Schema-valid cases pass; schema-invalid cases fail closed with audit | NOT RUN | — |
| v0.5-03 | AI-03 cost accounting | P1 | `record_usage()` called from every router; `provider_attempts` rows populated; budget hook enforced; kill switch fails closed | Actual cost visible per feature/model; budget exceeded → request rejected | NOT RUN | Routers do not call `record_usage()` today per `docs/sprint5-report.md:32` |
| v0.5-04 | AI-05 eval golden dataset | P1 | `apps/ai-service/evals/` contains 100+ synthetic/licensed cases; evaluator command recorded with HEAD SHA, exit code, timestamp; quality score meets threshold | Deterministic checks (schema, `mustDetect`, `mustNotClaim`) 100%; human-labeled rubric meets owner-set threshold; LLM-as-judge advisory only | NOT RUN | Template exists at `docs/ai-eval-baseline.md`; dataset NOT AVAILABLE |
| v0.5-05 | AI router by evidence | P2 | Model router selects provider/model based on feature, cost, quality evidence; switching model does not regress eval score | Eval report before/after model change shows no quality regression | NOT RUN | — |
| v0.5-06 | No learning-efficacy claim | P0 | `docs/pilot-policy.md` section 6 enforced; no UI copy, report, or README claims improved learning outcomes without section 6.3 evidence bar met | Public position: "no verified learning-efficacy claim" until pre/post study approved | PASS (policy) | `docs/pilot-policy.md:122` states the position |
| v0.5-07 | v0.5 sprint gate | P1 | Each AI feature has prompt/model version, cost metadata, eval baseline; model change does not break contract; real cost known before large quota | AI quality release blocked until gates PASS | NOT MET | — |

---

## 5. v0.6 — Scalable

Roadmap line 1100: "Report multi-instance/load tests, đúng invariant, bottleneck đã đo."

| # | Gate | Priority | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|---|
| v0.6-01 | PERF-02 horizontal scaling lab | P1 | Two-instance Compose lab per `docs/horizontal-scaling.md`; T01–T10 executed | SSE reconnect to different instance recovers terminal state; idempotency keys prevent duplicate provider calls across instances; token reserve/settle/refund atomic; upload on A visible on B | NOT RUN | Lab design exists; not executed |
| v0.6-02 | PERF-01 load test report | P1 | `docs/load-test-plan.md` workload steps 0–6 executed on staging; `docs/benchmarks/` contains measured report with HEAD SHA, tool version, VU, duration, p50/p95/p99, error breakdown, invariant check | SLO met at target VU; 5xx < 1%; zero invariant violations; bottleneck identified and recorded | NOT RUN | Plan exists; no tool installed; no measurement |
| v0.6-03 | Invariant preservation under load | P0 | `token_reconciliation_mismatches_total = 0` after every load step; one operation key = one debit; one review event per (card, operationId) | No invariant violation at any load level | NOT RUN | — |
| v0.6-04 | Bottleneck measured | P1 | DB pool wait, queue depth, RSS, event-loop lag recorded; first SLO breach point identified | Bottleneck documented with metric evidence; capacity plan written | NOT RUN | — |
| v0.6-05 | SEC-06 distributed rate limiter | P1 | Shared Redis-backed limiter; two-instance test returns 429 on the second instance after limit exhausted on the first | Horizontal-scaling T09 passes (currently expected FAIL per `docs/horizontal-scaling.md:93`) | NOT RUN | Known gap |
| v0.6-06 | v0.6 sprint gate | P1 | Load test report exists; invariants hold; bottleneck measured; multi-instance lab PASS | Scalable release blocked until gates PASS | NOT MET | — |

---

## 6. v1.0 — Adaptive Learning

Roadmap line 1101: "Learning loop pilot, validated UX/quality, privacy và payment gate nếu có monetization."

| # | Gate | Priority | Command / evidence | Pass condition | Status | Evidence |
|---|---|---|---|---|---|---|
| v1.0-01 | PRODUCT-01/02 — placement and knowledge map | P1 | Placement attempt, knowledge items with evidence, learner profile; schema and service exist; E2E test passes | Learner can complete placement; knowledge items track evidence_count, last_practiced_at | NOT RUN | — |
| v1.0-02 | PRODUCT-03 — mastery model MVP | P1 | Mastery heuristic with confidence based on evidence_count; no "mastered" label after one correct answer; test covers success/failure, fractional score, duplicate event, missing evidence, language isolation | Mastery changes are evidence-based; no duplicate evidence counting | NOT RUN | — |
| v1.0-03 | PRODUCT-04 — daily plan generation | P1 | Plan selects weak evidence knowledge; respects daily budget; re-plans after attempt | Plan is reproducible given the same profile; attempt updates plan | NOT RUN | — |
| v1.0-04 | PRODUCT-05 — error-to-flashcard pipeline | P1 | Error detected → knowledge item linked → evidence recorded → flashcard suggested; FSRS review updates progress; evidence not double-counted | Full pipeline E2E test passes | NOT RUN | — |
| v1.0-05 | PRODUCT-06 — pilot with validated UX | P0 | `docs/pilot-policy.md` fully implemented; consent gate, analytics whitelist, withdrawal path tested; pilot report labels observations as exploratory with participant count and "not evidence of efficacy" line | All section 7 checkboxes ticked; no efficacy claim | NOT RUN | — |
| v1.0-06 | PRODUCT-06 — pre/post assessment | P0 | Assessment designed before results; accounts for self-selection; sample size and uncertainty reported; independent reviewer; public wording approved | Evidence bar in `docs/pilot-policy.md` section 6.3 met | NOT RUN | — |
| v1.0-07 | PRODUCT-07 — payment gate (if monetization) | P1 | If monetization is enabled: payment provider verified, sandbox tested, receipt and refund work, legal conditions met; if not enabled, route stays disabled | No public minting of tokens; payment verification exists before credit grant | NOT RUN | BUG-01 still open |
| v1.0-08 | Learning loop end-to-end | P0 | Learner completes placement → plan → attempt → feedback → review → reassessment in one session; mastery changes with evidence; pilot feedback and eval report exist | Full vertical slice works; no duplicate evidence; pilot report is real | NOT RUN | — |
| v1.0-09 | Portfolio deliverables complete | P1 | README, ADR-001..005, sequence diagrams, ERD, testing report, load test report, AI eval report, cost report, demo video, CV bullets — all present per roadmap line 1182–1188 | Every deliverable exists; CV bullets describe only what was implemented/tested | NOT RUN | — |
| v1.0-10 | v1.0 sprint gate | P0 | All P0 gates PASS; pilot feedback and eval report exist; privacy and payment gates satisfied | v1.0 release blocked until gates PASS | NOT MET | — |

---

## 7. Cross-cutting gates (apply to every release)

| # | Gate | Priority | Command / evidence | Pass condition | Status |
|---|---|---|---|---|---|
| X-01 | Definition of Done met for every merged slice | P0 | Each PR since last release has acceptance criteria verified by test or evidence; build/type-check/lint pass; critical integration tests pass; no secret/PII added; migration has rollback plan; docs updated with source | Every merged PR satisfies `LinguaAI_Engineering_Roadmap.md` lines 1169–1178 | NOT RUN |
| X-02 | CI pipeline green on `main` | P0 | `.github/workflows/ci.yml` run on `main` exits 0; integration, build, browser-e2e jobs added per `docs/ci-policy.md` section 7.2 | All required jobs PASS | NOT RUN | CI is unit-only today per `docs/sprint8-report.md:31` |
| X-03 | Secrets scan clean | P0 | `node scripts/check-secrets.mjs` exits 0; gitleaks/trufflehog clean on commit range | No provider-shaped key, private key block, or credential assignment in source | NOT RUN |
| X-04 | No `.env` file committed | P0 | `git ls-files --cached --others --exclude-standard \| grep -E '(^\|/)\.env$'` returns nothing | CI rejects tracked `.env` files per `.github/workflows/ci.yml:64-70` | NOT RUN |
| X-05 | Migration safety | P0 | Every migration follows expand → migrate/backfill → switch → contract per `docs/migration-safety.md`; destructive migration has pre-migration backup (E3) and isolated restore test (E1/E2) | No data loss; rollback target compatible with post-migration schema | NOT RUN |
| X-06 | Data retention compliance | P1 | `docs/data-retention.md` gaps closed; `ScheduledDeleteService` calls `purgeUserData()`; raw-SQL rows and owned objects deleted; financial/audit carve-out applied | Deletion lifecycle in `docs/data-retention.md` section 3 works end-to-end | NOT RUN |
| X-07 | Provider retention verified | P1 | Groq STT, Groq LLM, Google Translate TTS retention and no-training terms documented per `docs/data-retention.md` section 5 | Provider contracts/DPAs recorded; affected features excluded from pilot until verified | NOT RUN |
| X-08 | Flaky-test policy followed | P1 | Every flaky test has an issue with owner/cause/plan; Playwright retries ≤ 1; quarantine applied after 3 failures in 7 days | `docs/ci-policy.md` section 4 followed | NOT RUN |
| X-09 | Coverage baseline measured | P2 | `pnpm --filter api test -- --coverage --runInBand`, `pnpm --filter web test:run -- --coverage`, `pytest --cov=app` run; baseline recorded; critical paths (`tokens`, `auth`, `srs`, `chat`, `ai-service/routers`) tracked | Baseline exists; threshold enforcement per `docs/ci-policy.md` section 3.4 phased in | NOT RUN |

---

## 8. Waiver register

No waivers have been granted. When a P1/P2 gate is waived, record it here:

| Gate | Waived by | Rationale | Compensating control | Expiry |
|---|---|---|---|---|
| — | — | — | — | — |

P0 gates cannot appear in this table. If a P0 gate is blocked, the release is blocked.

---

## 9. CHAT-04 T01–T20 attribution

Source: `apps/api/test/chat-billing.e2e-spec.ts`, `apps/api/test/chat-billing-orchestrator.spec.ts`, `apps/web/src/lib/sse-parser.spec.ts`, `apps/api/test/fixtures/chat-billing.fixture.ts`.

| Test | Where it lives | Current status |
|---|---|---|
| T01 Balance sufficient, fake LLM success | `chat-billing.e2e-spec.ts` named case + orchestrator generic success/commit | CONTRACT ONLY — DB E2E NOT RUN |
| T02 Insufficient balance | `chat-billing.e2e-spec.ts` named case | CONTRACT ONLY — DB E2E NOT RUN |
| T03 Invalid language | `chat-billing.e2e-spec.ts` named case | CONTRACT ONLY — DB E2E NOT RUN |
| T04 Other user's conversation | `chat-billing.e2e-spec.ts` named case | CONTRACT ONLY — DB E2E NOT RUN |
| T05 Same key/payload sequential replay | `chat-billing.e2e-spec.ts` named case + orchestrator `findOrCreate` idempotence | CONTRACT ONLY — DB E2E NOT RUN |
| T06 Same key concurrent | `chat-billing.e2e-spec.ts` named case + operation service `claimLease` | CONTRACT ONLY — DB E2E NOT RUN |
| T07 Same key different payload | `chat-billing.e2e-spec.ts` named case + orchestrator in-memory variant | CONTRACT ONLY — DB E2E NOT RUN |
| T08 Same key different user | `chat-billing.e2e-spec.ts` named case | CONTRACT ONLY — DB E2E NOT RUN |
| T09 Provider timeout before delta | `chat-billing-orchestrator.spec.ts` (in-process, not DB E2E) | CONTRACT SPEC ONLY — no timed provider/DB run verified |
| T10 Provider error after delta | `chat-billing-orchestrator.spec.ts` + web parser spec | CONTRACT SPEC ONLY — UI/DB run not verified |
| T11 Disconnect before commit | `chat-billing.e2e-spec.ts` + orchestrator cancelled-before-commit + web parser abort handling | CONTRACT ONLY — DB E2E NOT RUN |
| T12 Disconnect after commit before completed | `chat-billing.e2e-spec.ts` + orchestrator immutable-SUCCEEDED | CONTRACT ONLY — DB E2E NOT RUN |
| T13 Crash after reserve before provider | `chat-billing.e2e-spec.ts:534` named case + `chat-billing-orchestrator.spec.ts` | CONTRACT ONLY — DB E2E NOT RUN |
| T14 Crash after provider before commit | `chat-billing.e2e-spec.ts:593` named case + orchestrator UNKNOWN/reconcile | CONTRACT ONLY — DB E2E NOT RUN |
| T15 Two turns on one conversation | `chat-billing.e2e-spec.ts:641` named case (notes contract gap in `ChatController.reserveOperation` fencing) | CONTRACT ONLY — DB E2E NOT RUN |
| T16 Redis down | `chat-billing.e2e-spec.ts:691` named case using `outage` toggle in `chat-billing.fixture.ts:161` | CONTRACT ONLY — DB E2E NOT RUN |
| T17 P2034 during reserve/finalize | `tokens.service.spec.ts` (unit) — no specifically named T17 E2E invocation verified | NOT RUN as E2E; unit coverage exists |
| T18 Repeated refund | `chat-billing.e2e-spec.ts:731` named case + refund ledger key/fencing in operation service | CONTRACT ONLY — DB E2E NOT RUN |
| T19 SSE chunk split, Unicode preserved | `chat-billing.e2e-spec.ts:777` named case + `apps/web/src/lib/sse-parser.spec.ts` byte-by-byte multi-byte chunks | PARTIAL (web unit PASS) / API DB E2E NOT RUN |
| T20 EOF without completed | `chat-billing.e2e-spec.ts:825` named case + `apps/web/src/lib/sse-parser.spec.ts` EOF/`[DONE]` incomplete assertion | PARTIAL (web unit PASS) / API DB E2E NOT RUN |

---

## 10. Revision history

| Date | Change | Author |
|---|---|---|
| 2026-11-28 | Initial version. Gates derived from roadmap 13.1, neighbouring policies, and current baseline at HEAD `3be6aa3`. No gate is marked PASS on the strength of file presence or unit-suite totals alone. | Release-checklist slice (rel-45) |
