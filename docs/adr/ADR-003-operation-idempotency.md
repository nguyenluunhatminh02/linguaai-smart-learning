# ADR-003: Operation idempotency

- Status: Proposed (roadmap slice rel-38)
- Date: 2026-11-28
- Scope: every billable AI turn (chat, writing, reading, grammar, listening, quiz, translation, speaking, learning path, cards), its token debit/refund, its SSE contract and its crash/reconnect recovery.
- Related: CHAT-01/02, BILL-03/04/05 in `LinguaAI_Engineering_Roadmap.md`; `docs/reliability.md`, `docs/horizontal-scaling.md`, `docs/runbooks.md`.

## Context

A paid AI turn crosses three systems that can each fail independently: the API worker (NestJS), the database/ledger (PostgreSQL) and the model provider (FastAPI service plus upstream model). A retry, a browser reconnect or a worker crash can therefore leave the user charged without an answer, answered without a persisted message, or answered twice. Existing billing call sites show the failure: `/chat/send` debits with a user-scoped header while `/chat/stream` runs the same paid turn uncharged, the web client persists replies outside the workflow, and several routes either accept no key at all or namespace it inconsistently (`docs/billing-call-sites.md`). Header-only dedupe in `TokensService` protects the ledger row but not the provider call, the conversation record or the SSE lifecycle.

The required guarantees are:

1. A client can retry a turn safely after an ambiguous network failure without a second charge or second provider call.
2. The server decides price, balance and lifecycle; a client key is a replay handle, never an authorization or a price input.
3. A crash anywhere between provider success and commit has a defined, recoverable outcome.
4. Reconnection reconstructs the last known result from durable state; it never triggers a new provider call.
5. Multiple API instances can receive the same turn concurrently and only one may execute it.

## Decision

Every AI turn is represented by exactly one durable `ai_operations` row keyed by `(user_id, feature, client_operation_id)` (unique DB index). The row owns a canonical request hash, server-side pricing version, reserved/charged credits, a state machine, and a lease with version and fencing token.

### 1. Keying and replay

- The client generates one `clientOperationId` (UUID v4 or equivalent opaque key) **once per user turn** and reuses it for every retry and reconnect of that turn. The API scopes it with the authenticated `user_id` and feature; it never trusts a client-supplied price, balance or status.
- `request_hash` is SHA-256 over a canonical JSON payload (sorted keys, stable fields, pricing version). On replay with the same key and same hash, return the existing row. Same key with a different hash is a **409 Conflict** — never an overwrite of the original intent, never a silent new charge.
- Price comes from the server catalog (`AI_OPERATION_COSTS`/`pricing_version`); `cost` in a request body is ignored. Reserve is written in the same transaction that checks the balance and records the initial ledger entry.

### 2. State machine and lease fencing

```text
RESERVED ──claim──> RUNNING ──commit──> SUCCEEDED  (terminal)
   │                   ├─────fail────> FAILED     (terminal)
   ├──cancel───────────┼─────stop────> CANCELLED  (terminal)
   └───────────────────┴─────crash───> UNKNOWN ──reconcile──> SUCCEEDED | FAILED
```

- Lease = `(version, lease_token, lease_until)`, where `lease_until` is derived from **database `now()`**, not the worker wall clock. Claim and terminal transition use conditional updates on version + token + deadline. A worker that lost its lease cannot commit, refund or persist a result: the fenced write returns no rows, the worker re-reads actual state and stops.
- `attempt_count` is bounded by `MAX_ATTEMPTS` (default 3). Provider calls are at-most-once per lease; a retry only happens under a reacquired, fenced lease or under the recovery job.
- New conversations are created inside the reserve path and their ID stored on the operation, so a retry cannot create a duplicate conversation. At most one in-flight turn per conversation is enforced in the database, not in frontend state.

### 3. Business exactly-once, provider at-most-once-per-lease

Exactly-once is promised for **business effects** — debit, credit, message persistence and terminal state — enforced by DB uniqueness, fencing and deterministic ledger keys. Provider invocations are not exactly-once: they are at-most-once per lease, and may be repeated only after a fenced reacquire or by recovery, with the ambiguity recorded as `UNKNOWN`.

Refund policy:

- Terminal `FAILED` or `CANCELLED` with a **known, non-ambiguous** error code produces exactly one refund of `reserved_credits - charged_credits`.
- Ambiguous codes (`PROVIDER_TIMEOUT`, `OPERATION_UNKNOWN`) and `UNKNOWN` status do **not** auto-refund. They require explicit reconciliation, because the provider may have billed/generated despite the local failure.
- The refund ledger key is deterministic, `refund:aiop:<operationId>`, and truncated to the ledger's 128-character limit. Uniqueness on `token_transactions.idempotency_key` makes a retried refund a no-op rather than a second credit. Corrections are compensating entries under documented keys; ledger rows are never mutated or deleted to "fix" a balance.
- Daily grants use a single UTC-day policy and write `daily_credit_grants` inside the reserve transaction with a unique `(user_id, grant_type, day)` constraint, including zero-amount rows. Redis is a cache, not the source of truth for "already processed".

### 4. SSE contract and reconnect

```text
event: accepted   data: {"operationId": "...", "conversationId": "..."}
event: delta      data: {"seq": 1, "text": "..."}
event: completed  data: {"operationId": "...", "messageId": "...", "balance": 25}
event: failed     data: {"operationId": "...", "code": "SAFE_ERROR_CODE"}
```

- `completed` is emitted **only after** the terminal transaction commits. EOF, an aborted fetch or a dropped connection is never success.
- Replay/reconnect calls `GET /api/v1/ai-operations/:id` (or scoped key lookup) and streams the stored result/state. It never re-invokes the provider. Partial deltas are not persisted as assistant messages.
- Before headers, failures use HTTP 400/401/403/409/429/503; after headers, `event: failed` with a safe error code. No raw provider text, key or token appears in the stream or logs.

