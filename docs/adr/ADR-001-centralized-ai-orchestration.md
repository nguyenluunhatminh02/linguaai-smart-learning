# ADR-001: Centralized AI orchestration

- Date: 2026-11-28
- Scope: AI operation lifecycle, ownership, idempotency and billing across AI features (chat first)
- Roadmap references: BUG-02, BUG-03, BUG-05, BILL-02, BILL-03, BILL-04, CHAT-01–04, §13.6

## Status

**Proposed (conditionally acceptable, not yet Accepted).**

The orchestration described here is substantially present in the tree at commit `3be6aa39ad65fc7cfef22d75c84e40c5927b0389`, and the API/AI-service unit suites are recorded as passing. However, `docs/test-report.md` records the API E2E suites — including the CHAT-04 T01–T20 matrix — as **NOT RUN** against real PostgreSQL, with T01–T18 and T20 marked `CONTRACT ONLY` and T19 marked `PARTIAL` (web unit only). A documented test file is not evidence that its scenario passed. Per the P0 sprint gate in the roadmap, this ADR stays Proposed until the real-DB run is executed and recorded. Promote to Accepted only after the Evidence section below contains observed commands, exit codes, test counts and the commit SHA for that run.

## Context

The roadmap identifies three P0 defects that share one root cause: no server-owned, durable operation lifecycle around AI calls.

- BUG-02: `apps/api/src/chat/chat.controller.ts` streamed from the provider without reserving or debiting credits, so SSE could bypass billing.
- BUG-03: after SSE, frontend `persist()` called `/chat/send`, which invoked the LLM again; the client also continued its old `consumeAndRun()` path. One user turn could trigger two provider calls and two billing paths.
- BUG-05: idempotency lived at the token debit, while the AI work still ran afterwards; stream and non-stream did not share one workflow.

The existing server-side price catalog (`BILL-02`) was good but was not enough: price lookup is not authorization, ownership, idempotency or recovery. BILL-03/04 and CHAT-01–04 call for a durable `ai_operations` record, a canonical request hash, unique scope, fenced leases, terminal immutability, deterministic ledger keys, and a single commit point for result plus billing. The AI-service (FastAPI) owns prompts, model routing, schemas and streaming; it must not own user balances or resource ownership. The web client owns the Idempotency-Key and SSE parsing; it must not debit or re-run the AI call.

## Decision

NestJS (`apps/api`) is the single owner of the AI operation lifecycle and billing. FastAPI (`apps/ai-service`) is the executor of prompts, model/schema selection and streaming only. PostgreSQL is the source of truth for operation state and the token ledger; Redis remains a cache/limiter and is never used to authorize a debit or decide ownership.

Concretely:

1. **Reserve before execution.** Both `POST /chat/send` and `POST /chat/stream` call the same `reserveOperation` path in `chat.controller.ts`: validate language and input, verify conversation ownership, then `AiOperationsService.findOrCreate(userId, dto)`. Only a newly created `RESERVED` row triggers `TokensService.reserveTokens`, whose conditional debit and ledger write are atomic. A replayed operation never debits twice.
2. **Durable identity and canonical hash.** `ai_operations` has `UNIQUE(user_id, feature, client_operation_id)` and `INDEX(status, lease_until)`. `AiOperationsPolicy.computeRequestHash` hashes a canonical JSON payload (sorted keys; feature, language, conversation, message) together with pricing version `v1`. Timestamps, random lease tokens and provider output are excluded. Same scope + same hash replays; same scope + different hash returns HTTP 409.
3. **Server-owned pricing.** `AI_OPERATION_COSTS` and `AI_OPERATION_PRICING_VERSION` live in `ai-operations.policy.ts`. A client never supplies price. Other AI features use their own feature code in the same catalog rather than inventing a second billing path.
4. **Lease fencing.** `claimLease` uses a version check and an unguessable lease token; stale workers cannot commit after losing the lease. Default TTL is 60 s and the attempt budget is 3. `markTerminal` is fenced by version and lease token; terminal states are immutable and cannot return to `RUNNING`.
5. **Single terminal commit.** The SSE transport emits `completed` only after `ChatService` has committed the assistant message and the controller has finalized the operation and settled tokens through `TokensService.settleTokens`. EOF without a committed terminal event is a failure/`UNKNOWN`, never success. `GET /chat/operations/:operationId` lets a client recover status/result from committed DB state without starting another provider call.
6. **At-most-once refund.** `maybeRefund` derives a deterministic ledger key `refund:aiop:<operationId>` and calls `TokensService.addTokens(..., 'refund', ...)`; the unique ledger constraint makes retried refunds no-ops. Keys longer than 128 characters are truncated with a stable, collision-resistant scheme in `TokensService.billingKey`.
7. **Bounded responsibility.** `apps/ai-service/app/routers/` plus `app/services/llm_client.py` own prompt/model/schema/streaming and do not own balance or ownership. `apps/web/src/app/(dashboard)/chat/page.tsx` keeps the Idempotency-Key and parses SSE; it does not call `/chat/send` after streaming and does not debit locally.

## Alternatives

