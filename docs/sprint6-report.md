# Sprint 6 — Frontend sprint report (refactors and unmeasured performance work)

**Status: source-evidenced implementation inventory; runtime verification NOT RUN.** This report separates refactors visible in source from performance work that has been measured. Code presence is not proof of correctness, and a proposed target is not measured capacity. No test suite, build, browser run, load test, package manager, database query, or provider call was executed for this report. No `.env` value, credential, or API key was read or written.

## 1. Provenance and snapshot

| Field | Value |
|---|---|
| Git HEAD | `3be6aa39ad65fc7cfef22d75c84e40c5927b0389` (`main`) |
| Report observation timestamp (UTC) | `2026-11-28T03:54:06Z` |
| Roadmap source | `LinguaAI_Engineering_Roadmap.md:751-798` (Sprint 6: FE-01/FE-02/FE-03 and gate), `:463` (staging starting limits), `:611-649` (DB-04 index lab), `:915-966` (OPS-03, PERF-01/PERF-02), `:1169-1178` (Definition of Done) |
| Methods used | Read-only source inspection and file listings, `git rev-parse HEAD`, `git status --short`, `date -u`. No command listed in §5 was executed. |
| Working tree | Dirty (301 changed paths at collection time), including many modified tracked files and untracked feature/docs/test files. This report does not claim the tree is green, consistent, or reproducible. |
| Files changed by this slice | `docs/sprint6-report.md` only. The file did not exist before this slice. No application code, schema, migration, or test was edited. |
| Evidence consulted | `apps/web/src/lib/sse-parser.ts` + spec, `apps/web/src/app/(dashboard)/chat/page.tsx`, `apps/web/src/hooks/use-stream-throttle.ts` + spec, `apps/web/src/features/speaking/`, `apps/web/src/lib/errors.ts`, `apps/web/src/lib/query-keys.ts`, `apps/web/src/components/features/async-state.tsx` + spec, `apps/api/src/chat/`, `apps/api/src/ai-operations/`, `apps/api/src/common/services/rate-limiter.service.ts`, `apps/ai-service/app/rate_limit.py`, `apps/ai-service/app/utils.py`, `apps/ai-service/app/services/llm_client.py`, `apps/api/src/files/`, `docs/frontend-performance.md`, `docs/accessibility-audit.md`, `docs/reliability.md`, `docs/sprint5-report.md`, `docs/benchmarks/*`. |

**Verdict legend**

| Verdict | Meaning |
|---|---|
| Implemented (source-evidenced) | Code exists at the cited path. No runtime assertion is implied. |
| Test declared | A test file declares scenarios; no pass result is claimed. |
| Partial / risk | Implementation exists but a stated contract or integration is incomplete or contradictory. |
| NOT MEASURED / NOT RUN | No captured command output, exit code, or measurement exists for this slice. |

## 2. Status matrix — refactors vs unmeasured work