### 5. Recovery and reconciliation pair

- **Recovery job**: scans stale `RUNNING`/`RESERVED` rows where `lease_until` has passed, moves them to `UNKNOWN`, re-queues up to `MAX_ATTEMPTS` under a fresh fenced lease, then force-refunds and alerts if the attempt budget is exhausted. `UNKNOWN` must not accumulate; it is a transient reconciliation queue, not a resting state.
- **Reconciliation job/operator action**: for `UNKNOWN`, compare provider-side result with local state. If a provider result exists and can be tied to the operation, persist it and finalize `SUCCEEDED` with the reserved charge; if not, finalize `FAILED` with a deterministic refund. Both outcomes are idempotent via the same key and ledger key.
- Both jobs need a scheduled runner (cron or BullMQ repeatable). Without one, stale `RUNNING` and `UNKNOWN` rows accumulate after any crash.

## Consequences

- Clients must own and reuse one key per turn; clients that generate a fresh key per retry are treated as new turns and charged normally.
- Legacy `POST /chat/send` + `consumeAndRun` paths must be retired when the new stream contract ships, or double billing regresses. `POST /tokens/purchase` must be feature-flagged off until verified grants are in place.
- The Prisma client must include the `ai_operations` delegate (run `db:generate` after the migration in CI) before any runtime path executes.
- Follow-up schema work: CHECK `balance >= 0`, partial index for stale-lease scans, and the migration/backfill must be validated before cutover.
- Docker Compose Redis healthcheck must use the configured password via env interpolation before multi-instance idempotency tests are meaningful.

## Failure modes

| # | Failure window | Immediate behaviour | Recovery | Invariant protected |
|---|---|---|---|---|
| F1 | Duplicate concurrent requests with same key | Unique index: one row wins; loser re-reads and replays | `409` if hash differs; otherwise return stored state | One debit, one provider call per operation |
| F2 | Same key reused after JWT refresh / new device | Scope by authenticated `user_id` + feature, not raw header | Legitimate new turn requires a new key | No cross-user or cross-feature replay |
| F3 | Long client key exceeds ledger width | Deterministic key truncated to ≤128 chars | Unique ledger key dedupes retried refund | No double credit |
| F4 | P2002 on reserve / refund | Read existing row and verify hash, bounded retry | Surface true conflict as 409, never 500 on normal replay | No duplicate ledger rows |
| F5 | P2034 serialization/deadlock storm | Bounded retry with jitter; do not hammer the transaction | Escalate after cap with safe code | Balance consistency under concurrency |
| F6 | Insufficient balance at reserve | HTTP 403 before provider call, no row finalized | Client tops up and uses the same key to resume | Balance never negative |
| F7 | Worker crash before claim | Row stays `RESERVED` with no lease token | Recovery re-claims or cancels with refund | No orphan debit |
| F8 | Worker crash after claim, before provider call | Lease expires; row still `RUNNING` | Recovery re-queues under new fenced lease | At-most-once provider call per lease |
| F9 | Provider succeeds, app dies before commit | Row may be `RUNNING` and no message saved | Recovery marks `UNKNOWN`; reconciliation finds provider result, persists it and finalizes `SUCCEEDED` | No silent loss of paid answer |
| F10 | Provider fails with known code | Transition `FAILED`, refund once via deterministic ledger key | Retry needs new key or fenced reacquire | Exactly one refund |
| F11 | Provider timeout / ambiguous outcome | Transition `UNKNOWN`, **no** auto-refund | Reconciliation resolves to `SUCCEEDED` or `FAILED` + refund | No double refund, no free answer |
| F12 | Stale worker finishes after lease expiry | Fenced conditional update rejects write | Worker re-reads state and stops | No stale commit or refund |
| F13 | Clock skew between workers | Lease deadline from DB `now()` | Ignore worker clock for expiry decisions | Deterministic fencing |
| F14 | SSE disconnect before commit | Stream ends without `completed`; no message persisted | Client calls status endpoint with same key | EOF is not success |
| F15 | Reconnect while `RUNNING` | Status endpoint returns current state, no new provider call | Client waits/reattaches to stream | No duplicate provider call |
| F16 | Terminal replay after success | Status endpoint returns stored `messageId` and balance | No recompute, no charge | Stable result |
| F17 | Two instances both receive same turn | Unique scope + version fencing selects one owner | Loser replays or 409 | Cross-instance exactly-once business effects |
| F18 | UNKNOWN rows accumulate | Alert when UNKNOWN age/count exceeds threshold | Reconciliation drains queue; force-refund after budget | UNKNOWN is transient |
| F19 | Redis down or stale | Cache miss only; DB remains source of truth | Recompute from DB | Correctness independent of cache |
| F20 | Raw provider error/key in logs | Structured logging with safe codes only | Redact and alert on leaks | No secret or PII leakage |
| F21 | Daily grant race at UTC midnight | Unique grant row inside reserve transaction | Conditional insert/read; no Redis-only decision | One grant per user/day |
| F22 | Migration backfill with existing rows | Add constraints NOT VALID, backfill, then VALIDATE | Rollback SQL documented in migration | Zero-downtime schema change |

## Verification

Acceptance for rel-38 requires: unit tests for recovery/reconciliation, P2034 retry and refund-key length; E2E tests for crash recovery, status replay, concurrent claims and disconnect-before-commit; frontend parser/reconnect tests; and ledger invariants from `docs/horizontal-scaling.md` (balance never negative; at most one consumption per key; at most one refund per operation; one provider call per key under replay). Claims about throughput, cost or coverage must be measured, not inferred from this ADR.
