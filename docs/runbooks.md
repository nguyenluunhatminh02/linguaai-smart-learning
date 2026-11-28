# Operational alert runbooks (OPS-13)

Status labels, consistent with `docs/reliability.md` and `docs/backup-restore.md`:

- **CURRENT** — observable in the checked-in code/config on this branch.
- **TARGET** — roadmap intent or a proposed threshold/metric that requires wiring or an operator decision. TARGET is **not** a claim that an alert, dashboard, or CLI already exists.

Source of truth: `LinguaAI_Engineering_Roadmap.md` OPS-03 (lines 915–935), BILL-03/04 (232–319), REL-01/03 (475–542), AI-03 (699–704), DB-05 (650–658), PERF-01 (937–955), plus the code paths cited in each runbook. All six alerts below are required by OPS-03 line 934; line 935 requires symptoms, checks, mitigation, recovery and owner for each. This document is documentation only — it adds no code, alerts, dashboards, env vars, or package dependencies.

## 0. Shared operating rules

1. **Declare before acting.** Record UTC time, alert name, affected environment, route/feature (bounded labels only), request ID or operation ID when available, and the ticket owner. Never paste a raw URL, email, prompt, audio, JWT, API key, `.env` value, provider error string, or full user identifier into a ticket, chat, log, or metric label.
2. **Do not restart everything.** OPS-03 line 935 explicitly forbids indiscriminate restarts. Diagnose by class first; a restart without a recorded hypothesis can destroy in-flight leases and make ledger/operation reconciliation harder.
3. **PostgreSQL is authoritative.** Credit balances (`token_transactions`, `user_token_balance`), operation state (`ai_operations`) and outbox rows (`outbox_events`) win over Redis/job state. Losing Redis must not change money, terminal state or ownership (`docs/reliability.md` §1).
4. **No silent repair.** Never manually edit a balance, refund twice, skip a ledger idempotency key, force a terminal transition, or disable verification to clear an alert. Corrections are compensating ledger entries under deterministic keys (`op:<user>:<operationId>:debit|settle`, `refund:aiop:<operationId>`); ambiguous provider outcomes require explicit reconciliation (`docs/reliability.md` §3.4, BILL-04 line 318).
5. **Bounded labels.** Metrics may use route template, method, status, feature, model, provider, outcome, queue, type, reason, state or pool only. User IDs, request IDs, raw URLs, emails and free-text error strings are forbidden as labels (OPS-03 lines 926, 933).
6. **Escalation:** API/platform on-call is the default owner. Security owner takes wrap-key/KMS and credential cases; billing owner takes ledger/refund policy decisions; data owner takes destructive-migration/restore cases. Any money movement or feature kill switch requires a second person's approval recorded in the ticket.
7. **Clear criterion:** an alert is cleared only when the triggering condition is absent on a fresh check and the ticket records the evidence (metric value, manifest id, operation id) and time. If evidence is missing, leave the alert open.

## Alert index and proposed trigger baselines

All thresholds in this table are **TARGET proposals**, not configured rules. PERF-01 line 947 gives the only roadmap error objective: API server errors <1% under target load, excluding intentional 4xx and reporting 429 separately. Baseline the thresholds against staging traffic before enabling paging; tune from measured steady-state, not from a guess.

| Alert | Proposed trigger | Proposed severity | Primary signal | Details |
|---|---|---|---|---|
| `ledger mismatch` | any mismatch, i.e. `increase(token_reconciliation_mismatches_total[10m]) > 0`; page immediately | Critical | `token_reconciliation_mismatches_total{type="<bounded-type>"}` | §1 |
| `operation stuck` | nonterminal operation past deadline: `RESERVED`/`RUNNING` with `lease_until < now()` for > 2× `DEFAULT_LEASE_TTL_MS` (60 s), or `ai_operations_inflight{state="UNKNOWN"}` growing for 15 min | High | `ai_operations_inflight{feature,state}` + DB sweep | §2 |
| `sustained 5xx/429` | 5xx ratio > 1% over 10 min with ≥ 100 requests, or 429 ratio > 5% over 5 min; both must be reported separately | High | `http_request_duration_seconds_count{route,method,status}` | §3 |
| `queue lag / backlog` | oldest `PENDING` outbox age > 5 min, `FAILED` rows increasing, or `ai_operations_inflight{state="RESERVED"}` rising for 15 min | High | outbox counts + `ai_operations_inflight`; queue depth is TARGET | §4 |
| `budget limit` | per-user/day or global/day counter ≥ 80% of cap (warn) or 100% (page); kill switch active for any feature (info + audit) | High at 100% | Redis daily counters + server-side pricing catalog | §5 |
| `backup failed` | per `docs/backup-restore.md` §7: non-zero job, missing/malformed manifest, digest/GCM mismatch, S3/KMS error, missing off-host replica, or no verified manifest for > 24 h | Critical | scheduler + manifest `verify` | §6 |

