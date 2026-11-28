# Reliability contract: errors, queue/outbox, storage states, rollback

Status labels used throughout this document:

- **CURRENT** — behaviour observed in the checked-in code on this branch.
- **TARGET** — roadmap intent (Sprint 3 REL-01/03/04, DB-05, OPS-03, TEST-09/10) or a design decision required before implementation. TARGET is **not** a claim that the code exists.

Sources of truth: `LinguaAI_Engineering_Roadmap.md` (Sprint 3 and DB-05/OPS-03/TEST-09/TEST-10) and the code paths named in each section. When code and roadmap disagree, both are stated explicitly rather than silently treating the roadmap as implemented.

## 1. Scope and invariants

1. **PostgreSQL is the source of truth** for the credit ledger (`token_transactions`), AI operation state (`ai_operations`), and object metadata. Redis (ioredis is a dependency; BullMQ is not pinned) is only a cache, rate-limit transport, and job transport. Losing Redis must not change money, operation terminal state, or ownership facts.
2. **One client operation key per user intent.** Keys are validated and scoped per user before they reach storage or a provider (for example `apps/api/src/chat/chat.controller.ts`, `apps/api/src/grammar/grammar.controller.ts`, `apps/api/src/reading/reading.controller.ts`, `apps/api/src/writing/writing.controller.ts`). Retries preserve the same key. **CURRENT:** the durable `ai_operations` row has `client_operation_id`, `request_hash`, `version`, `attempt_count`, `lease_until`, `lease_token`, and the unique key `(user_id, feature, client_operation_id)` (`apps/api/prisma/schema.prisma`).
3. **Exactly-once applies to business effects, not provider calls.** A provider may be invoked more than once under an ambiguous timeout; the DB fencing and deterministic ledger keys must still charge/refund and persist a result at most once. Never promise exactly-once upstream calls.
4. **Log hygiene.** No prompt text, audio bytes, JWT/API keys, secrets, raw provider strings, or PII in logs or client-visible errors. Error bodies use allowlisted codes and fixed safe messages; request IDs are validated before being echoed. **CURRENT:** the NestJS global filter strips control characters, bounds `errors`, validates `X-Request-ID`, and removes the query string from `path`; the FastAPI error envelope uses fixed messages and discards caller/provider text that is not the registry message (`apps/api/src/common/filters/global-exception.filter.ts`, `apps/ai-service/app/core/exceptions.py`).
5. **Correlation.** **CURRENT:** the NestJS adapter sends `X-Request-ID`, `X-AI-Feature`, `X-AI-Schema-Version`, `X-AI-Deadline`, `X-AI-Operation-ID`, `X-AI-Envelope` to FastAPI (`apps/api/src/common/services/ai-client.service.ts`). **TARGET:** propagate the same sanitized `requestId` and operation key/id through NestJS → FastAPI → worker into logs and terminal status responses.

## 2. Error contract

### 2.1 Wire envelopes

**CURRENT — NestJS (global filter/transformer).** Error body:

```json
{
  "success": false,
  "message": "The request could not be validated.",
  "data": null,
  "errors": null,
  "timestamp": "2026-11-28T00:00:00.000Z",
  "path": "/api/v1/...",
  "code": "VALIDATION_ERROR",
  "retryable": false,
  "requestId": "..."
}
```

Six shared keys (`success`, `message`, `data`, `errors`, `timestamp`, `path`) plus `code`, `retryable`, `requestId`. `errors` is only populated for 400 responses and is normalized to bounded strings or a field→strings map. The response carries `X-Request-ID`. Prisma mapping: `P2002` → 409 `OPERATION_CONFLICT`; `P2025` → 404 `RESOURCE_NOT_FOUND`; `P2003`/`P2014`/`P2020` (and `PrismaClientValidationError`) → 400 `VALIDATION_ERROR`; `P2034` keeps 500 with an advisory conflict hint; all other known Prisma codes → 500 `INTERNAL_ERROR`; `PrismaClientInitializationError` → 503 `DATABASE_UNAVAILABLE`. An explicit allowlisted `code` in an `HttpException` payload can refine code/message but never changes the status-derived `retryable` hint.

