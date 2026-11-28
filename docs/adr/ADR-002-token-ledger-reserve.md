# ADR-002: Token ledger and reserve-before-work

- Status: Accepted (rel-37). This ADR records decisions and invariants; tests that enforce them are a follow-up.
- Scope: credit/billing for AI features in the API (`tokens`, `ai_operations`, chat SSE orchestration).
- Related: ADR-003 (operation idempotency), `docs/billing-call-sites.md`, `docs/endpoint-inventory-chat-tokens.md`.

## Context

AI features consume credits. Several clients can act for the same user at once, provider calls can time out after the client disconnects, and retries can replay the same request more than once. A cached balance or a client-side check cannot authorize a debit: caches go stale, may be seeded by fixtures, and are shared across instances.

The system has two distinct stores with distinct roles:

- PostgreSQL (`user_token_balance`, `token_transactions`, `ai_operations`, `daily_credit_grants`) is the source of truth for credits and business effects. Debits, grants and refunds are written in short `Serializable` transactions; the unique constraints (`token_transactions.idempotency_key`, `ai_operations(user_id, feature, client_operation_id)`, `daily_credit_grants(user_id, grant_type, day)`) decide who wins a race. A `P2002` is a replay to read back, and a `P2034` gets bounded, jittered retries (three attempts).
- Redis is a read-through cache (`token:balance:<user>`, `token:last_topup:<user>`, `checkin:<user>:<day>`) and limiter only. Reads from Redis are advisory hints, never authority: a stale or fixture-populated key may skip a fast path but must never authorize a second grant, a debit, or a refund. Redis being unavailable must not change a billing outcome; cache writes and invalidations are best-effort and logged.

Pricing is server-authoritative. `TokensService.getPricingCatalog()` / `getFeatureCost(feature)` and the matching `AI_OPERATION_COSTS` catalog are the only price lookups; any client-supplied cost is ignored. The cost and pricing version are stored with the operation (`reserved_credits`, `pricing_version`) so a later price change cannot reinterpret an earlier reservation.

## Decision

1. **Reserve is an immediate atomic debit.** At accept time, `reserveTokens` debits the server-side price inside one short transaction using a conditional `updateMany` (`balance >= cost`), then writes the negative `token_transactions` entry with a deterministic key. If the balance is insufficient, the request is rejected before any SSE headers are written. The amount is held and spent immediately; there is no two-phase pending charge.
2. **Settle is a zero-amount marker, not a second debit.** On verified success, `settleTokens` writes an entry with `amount = 0` keyed by the same operation. The debit already happened; settle records the terminal business event. Settle is rejected if the operation was refunded.
3. **Refund is one positive compensating ledger entry.** On a known failure/cancellation, `maybeRefund` credits exactly `reserved_credits - charged_credits` with a deterministic `refund:aiop:<operationId>` key. The unique key makes a repeated refund a no-op that returns the original result. Corrections are never implemented by editing or deleting a prior row.
4. **One durable `ai_operations` row per `(user_id, feature, client_operation_id)`**, storing a canonical `request_hash`, `pricing_version`, `reserved_credits`, `charged_credits`, status, `version`, `lease_token`, and `lease_until`. `findOrCreate` is the single reservation entry point: same key + same hash replays the existing row; same key + different hash is HTTP 409. The canonical hash covers only validated, stable inputs (feature, language, conversation id, message) plus the pricing version; timestamps, lease tokens and provider outputs are excluded.
5. **Short DB transactions; never hold a transaction while calling an LLM/provider.** Operation creation, debit, settle and refund each commit in their own transaction. Provider I/O happens outside any DB transaction, fenced by the operation's `version` and `lease_token`.

## Invariants

- **Balance identity:** `balance = opening balance + sum(token_transactions.amount)` for the user. Every positive grant, debit and refund is a ledger row; no path changes `user_token_balance` without writing its entry in the same transaction. `balance_after` on each row records the value produced by that entry.
- **Append-only ledger:** rows are immutable. All corrections are compensating entries, never updates or deletes. Read-back after a unique-key conflict is the only replay path.
- **Deterministic keys:** every debit/settle/refund entry uses a key no longer than 128 characters. Keys are derived from the canonical server operation id (never a raw client key), include the user and feature scope, and are SHA-256-shortened when too long so distinct long ids do not collide. On replay, user, feature and amount must match the original row; mismatches return 409.
- **Idempotency scope:** `(user_id, feature, client_operation_id)` plus canonical `request_hash`. Same key + same hash replays existing state; same key + different hash is 409. Another user cannot read an operation, its status, or its result through `findByIdForUser`-scoped access.
- **Terminal immutability:** `SUCCEEDED`, `FAILED` and `CANCELLED` have no outgoing transitions. A repeated `markTerminal` with the same status is a no-op; a different status is rejected. `UNKNOWN` is non-terminal but only transitions to `SUCCEEDED` or `FAILED`.
- **Fenced work:** `RUNNING`/`UNKNOWN` work is protected by `version` + `lease_token`. `claimLease` is idempotent for the current owner (same token and unexpired deadline returns the same grant and does not start a second provider call); a stale version, expired lease or other owner is rejected. `markTerminal` uses the same fence so a delayed worker cannot finalize after losing its lease.
- **UNKNOWN is reconciled, never auto-refunded on ambiguity:** provider timeout / `OPERATION_UNKNOWN` produce a `requires_reconciliation` refund decision. Only known error codes in the refundable set trigger a compensating entry. `forceRefund` is an explicit, audited override, not an automatic timeout path.
- **Commit before completion:** `completed` SSE is emitted only after the result is persisted, `markTerminal(SUCCEEDED)` succeeds and `settleTokens` commits. EOF is not success: a stream that ends without a committed terminal event emits no `completed` and the operation remains recoverable. The `GET chat/operations/:operationId` status path is read-only.
- **No client-authoritative trust:** client cost is ignored, pricing version is stored and included in the hash, and a pricing-version mismatch is rejected rather than silently reinterpreted.

## Consequences

- UI should label credits as held/spent immediately when a request is accepted; the reservation is a real debit, not a pending authorization. A failed known outcome returns credits via a visible refund entry.
- The replay/status endpoint is read-only and user-scoped; it never creates, debits, settles or refunds.
- Provider calls are at-most-reduced (one call per active lease, idempotent replay, fenced finalization) but are **not** exactly-once at the network level. A provider may still receive a duplicate call after a lost lease or an ambiguous timeout; reconciliation, not blind retry or blind refund, resolves it.
- Redis loss degrades performance only. Debit correctness depends on PostgreSQL constraints and short serializable transactions, not on cache warmness.
- Follow-up verification (not in this ADR-only slice): DB-backed ledger e2e for `balance = opening + sum(entries)`; 10 credits with three concurrent 5-credit reserves yields at most two successes; replay does not debit; double refund credits once; `P2002` read-back and bounded `P2034` retry; Redis unavailable still bills correctly; stale lease cannot terminalize; long keys do not collide; pricing-version mismatch rejected. Extend `apps/api/test/chat-billing.e2e-spec.ts` (T09/T10/T13-T18/T20) or add a focused token-ledger e2e spec.
- Generated Prisma client must include `ai_operations` and `daily_credit_grants` delegates (`prisma generate`) before runtime access; migrations must be applied in every environment.