## 1. `ledger mismatch`

### Symptoms

- `token_reconciliation_mismatches_total` increases (TARGET metric wiring; the hook exists as `onMismatch` in `apps/api/src/tokens/tokens-reconciliation.service.ts`, but the alert producer is not yet registered).
- `TokensReconciliationService.reconcileUser()` returns a `Mismatch` with `difference = actualBalance - expectedBalance`, where `expectedBalance = openingBalance + SUM(token_transactions.amount)` as of a fixed `asOf` (`tokens-reconciliation.service.ts:85–136`). The service logs a warning containing the user id; never copy that log line into a shared ticket verbatim.
- Users report balance changing unexpectedly, or a 403 `INSUFFICIENT_CREDITS` where credits should exist.

### Checks

1. Confirm the baseline: `ReconciliationReport.baseline` records whether an `openingBalance` was supplied. The current default baseline is **0**; a nonzero legacy opening balance produces false mismatches (`tokens-reconciliation.service.ts:248–264`). Fix the baseline policy, not the balance.
2. Inspect the per-user report with a bounded artifact: record `difference`, `checkedEntries`, `expectedBalance` and `actualBalance`; keep the user id only in the access-controlled incident record.
3. Check for in-flight operations: a debit may legitimately exist while a settle/refund has not committed. Re-run reconciliation with an earlier `asOf` or after the operation reaches a terminal state before declaring a real mismatch (BILL-04 concurrency false-positive risk).
4. Look for orphan debits/refunds: every operation debit must map to one of the deterministic keys `op:<user>:<operationId>:debit|settle` or `refund:aiop:<operationId>` (`apps/api/src/tokens/tokens.service.ts:842–870`). Check that refund rows have a matching debit and that no key is duplicated (`idempotency_key` is unique).
5. Check `ai_operations` for terminal rows with `charged_credits > reserved_credits` and for `UNKNOWN` rows whose refund decision is `requires_reconciliation` (`apps/api/src/ai-operations/ai-operations.policy.ts:93–96, 184–202`).
6. Confirm the report used keyset pagination (`pageSize` clamped to 1–1000) and a single `asOf`; a full scan under concurrent writes without a fixed `asOf` is not evidence.

### Mitigation

- If the mismatch is fully explained by the zero-baseline assumption or by in-flight operations, correct the reconciliation inputs and close as false positive with the recorded explanation.
- Stop new billable work for the affected feature only if the divergence is growing (see §5 for the kill-switch policy, which is TARGET). Do **not** pause the whole API.
- For a confirmed missing refund, use the existing at-most-once refund path keyed by `refund:aiop:<operationId>` (`tokens.service.ts:1186–1297`) under billing-owner approval. Never insert a positive ledger row directly or reuse a different key.
- For a duplicated debit, do not delete rows. Write a compensating refund entry with a distinct, documented idempotency key under the same deterministic namespace and retain the audit trail.
- If the cause is not understood, freeze manual balance changes and escalate to the billing owner. Reconciliation is read-only by design; it will not "fix" anything.

### Recovery

Re-run reconciliation for the affected users with the correct baseline and a fixed `asOf`; confirm `difference = 0`, no duplicate ledger keys, and no terminal operation with `charged_credits > reserved_credits`. Record the manifest/report id, the compensating entry keys (no user ids in shared channels), approval names, and UTC clear time. Add a regression test or a tooling blocker for the root cause before closing the incident.

### Owner

Primary: billing on-call with API/platform on-call. Second person approval required for any compensating entry. Security owner if log/metric hygiene is breached.