**CURRENT — FastAPI.** HTTP errors use a fixed-message envelope: `{"detail": "...", "error_code": "...", "error": {"code": "...", "message": "...", "retryable": false, "requestId": "...", "operationId": "..."}}` (`build_error_payload` in `apps/ai-service/app/core/exceptions.py`, `_error_response` in `main.py`). Validation errors are 422 `VALIDATION_ERROR`; generic exceptions are 500 `INTERNAL_ERROR` with no exception text. 429 responses may carry `Retry-After`. SSE failures use `event: failed` with `{"error": {"code", "message", "retryable"}}` (`apps/ai-service/app/routers/chat.py`).

**TARGET — additive convergence.** Keep every existing field for compatibility; add exactly one common vocabulary at the client boundary:

```json
{
  "code": "PROVIDER_TIMEOUT",
  "message": "The AI service did not respond in time.",
  "retryable": true,
  "requestId": "request-uuid",
  "operationId": "operation-uuid"
}
```

NestJS may continue wrapping this inside its envelope and FastAPI inside `error`/`detail`; clients must read `code`/`retryable`/`requestId`/`operationId` from either shape. Version the schema (`X-AI-Schema-Version` already exists) and retain legacy fields during migration. Never echo raw provider strings.

### 2.2 Canonical code table

Statuses below are the target contract; where current code differs, the difference is called out.

| Code | Status | Retryable | Current behaviour / decision |
|---|---:|---|---|
| `VALIDATION_ERROR` | 400 | no | NestJS 400; FastAPI uses 422 for request-validation errors. Align to 400 or explicitly version 422 as a compatible alias. |
| `UNAUTHORIZED` | 401 | no | Present in FastAPI `_ERROR_CODES`/`_STATUS_CODES`; absent from the NestJS allowlist (NestJS uses `AUTHENTICATION_REQUIRED`). Map `AUTHENTICATION_REQUIRED` → `UNAUTHORIZED` or keep a documented per-service alias. |
| `INSUFFICIENT_CREDITS` | 403 | no | NestJS supports an explicit allowlisted 403 code; FastAPI registry uses 403 while `_STATUS_CODES` still maps 402. Fix the 402 mapping or version it. |
| `OPERATION_CONFLICT` | 409 | no | Both services expose it. |
| `OPERATION_UNKNOWN` | 404 | no | FastAPI exposes 404 → `OPERATION_UNKNOWN`; NestJS currently maps 404 → `RESOURCE_NOT_FOUND`/`VALIDATION_ERROR` family and has no `OPERATION_UNKNOWN`. **Migration required:** add the code to the NestJS allowlist and map unknown-operation lookups to 404. |
| `RATE_LIMITED` | 429 | yes, `Retry-After` | Both services expose it. FastAPI's local `CONCURRENCY_LIMITED` and `BUDGET_EXCEEDED` 429 variants are canonicalized to `RATE_LIMITED` on the wire by the registry; keep this or expose them explicitly under a new schema version. |
| `PROVIDER_UNAVAILABLE` | 503 | yes | Both services expose it. |
| `PROVIDER_TIMEOUT` | 503 or 504 | yes | FastAPI registry uses 504 and NestJS uses 504; `503` is also allowlisted in older mappings. **Decision required:** pick one canonical status (recommend 504 for an upstream deadline) and record it in the contract version. No producer was found for the 503 variant. |
| `INVALID_AI_OUTPUT` | 502 | no | Present in FastAPI registry; absent from the NestJS allowlist. TARGET: propagate from worker/gateway to client without a raw validation dump. |
| `INTERNAL_ERROR` | 500 | no | Both services expose it; FastAPI also uses it for unmapped statuses. |