| Roadmap item | State | Evidence actually checked | Unmeasured or missing |
|---|---|---|---|
| FE-01 feature-based refactor | Implemented (source-evidenced), partial | `apps/web/src/features/speaking/` contains `api/`, `components/`, `hooks/`, `schemas/`, `tests/`, `types.ts`, `utils.ts`; `apps/web/src/app/(dashboard)/speaking/page.tsx:26-33` composes `AudioRecorder` and `useSpeakingFeedback` | Only `speaking` is present under `src/features/`. CMS, reading, listening, profile, and vocabulary refactors are not evidenced here. No before/after regression run; no route-switch/UI-state or media-leak test result |
| FE-01 media/session cleanup | Implemented (source-evidenced) + Test declared | `apps/web/src/features/speaking/hooks/use-audio-recorder.ts:168-222,285,383-485` stops tracks, revokes object URLs, and aborts on unmount; `use-speaking-session.ts:97-155` uses TanStack Query keys and invalidates token balance; `use-speaking-feedback.ts:353-413` uses owned AbortController guards; `apps/web/src/features/speaking/schemas/speaking.ts` uses Zod; `tests/speaking.test.ts` and `schemas/speaking.spec.ts` declare tests | No test execution; no browser route-switch, permission-error, or microphone-revocation observation |
| FE-02 UX states | Implemented (source-evidenced) + Test declared | `apps/web/src/components/features/async-state.tsx:44-285` exposes `loading/empty/error/offline/success`, `useOnlineStatus`, and offline-error detection; spec at `async-state.spec.tsx`; chat `StreamState` at `apps/web/src/app/(dashboard)/chat/page.tsx:86-91` includes `idle/submitting/streaming/completed/failed/cancelled`; `role="status"`/partial-reply marking described in `docs/accessibility-audit.md:9-15` | FE-02 audit is `docs/accessibility-audit.md` **procedure only**: no contrast ratios, keyboard/focus findings, screen-reader announcements, or pass/fail counts |
| FE-03 performance profiling | NOT RUN | `docs/frontend-performance.md` is an explicit empty baseline template; `docs/benchmarks/` contains `chat-history.md`, `connection-budget.md`, `due-cards.md`, `history.md` — all plans with `NOT RUN`/`NOT MEASURED` cells | No React Profiler, network waterfall, bundle output, Lighthouse, LCP/INP/CLS, TTFT, delta rate, or dropped-frame number exists |
| CHAT-03 / BUG-04 SSE parser | Implemented (source-evidenced) + Test declared | `apps/web/src/lib/sse-parser.ts:8-10,84,145-427` buffers arbitrary chunks, handles CRLF/bare CR and streaming UTF-8, caps partial buffer, rejects malformed terminals, and treats EOF/`[DONE]` as incomplete by default; `sse-parser.spec.ts:56-256` declares 17 scenarios including split multibyte text, missing terminal, abort, and buffer overflow | No test run; no measured event loss, TTFT, or render-jank under load |
| BUG-03 chat UI lifecycle | Implemented (source-evidenced), partial | `apps/web/src/app/(dashboard)/chat/page.tsx:6-9,86-91,124-164,177-633` removes client-side debit/persist, generates and reuses one Idempotency-Key, verifies terminal state via operation status, keeps partial replies out of history, and guards abort ownership. No `consumeAndRun` or `/chat/send` persist call found in this file | The same header comment states the deployed backend emits only legacy token events and has no operation/status endpoint; that path is intentionally incomplete and does not invalidate balance/messages. End-to-end replay/reconnect behavior is unverified |
| CHAT-02 / BUG-02 chat orchestration | Implemented (source-evidenced) | `apps/api/src/chat/chat.controller.ts:34,163-169,207-226,269-426,682-736` bounds keys, replays SUCCEEDED operations, aborts on disconnect/deadline, emits `completed` only after finalize and `failed` at EOF without commit, exposes operation status; `apps/api/src/chat/chat.service.ts:18-24,93-140,223-236,312-442` bounds history/output, maps sanitized error codes, propagates cancellation and uses single-turn orchestration | No SSE + billing E2E result, no TTFT/event-loss measurement, no provider-backed run |
| BILL-03/04 AI operations | Implemented (source-evidenced) + Test declared | `apps/api/src/ai-operations/ai-operations.service.ts:59-336` (idempotent reserve, fenced lease claim/terminal transition, deterministic refund ledger key), `ai-operations.policy.ts:37-207` (pricing version, canonical hash, refund policy), `ai-operations.repository.ts:134-275` (unique conflict handling, version/lease fencing); specs present in the same directory | No DB-backed concurrency run; no measured reserve/settle/refund invariant result |
| SEC-06 / rate limiting | Implemented (source-evidenced), partial | `apps/api/src/common/services/rate-limiter.service.ts:58-211` uses one atomic Redis Lua script with configurable fail-open/fail-closed behavior and TTL-derived `Retry-After`; `apps/ai-service/app/rate_limit.py:1-17,65-123,129-171` keeps in-memory fallback for health routes but documents fail-closed policy for billable routes | No two-instance limit test; no capacity validation of the roadmap's starting limits (their values are staging hypotheses, not verified throughput) |
| AI cache/output hardening | Implemented (source-evidenced), partial | `apps/ai-service/app/utils.py:114-195` re-validates cached responses against the response model; `apps/ai-service/app/services/llm_client.py:29-35,52-115,544-571` caps streamed text at 2 MB, `max_tokens` at 8192, and applies per-feature timeouts/deadline | No cache hit-rate measurement; no cache-scope test result. `utils.py` still uses older `h/m/t` cache-key fields, so full `CacheKey` scope from `docs/sprint5-report.md:60` is not wired here |
| REL-04 file validation/storage | Implemented (source-evidenced) + Test declared | `apps/api/src/files/file-validation.ts:8-12,106-125` (MIME allowlist, byte caps, server-derived extension/checksum), `files.service.ts:84-320` (owner-scoped keys, PENDING→READY/FAILED/DELETING/DELETED metadata), `storage.adapter.ts` (`StoragePort` + local adapter); `file-validation.spec.ts`, `files.service.spec.ts`, `storage.adapter.spec.ts` declare tests | No upload A/read B test result; no measured storage or authorization behavior. Caveat from `docs/reliability.md:109`: signed read route is not mounted and `/uploads/` remains public |
| FE-03 SSE UI throttling | Implemented (source-evidenced), not wired | `apps/web/src/hooks/use-stream-throttle.ts:20-106` buffers deltas into at most one state update per 50 ms default interval with a lossless `flush()`; spec declares timing and ordering scenarios | No consumer outside the spec. Chat page does not import it. No profiler evidence justifies wiring it; no before/after jank measurement |
| Sprint 6 gate (`roadmap:798`) | NOT MET | — | No before/after regression evidence, no UI-state/media-leak verification, no bundle or latency baseline to explain a regression |