## 2. `operation stuck`

### Symptoms

- `ai_operations_inflight{feature,state}` shows `RESERVED` or `RUNNING` rows older than the deadline, or `UNKNOWN` rows accumulating. CURRENT: the schema has `lease_until`, `lease_token`, `version`, `attempt_count` and `RESERVED → RUNNING → SUCCEEDED/FAILED/UNKNOWN/CANCELLED` (`apps/api/prisma/schema.prisma`; `ai-operations.policy.ts:64–78`). A scheduled recovery sweeper is **TARGET** (the plan's `recovery.service.ts` is not in scope here).
- Users poll `GET .../operations/:operationId` and never see a terminal event; SSE clients see `accepted`/`delta` but no `completed`/`failed`. EOF is not completion, and a partially streamed response must not be replayed as success (`docs/reliability.md` §2.3).
- Queue worker logs show a crashed/restarted worker holding a lease.

### Checks

1. For each suspect operation id: read `status`, `lease_until`, `lease_token`, `attempt_count`, `version`, `error_code`, `reserved_credits`, `charged_credits`. Do not read or copy prompt/audio payloads.
2. Compare age against `AiOperationsPolicy.DEFAULT_LEASE_TTL_MS = 60_000` and `DEFAULT_MAX_ATTEMPTS = 3` (`ai-operations.policy.ts:106–108`). Confirm the lease is genuinely expired rather than actively renewed.
3. Verify the operation has not reached a terminal state; terminal states never transition back (`ai-operations.policy.ts:64–78`).
4. Check whether a provider result exists for reconciliation. `PROVIDER_TIMEOUT` and `OPERATION_UNKNOWN` are ambiguous: refund decision is `requires_reconciliation`, never automatic (`ai-operations.policy.ts:93–96, 195–196`). Known failures in `REFUNDABLE_ERROR_CODES` may be refunded exactly once via the deterministic key.
5. Check the outbox row for the same operation (`OutboxRepository.findByOperationId`, `apps/api/src/queue/outbox.repository.ts:321–329`): `PENDING`, `CLAIMED` with expired lease, `PUBLISHED`, or `FAILED`.
6. Check whether circuit breakers are open for the provider/model (`CircuitBreakerService.getState`, `apps/api/src/common/services/circuit-breaker.service.ts:216–219`). An open circuit explains stalled retries but is not a reason to force state changes.

### Mitigation

- If the lease is still live, wait; do not manually clear it. A stale worker must not commit after lease loss (`canFinalize` enforces token + deadline + attempt budget, `ai-operations.policy.ts:158–177`).
- If the lease is expired and a valid provider result exists, finalize through the normal transactional path with version/lease fencing; do not bypass the service.
- If the lease is expired with no result and the error is known/refundable, transition to `FAILED` with the single deterministic refund; if ambiguous, transition to `UNKNOWN` and route to manual reconciliation. Never mark `UNKNOWN` as success.
- If a genuine recovery sweeper exists (TARGET), run it in bounded batches and confirm it uses `findExpired`/`markUnknown`/`markTerminal` with lease+version fencing; two concurrent sweeps must not double refund. If it does not exist, perform the transition only through the reviewed admin/service path and record the tooling gap as a blocker.
- Do not restart all workers. If one worker is wedged, isolate it and let its leases expire so a single healthy worker can reclaim them.

### Recovery

Confirm each affected operation reaches `SUCCEEDED`, `FAILED`, `UNKNOWN` (with a reconciliation ticket) or `CANCELLED`, with `charged_credits <= reserved_credits` and at most one refund per operation. Confirm no stale worker committed a late result. Record operation ids, final states, refund keys, approvers and UTC clear time. No transcript, raw provider string or user id in shared logs/tickets.

### Owner

Primary: AI operations/platform on-call. Billing owner for refunds and `UNKNOWN` reconciliation decisions.

## 3. Sustained 5xx / 429

### Symptoms

- Sustained 5xx above the PERF-01 objective (<1% excluding intentional 4xx, 429 reported separately) or 429 above the proposed 5% warn line, on one or more route templates.
- Clients receive allowlisted codes such as `RATE_LIMITED` (429), `PROVIDER_UNAVAILABLE` (503), `PROVIDER_TIMEOUT` (503/504 — canonical status is an open decision in `docs/reliability.md` §2.2) or `INTERNAL_ERROR` (500). Never use raw `String(err)` as evidence (`docs/reliability.md` §1, §2.2).
- Circuit breaker logs show `CLOSED -> OPEN` / `OPEN -> HALF_OPEN` for a provider/model (`circuit-breaker.service.ts:98–210`).

### Checks

1. Split the error budget by exact status using `http_request_duration_seconds_count{route,method,status}` from `MetricsMiddleware.prometheus()`/`snapshot()` (`apps/api/src/common/middleware/metrics.middleware.ts:123–169, 279–287`). CURRENT: the collector and route-template normalization exist; registration/wiring and a scrape route are TARGET for a separate slice, so confirm they are actually applied before trusting the dashboard.
2. Check the `__overflow__` series and `overflowed` flag: if set, route labels are capped (`METRICS_MAX_SERIES`, default 500) and per-route attribution is incomplete (`metrics.middleware.ts:44–48, 100–110, 319–324`).
3. Check 429 responses separately. CURRENT: `RateLimiterService` throws 429 on quota exhaustion with `retryAfterSeconds` derived from Redis TTL, and 503 when Redis fails under the default fail-closed policy (`apps/api/src/common/services/rate-limiter.service.ts:109–149, 184–215`). A 503 spike with rate-limit log messages means Redis is unavailable, **not** a provider outage; do not change the limiter semantics to hide it.
4. Check provider/model circuit states and the failure classifier: aborted and non-retryable errors do not count toward threshold (`circuit-breaker.service.ts:77–86`). The breaker is in-process (single deployment) and metrics callbacks are optional; do not assume cross-instance state.
5. Check FastAPI health and error envelope (`apps/ai-service/app/main.py`, `apps/ai-service/app/core/exceptions.py`) and correlate with `X-Request-ID`/`X-AI-Operation-ID` headers (`docs/reliability.md` §1.5).
6. Check DB pool wait (`db_pool_wait_seconds` is a TARGET metric) and Redis health before blaming the provider; saturation can present as 5xx/503.

### Mitigation

- For genuine 429: apply backoff honoring `Retry-After`; reduce client concurrency for the affected feature/identity. Do not raise limits to silence the alert without a capacity review. Check for a single misbehaving identity only through access-controlled logs.
- For Redis-caused 503 (fail-closed): restore the Redis dependency/connection budget; never switch AI write routes to fail-open.
- For provider 5xx/timeouts: reduce concurrency or use the feature-specific kill switch (§5, TARGET) and let the breaker cool down. A half-open probe success closes the circuit; forcing `reset()` on all circuits without evidence discards the signal.
- For 500s tied to a recent deploy: roll back the app image behind the existing additive-migration/rollback policy (`docs/reliability.md` §5); do not roll back a schema by hand.
- Never add user ids, request ids, raw URLs or raw error strings to metric labels while debugging (OPS-03 line 933).

### Recovery

Confirm the 5xx ratio is below the PERF-01 objective over a full evaluation window, 429 is reported as its own series, the circuit is `CLOSED` (or deliberately open with an incident ticket), and no high-cardinality labels were introduced. Record route template, status split, provider/model state, decision and UTC clear time.

### Owner

Primary: API/platform on-call. Provider/vendor liaison for upstream incidents; security owner if the spike follows an abuse pattern.

## 4. Queue lag / backlog

### Symptoms

- `ai_operations_inflight{feature,state="RESERVED"}` rises while `SUCCEEDED`/`FAILED` does not; outbox `PENDING`/expired `CLAIMED` rows age; `FAILED` outbox rows accumulate.
- Worker absence or death after claiming jobs; duplicate enqueue attempts; poison jobs; provider 429 backoff extending job duration. REL-03 line 542 requires tests for exactly these cases.

### Checks

1. Inspect outbox counts by `status` (`PENDING`, `CLAIMED`, `PUBLISHED`, `FAILED`) and the age of the oldest `PENDING` row. CURRENT: `OutboxRepository` implements claim/publish/fail/reconcile with fenced leases and `MAX_ATTEMPTS = 5` (`apps/api/src/queue/outbox.repository.ts:10–15, 72–79, 139–307`). There is **no** admin depth endpoint and no pinned `bullmq` dependency (`docs/reliability.md` §3.1); a `GET /admin/queue/depth` and real queue depth (`getJobCounts`) are TARGET.
2. Check expired `CLAIMED` rows (`findExpiredClaimed`) and whether `reconcilePending()` is returning them to `PENDING` (`outbox.repository.ts:240–307`).
3. Confirm payloads are IDs-only and versioned (`QueueJobPayload`, `ALLOWED_PAYLOAD_KEYS`, `AI_OPERATION_QUEUE_PAYLOAD_VERSION = 1`, `apps/api/src/queue/queue.service.ts:30–73`). If a row contains prompt text, secrets or audio, treat it as a security incident, not a lag incident.
4. Confirm enqueue uses `jobId = operationId` for transport deduplication and that DB state (lease/version/terminal transitions) remains authoritative (`queue.service.ts:90–93`). Duplicate enqueue must not double charge or double settle.
5. Check the worker's attempt budget and backoff (`QUEUE_INITIAL_BACKOFF_MS = 1000`, `QUEUE_BACKOFF_CAP_MS = 30_000`, retention counts 1000, `queue.service.ts:56–63`) and whether a poison job is stuck in retry.
6. Check provider 429 and circuit state (§3) as the upstream cause of growing delay.

### Mitigation

- If outbox rows are `PENDING` and no publisher is running, start **one** publisher instance; `FOR UPDATE SKIP LOCKED` supports concurrent scanners but unbounded replicas increase DB load (`outbox.repository.ts:139–160`).
- If rows are `CLAIMED` with expired leases, run bounded lease reconciliation so they return to `PENDING`; do not delete rows.
- If rows are `FAILED` after 5 attempts, do not bulk-retry. Quarantine the operation ids, identify allowlisted `last_error` codes, and require policy/owner approval for a manual retry that is audited (REL-03 line 540).
- If the queue transport is unavailable, leave the rows replayable and disable publisher/worker per the queue rollback rule (`docs/reliability.md` §5). Do not mark them `PUBLISHED` to clear the backlog.
- Scale only after checking the DB connection budget and avoiding fixed `container_name`/host ports for replicas (roadmap PERF-02, line 957).

### Recovery

Confirm the backlog drains, `jobId = operationId` prevented duplicate settlement, no operation was charged twice, and all outbox rows are `PUBLISHED` or have a documented `FAILED` disposition. Record queue names, counts, oldest age, retry decisions, approvers and UTC clear time.

### Owner

Primary: queue/worker on-call (API/platform). Billing owner if any duplicate charge is suspected.

## 5. `budget limit` (and feature kill switch)

### Symptoms

- Per-user/day or global/day AI spend approaches or exceeds the configured cap; users receive 429 `RATE_LIMITED`-class responses or 403 `INSUFFICIENT_CREDITS`; provider attempts continue when they should stop.
- A feature kill switch is active and that feature's operations stop being accepted.

### Checks

1. Confirm the source of prices is server-side only: `AiOperationsPolicy.getCost()`/`AI_OPERATION_COSTS` (`ai-operations.policy.ts:110–116`) and `TokensService.PRICING_CATALOG` (`apps/api/src/tokens/tokens.service.ts:50, 120–125`). No client-supplied price may enter a reserve/settle path (BILL-04 line 316).
2. Check the UTC-day boundary of any counter. CURRENT: budget counters, the global gate and kill-switch endpoints are **TARGET** (roadmap AI-03 lines 699–704); `RedisService.incrWithExpiry` and the fail-closed rate limiter are existing building blocks (`rate-limiter.service.ts:55–60`). Do not claim a budget gate exists until it is wired.
3. Check `ai_provider_tokens_total{model,direction}` and provider usage records. Missing provider usage must be marked unknown/estimated, never fabricated (AI-03 line 702).
4. Check whether the spike is one identity, one feature, one model, or global. Use bounded labels; keep identity analysis in access-controlled logs.
5. Check for credential abuse or a runaway retry loop (circuit state, §3) before assuming organic growth.
6. Check whether any fallback model is schema-compatible and within budget; fallbacks are allowed only under those conditions (REL-01 line 483).

### Mitigation

- At 80% of a cap: warn the owner and reduce concurrency/backoff for that feature; do not silently raise the cap.
- At 100%: stop new billable operations for the offending user or feature (kill switch per AI-03 line 703, TARGET), keep in-flight operations bounded, and let the circuit cooldown run. Preserve at-most-once billing semantics; no debit without an operation id.
- If the counter is wrong (UTC boundary, TTL, or multi-instance mismatch), fix the counter implementation under a reviewed change and reconcile spend from the ledger; do not disable the gate globally to restore service.
- Never read or print provider keys or `.env` values while investigating spend anomalies.

### Recovery

Confirm spend counters use server-side pricing and UTC boundaries, the kill switch is cleared with an audited decision, and the ledger still matches (§1). Record the cap, observed usage, feature/model, decision, approvers and UTC clear time. If the gate was never implemented, leave the alert in a documented "no producer" state rather than inventing evidence.

### Owner

Primary: AI cost owner with API/platform on-call. Security owner for suspected abuse/credential compromise.

## 6. `backup failed`

This alert's full contract is already defined in `docs/backup-restore.md` §7. Summarize it here for OPS-03; follow that document for the backup CLI, manifest schema, retention matrix and restore drill steps.

### Symptoms

- Scheduler exit non-zero; no new verified manifest under today's prefix; `verify --manifest-id <id>` rejects the newest manifest; S3/KMS error; missing off-host replica; retention sweep denied; no verified manifest for > 24 h.

### Checks

1. Scheduler run history and newest manifest id/`createdAt` (`docs/backup-restore.md` §3.1). CURRENT: the backup CLI, workflow and drill evidence log are TARGET, so confirm the job actually exists in the environment before treating a missing alert as success.
2. `verify --manifest-id <id>`: manifest schema version, ciphertext `sizeBytes`/`sha256`, IV/tag lengths and GCM tag (`docs/backup-restore.md` §4). Never disable verification.
3. Bucket object/version list and off-host replica presence; object-lock/KMS denial metadata only, no secrets.
4. For a destructive migration, confirm a `reason=pre-migration` manifest exists and was retained (roadmap DB-05 line 656; `docs/backup-restore.md` §5.1).

### Mitigation

- Run one manual backup immediately with the documented CLI procedure (`docs/backup-restore.md` §3.2). Never pass passwords on a command line or read `.env` values.
- If upload fails, switch to the secondary bucket/role per incident procedure; if the key id is wrong, use the correct `keyId` from the secret store. Never bypass digest/GCM verification or delete objects to "fix" retention denial.
- If no verified manifest can be produced, freeze destructive migrations and start the restore-drill path (`docs/backup-restore.md` §6) only if actual recovery is needed; a dump alone does not reconstruct Redis state or local upload bytes (§1.2).

### Recovery

Confirm a verified manifest exists with id and timestamp, clear the alert, and update the drill/evidence log. If a restore was performed, complete the structural/invariant checks and sign-off in `docs/backup-restore.md` §6–8. Record manifest id, reason, owner, approver and UTC clear time.

### Owner

Primary: platform/on-call owner. Security owner for wrap-key/KMS failures; data owner for destructive-migration and restore decisions.

## Open decisions / blockers for other slices

- No Prometheus/Grafana scrape endpoint or alert rules are registered in this slice; `MetricsMiddleware.prometheus()` is a collector only (`metrics.middleware.ts:279–280`). Alert producers and dashboards are outside this docs-only change.
- `token_reconciliation_mismatches_total`, `ai_operations_inflight`, `db_pool_wait_seconds` and queue-depth metrics need producers and bounded label wiring before the proposed triggers can fire.
- Canonical `PROVIDER_TIMEOUT` status (503 vs 504) and NestJS `OPERATION_UNKNOWN`/`INVALID_AI_OUTPUT` mapping remain open (`docs/reliability.md` §2.2, §9).
- Budget counters, global gate, kill-switch endpoints, queue depth endpoint and scheduled operation recovery sweeper are roadmap TARGET items, not checked-in code.
- Backup CLI, workflow, `docs/restore-drill-log.md` and RTO/RPO measurements are TARGET (`docs/backup-restore.md` §9). All thresholds in this document are proposals requiring a baseline and service-owner sign-off.