### 2.3 SSE rules

**CURRENT:** `accepted`, `delta`, `completed`, `failed` are the only events emitted by `apps/ai-service/app/routers/chat.py` and relayed by `apps/api/src/chat/chat.controller.ts`. These are the only allowed events.

- EOF is **not** completion. `apps/api/src/chat/chat.controller.ts` explicitly emits `failed` when the stream ends without a terminal event or its deadline is reached.
- A partially streamed response may not be silently restarted as if it were one successful generation.
- The client must verify the terminal result via the committed-DB operation status endpoint (`GET .../operations/:operationId` in the chat controller), not by trusting the last `delta`.
- `completed` is emitted only after the DB finalize succeeds; `failed` carries an allowlisted code and fixed message only.

## 3. Queue and outbox

### 3.1 Current state

- `ai_operations` rows are durable with `RESERVED → RUNNING → SUCCEEDED/FAILED/UNKNOWN/CANCELLED`, `version`, `attempt_count`, `lease_until`, `lease_token` (`apps/api/prisma/schema.prisma`). Chat has operation status recovery and a deadline path.
- `apps/api/src/queue/` contains `OutboxRepository` (raw SQL over `outbox_events`, with PENDING/CLAIMED/PUBLISHED/FAILED semantics, fenced lease claims, reconciliation of expired leases, `MAX_ATTEMPTS = 5`), a `QueueModule` with a minimal BullMQ-compatible port, IDs-only payload validation, bounded job payload size, and attempts/backoff/retention defaults, plus `QueueProcessor` and `QueueService`.
- **No `bullmq` dependency is pinned** (`apps/api/package.json` has `ioredis` only); the real `Queue` is loaded lazily and fails closed when unavailable, and the processor includes an in-process path. Therefore queue transport is **CURRENT partial / TARGET** for production.

### 3.2 Target flow (REL-03)

1. `POST` generates a user-scoped operation key; transaction **atomically** reserves credits, inserts the `ai_operations` row, and inserts the outbox row. Respond `202 + operationId` only after commit.
2. Publisher claims PENDING outbox rows, enqueues with `jobId = operationId` and a versioned payload containing **IDs and version only** (operation id, user id, feature, prompt/config id) — no secrets, raw audio, or prompt text.
3. Publisher marks the row PUBLISHED only after enqueue succeeds; an enqueue failure leaves it claimable.
4. Worker finalizes result, operation state, and ledger adjustments atomically under `version`/`lease_token` fencing. DB state wins if Redis or the job disappears.

### 3.3 Outbox states and fields

`PENDING → CLAIMED → PUBLISHED → ACKED | FAILED → DEAD`, with retry from `CLAIMED`/`FAILED` back to `PENDING` when the lease expires. Proposed columns: `operation_id` (unique), `queue_name`, `payload_version`, `payload` (IDs only), `status`, `attempts`, `max_attempts`, `available_at`, `lease_until`, `lease_token`, `last_error_code` (allowlisted only), `created_at`, `updated_at`. Bounded concurrency, max attempts with jittered exponential backoff, cancellation deadlines, bounded dead-letter retention with alerting, and reconciliation of stuck PENDING/expired CLAIMED rows are required. Graceful shutdown stops new claims, drains within a deadline, then releases or leaves leases to be recovered after restart. Manual retry is audited and only allowed under policy.

### 3.4 Refund rule

Known failure codes (`VALIDATION_ERROR`, `INVALID_AI_OUTPUT`, `INSUFFICIENT_CREDITS`, `OPERATION_CONFLICT` where applicable) refund **once** via a deterministic ledger key derived from the operation/attempt. Ambiguous outcomes (`PROVIDER_TIMEOUT`/UNKNOWN, worker crash after provider call) **must not** trigger an automatic second provider call or automatic refund; mark `UNKNOWN` and route to manual reconciliation.

## 4. Storage states

### 4.1 Current state