## 3. Refactor summary — what changed in source

**Frontend.** The speaking feature is split into API, components, hooks, schemas, types, utilities, and tests under `apps/web/src/features/speaking/`, and the speaking page is composition over those pieces rather than a monolith. Recording state stops media tracks, revokes object URLs, and aborts in-flight requests on unmount (`use-audio-recorder.ts`, `use-speaking-feedback.ts`). Server state uses TanStack Query with user-scoped keys (`apps/web/src/lib/query-keys.ts:31-43,82-97`) and invalidation after mutation; typed errors are centralized in `apps/web/src/lib/errors.ts:13-105`. Shared async UI states are available in `apps/web/src/components/features/async-state.tsx`.

**Chat stream reliability.** `apps/web/src/lib/sse-parser.ts` is the shared chunk-safe parser: it accumulates bytes across chunks, supports CRLF/bare CR, decodes multibyte UTF-8 with `TextDecoder`, rejects malformed terminal events, caps buffer growth, and only accepts a well-formed `completed` event as success. The chat page uses `parseSseStream`, separates transport state from provisional answer display, reuses one operation key through 401 refresh and reconnects, checks durable operation status when the stream ends without a verified terminal, and only clears the AbortController it still owns. Client-side debit and the post-SSE `persist()`/`consumeAndRun()` path are absent from this page.

**Backend reliability supporting the frontend.** Chat streaming keeps reserve/settle/refund behind `apps/api/src/ai-operations/` and sends `completed` only after DB finalize; EOF, deadline, and disconnect produce `failed` with allowlisted codes. `apps/api/src/ai-operations/` also supplies fenced leases, bounded attempts, and deterministic refund ledger keys. Redis-backed limiters exist in both services with documented failure policies. FastAPI caps streamed output and tokens and revalidates cached JSON before serving it. File uploads use MIME/size validation, server-generated owner-scoped keys, checksums, and status transitions behind a `StoragePort`.

These are structural facts about the checked-out source. None of them is a runtime proof.

## 4. Explicitly unmeasured — do not present as results

The following items have **no captured measurement in this repository**. Where a document or configuration value exists, it is a plan, template, or proposed starting point only.