- **Client-side billing / `consumeAndRun` retained.** Rejected: it is the direct cause of BUG-03 and lets a client under-charge or double-charge. UI checks may inform the user but are not security controls (BILL-02).
- **Idempotency only at the token debit.** Rejected: it stops the second charge but not the second AI call (BUG-05); replay still needs a stored result and a durable operation identity.
- **Redis as the operation store or authority for balance.** Rejected: Redis can be cold, evicted or single-instance; BILL-04 requires DB transactions and conditional updates as the authority. Redis is limited to cache/limiter use.
- **Unfenced status writes (status-only compare-and-set).** Rejected: a reconnecting worker could overwrite a newer result after a lease takeover. Version + lease token fencing is required.
- **FastAPI owning billing/ownership.** Rejected: it would duplicate authorization and price rules across services and put the token ledger behind another network boundary.
- **Separate workflow per transport (stream vs non-stream).** Rejected: it recreates BUG-02/BUG-03. Both transports share `reserveOperation` and the same terminal contract.
- **Unbounded retries for `UNKNOWN`.** Rejected: provider calls are not exactly-once; `UNKNOWN` needs reconciliation and a bounded attempt budget rather than blind replay.

## Consequences

### Positive

- One user turn maps to one operation, one debit, one provider workflow and one committed result, including SSE.
- Replays are safe: the same key returns the saved result; a conflicting payload is rejected with 409.
- Lost SSE connections can recover through `GET /chat/operations/:operationId` without re-running the provider.
- Stale workers cannot commit results or refunds after their lease is lost; terminal results are immutable.
- Refunds are at most once per operation via a deterministic ledger key, and prices are centralized and versioned.
- Other AI features can adopt the same mechanism by supplying their feature code rather than adding new billing logic.

### Negative / open risks

- `UNKNOWN` reconciliation and cancel-after-charge policy are still open. The current code routes ambiguous timeouts to `UNKNOWN` and defers refund; this needs an explicit operator workflow.
- Canonical hash and pricing version are compatibility contracts. Changing hash input or `v1` makes old replays fail with 409; migration must be deliberate.
- Refund ledger keys must remain unique after truncation; a future change that truncates without the stable suffix could collide.
- Two service boundaries (NestJS orchestration, FastAPI execution) mean timeouts and aborts must stay carefully aligned; provider exactly-once is not promised.
- The P0 real-DB gate is not yet evidenced, so the design is not ready to be called Accepted or to open public beta.
- This ADR must not include prompts, transcripts, JWTs, raw logs or any real `.env`/secret values; none were used as evidence.

## Evidence

All references below are to the tree at commit `3be6aa39ad65fc7cfef22d75c84e40c5927b0389`. No new test was run for this documentation-only slice; no package manager was invoked.

| Evidence | Observed result | Source |
|---|---|---|
| API unit suites | `pnpm --filter api test -- --runInBand`: exit 0, 52 suites / 632 tests passed | `docs/test-report.md` line 42 |
| AI-service pytest | `/tmp/ai-provider-venv/bin/python -m pytest -q --tb=line` from `apps/ai-service`: exit 0, `107 passed, 1 warning in 1.07s` | `docs/test-report.md` line 43 |
| API DB E2E / CHAT-04 T01–T20 | NOT RUN against real PostgreSQL; T01–T18 and T20 `CONTRACT ONLY`, T19 `PARTIAL` (web unit only) | `docs/test-report.md` lines 55, 95–120 |
| Orchestration implementation | `findOrCreate`, `claimLease`, `markTerminal`, `maybeRefund`, `getCost` in `apps/api/src/ai-operations/ai-operations.service.ts`; fenced queries in `apps/api/src/ai-operations/ai-operations.repository.ts`; policy/hash/costs in `ai-operations.policy.ts` | source files, read at this commit |
| Chat/SSE implementation | shared `reserveOperation`, post-commit `completed`, EOF-as-failure, replay endpoint in `apps/api/src/chat/chat.controller.ts` | source file, read at this commit |
| Billing implementation | conditional debit, settle, at-most-once refund and deterministic ledger keys in `apps/api/src/tokens/tokens.service.ts` | source file, read at this commit |
| Schema | `ai_operations` model, 6-state enum, unique scope and `(status, lease_until)` index in `apps/api/prisma/schema.prisma` | source file, read at this commit |

Required evidence to promote this ADR to Accepted:

1. Provision a disposable, migrated, seeded PostgreSQL database (never a shared/production DB; `apps/api/test/setup.ts` truncates `users` with `CASCADE`).
2. Run the API E2E suite including `chat-billing.e2e-spec.ts` and `chat-billing-orchestrator.spec.ts` with a fake provider, and record the exact command, exit code, test count and commit SHA.
3. Confirm CHAT-04 T01–T20 rows are green in a report that supersedes `docs/test-report.md`.
4. Re-run the AI-service pytest and record command/exit code/count against the same SHA.

## Related ADRs

- ADR-002 — token ledger/reserve: owns the debit/settle/refund ledger invariants referenced by this ADR (BILL-04).
- ADR-003 — operation idempotency: owns the canonical hash, unique scope and replay/409 rules (BILL-03).
- ADR-004 — why modular monolith: explains why NestJS remains the orchestration owner while FastAPI stays an execution service.
- ADR-005 — mastery model: consumes operation results through normal learning services; it does not own AI billing or lifecycle.

These ADRs are companion roadmap deliverables at §13.6, not changes made by this slice.