`apps/api/src/files/storage.adapter.ts` defines a `StoragePort` with `put/get/delete/head/signedReadUrl` and a local `LocalStorageAdapter` (aliased `StorageAdapter`) that writes under `CWD/uploads`, validates owner-scoped keys, computes checksums, and can issue HMAC-signed read URLs for `/api/v1/files/signed`. `apps/api/src/files/files.service.ts` persists metadata status constants (`PENDING`, `READY`, `FAILED`, `DELETING`, `DELETED`) before writing bytes and finalizes to `READY` only after a successful `put` plus matching size/checksum. **Caveats:** the Prisma schema checked in here has no `file_objects` model/migration, so the metadata delegate is accessed defensively at runtime and will throw until `db:generate` and the migration exist. `app.useStaticAssets(..., prefix: '/uploads/')` in `apps/api/src/main.ts` still serves public URLs; the signed read route is not mounted in this slice. Do not store private files under `/uploads/` until it is.

### 4.2 Target `StoragePort`

`put`, `get`, `delete`, `head`, `signedReadUrl` with a local dev implementation and an S3-compatible/MinIO implementation for staging. Proposed `file_objects` metadata fields: unique `key`, `owner_id`, `size`, `mime`, `checksum`, `status`, `object_uri`, `created_at`, `updated_at`.

State machine:

- `PENDING`: metadata row created with a deterministic owner-scoped, server-generated key; no usable read URL.
- `PENDING → READY` only after `put` **and** `head` confirm size/checksum.
- `put`/finalize failure → `FAILED`; retry reuses the same key.
- `READY → DELETING → DELETED` after object deletion is confirmed; not-found on delete counts as success.
- Stale `DELETING` rows are retried by a sweeper; orphan `PENDING`/`FAILED` rows are swept.
- Signed read URLs are issued only after DB authorization and only for `READY` objects. No public URLs for private data.

## 5. Rollback

- **Additive migrations only.** The new outbox and file-metadata tables are ignored by the old app, so app rollback is safe. Follow expand → backfill → switch readers/writers → contract in **separate releases**; exactly one migration job per release; keep `prisma migrate deploy` as the deploy path (`apps/api/package.json` `start:prod`).
- **Queue rollback:** disable publisher and worker, leave outbox rows replayable. `jobId = operationId` plus DB version/lease fencing prevents double settlement when the new worker is re-enabled.
- **Storage rollback:** keep old and new adapters behind `StoragePort`; do not change key formats in the same release. Soft delete (`DELETING`/`DELETED`) allows restore before physical cleanup.
- **Error-contract rollback:** additive and versioned; keep legacy fields and aliases (`error_code`, `detail`, `AUTHENTICATION_REQUIRED`, `RESOURCE_NOT_FOUND`, FastAPI 429 variants) while clients migrate. Never remove an allowlisted code in the same release that introduces its replacement.
- **Destructive migrations** require a separate restore plan and a tested restore drill (DB-05): backup, restore to an isolated DB, verify constraints/counts/business samples, then deploy. Do not run truncation/column-drop migrations from an untrusted PR.
- Verification gates: TEST-09 contract tests for NestJS ↔ FastAPI schemas/errors (including invalid output failing clearly), TEST-10 worker tests for retry, crash, duplicate enqueue, outbox backlog, and no duplicate charge/result.

## Open decisions / out-of-scope blockers

- Canonical `PROVIDER_TIMEOUT` status (503 vs 504) must be chosen before client code depends on it.
- Whether to expose `CONCURRENCY_LIMITED`/`BUDGET_EXCEEDED` as distinct versioned codes or keep canonicalizing to `RATE_LIMITED`.
- Whether to add `OPERATION_UNKNOWN`/`INVALID_AI_OUTPUT` to the NestJS allowlist and how to map 404 in NestJS.
- Add the `file_objects` Prisma model + migration and mount the signed read route (both outside this docs-only slice).