| Item | Current evidence status | What would constitute evidence |
|---|---|---|
| FE-03 React Profiler, network waterfall, bundle output, Lighthouse | NOT RUN; `docs/frontend-performance.md` is a TEMPLATE with every cell `NOT MEASURED` | Run-specific artifacts with SHA, runtime, conditions, command, exit code, and raw output |
| LCP / INP / CLS on real or emulated device | NOT MEASURED | `docs/frontend-performance.md:77-103` rows filled from recorded runs |
| SSE TTFT, delta/s, dropped frames, event loss under load | NOT MEASURED | Fake-provider load run plus terminal-event/final-text comparison against persisted fixture |
| PERF-01 p95 read/SRS/token latency, error rate, resource utilization | NOT MEASURED; roadmap targets at `:941-948` are proposed staging SLOs | `docs/benchmarks/` run report with workload, dataset, machine, command, results, confidence/limitations |
| PERF-02 horizontal-scale lab (two API instances, reconnect to other instance, restart during request) | NOT RUN | Multi-instance run report with invariant checks; no Kubernetes claim |
| OPS-03 metrics/traces (`http_request_duration_seconds`, `ai_time_to_first_token_seconds`, `sse_disconnects_total`, `db_pool_wait_seconds`, etc.) | TARGET only at `roadmap:917-935`; no metrics/trace data found in checked source | Instrumented dashboards/traces with recorded samples and low-cardinality labels |
| DB `EXPLAIN ANALYZE` index evidence | NOT RUN; `docs/benchmarks/due-cards.md`, `chat-history.md`, `history.md` record query shapes and plans with `NOT MEASURED`/`NOT RUN` cells | Before/after plans on the same synthetic dataset and parameters, including write cost and index size |
| Cache hit-rate tuning | NOT MEASURED; no hit/miss counter found in `apps/ai-service/app/services/cache.py` | Recorded hit/miss samples with key definition and invalidation policy |
| Rate-limit capacity validation | NOT VALIDATED; chat 10 req/min/user, 1 turn/conversation, content 3/min/user, 2 concurrent jobs, upstream concurrency 4-8 are staging starting limits at `roadmap:461-462` | Two-instance 429/Retry-After test and load report; do not call starting limits proven capacity |
| Connection budget | NOT MEASURED; `docs/benchmarks/connection-budget.md` uses symbolic inputs and illustrative `L=100` | `SHOW max_connections;`, effective pool size, and observed pool-wait under load |
| FE-02 accessibility audit | PROCEDURE ONLY; `docs/accessibility-audit.md:3` explicitly contains no findings | Browser/keyboard/screen-reader evidence and contrast ratios |
| Chat billing E2E / AI-operation concurrency tests | Test files and declared scenarios exist; no pass result collected | Captured test command, exit code, counts, and failure IDs |
| Sprint 6 gate | NOT MET | Before/after regression evidence, preserved UI state, no media leak, explained bundle/latency changes |

**No benchmark artifact exists to cite as a performance result.** The files under `docs/benchmarks/` are plans and templates. If later agents add measured reports, link them here by path and cite their recorded conditions; do not fill these cells from code reading or from the roadmap's proposed SLOs.

## 5. Gate assessment and follow-ups

The refactor inventory is source-evidenced, but the Sprint 6 gate is not met. The roadmap's Definition of Done requires verification by test or evidence, build/type-check/lint pass for the change scope, and before/after measurement when a performance improvement is claimed. This slice ran none of those checks.

Re-run protocol (all commands **NOT RUN** for this report):

1. Re-check `git rev-parse HEAD` and the dirty-file list; because the tree was dirty and changing concurrently, re-derive these verdicts if source differs.
2. Run the declared frontend unit tests (`sse-parser.spec.ts`, `use-stream-throttle.spec.ts`, `async-state.spec.tsx`, speaking tests) and capture exit codes and counts.
3. Run chat billing E2E and AI-operation specs; verify no duplicate debit, no fabricated reply, terminal-event integrity, and replay after commit.
4. Execute `docs/frontend-performance.md` §4 P0-P8 with fake provider and synthetic fixtures; fill only measured cells and keep the no-fabrication rule in §0.
5. Execute the DB labs in `docs/benchmarks/due-cards.md` and `docs/benchmarks/chat-history.md` before promoting any candidate index; record write overhead as well as read plans.
6. Wire and verify OPS-03 metrics before quoting TTFT, event-loss, or pool saturation numbers.
7. Reconcile the legacy-backend caveat in `apps/web/src/app/(dashboard)/chat/page.tsx:6-9`: until the operation/status endpoint is deployed, the legacy path must remain visibly incomplete and must not be reported as a successful chat flow.

## 6. Out-of-scope changes recorded, not made

Only `docs/sprint6-report.md` was edited. No code, migration, config, test, or neighboring document was changed. Specifically deferred: wiring `useStreamThrottle` into the chat page, applying candidate DB indexes, mounting the signed file-read route, adding metrics dependencies, changing rate-limit values, running package managers or tests, and committing changes.
