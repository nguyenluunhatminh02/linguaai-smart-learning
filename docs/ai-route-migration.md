# REL-02 — AI route migration inventory

**Slice:** rel-20 (documentation only)
**Roadmap source:** `LinguaAI_Engineering_Roadmap.md:497-511` (REL-02), with the error-code contract from REL-01 (`:475-495`)
**Date:** 2026-11-28
**Status:** Read-only inventory. No application source was changed by this slice. `docs/ai-route-migration.md` is newly created.
**Evidence:** the 11 `route.ts` files under `apps/web/src/app/api/`, their `HEAD` versions for the "before" state, the NestJS controllers in `apps/api/src/`, the FastAPI routers in `apps/ai-service/app/routers/`, and the existing inventories `docs/billing-call-sites.md`, `docs/endpoint-inventory-content.md`, `docs/baseline.md`. No `.env` values, tokens, or provider keys were read or recorded.

This document records migration state at this point in time, not a claim that every route is migrated. "Before" is the tracked `HEAD` implementation (`3be6aa3` baseline); "after" is the implementation in the current working tree or the planned target where no backend handler exists yet.

## 1. Contract status legend

| Status | Meaning |
|---|---|
| `MIGRATED` | The web route is a thin proxy (or has been removed); provider calls, billing and durable operation state are owned by the backend, and the browser response contract is preserved. |
| `PARTIAL` | Part of the migration is done (e.g. storage moved behind the backend, but AI generation or lesson persistence is still in the web process), or a web proxy exists but the corresponding backend route is not present in `apps/api/src` yet. |
| `NOT STARTED` | The current route still contains the direct provider call, local persistence, or unkeyed billing described at `HEAD`; no replacement backend handler exists in the inspected source. |

A row is `MIGRATED` only when all three properties hold: no provider key in the web route, no token debit in the web route, and no browser-visible response shape change (or an explicitly updated UI call site). `PARTIAL` rows are the active migration risks: they still need a characterization test, a backend handler, a UI update, canary/staging, removal of the old caller, and a final grep proving no direct provider call remains (roadmap `:511`).

## 2. Route inventory (11 Next.js routes)

| # | Web route | Provider / side effects at `HEAD` | Current implementation | Status |
|---:|---|---|---|---|
| 1 | `POST /api/translation/generate` | Direct Groq chat completion; web called `/tokens/consume` (`translation_ai`, 3) with no idempotency key; raw model text leaked in a 502 `raw` field on parse failure. | Thin proxy to `POST /api/v1/translation/generate`; forwards JWT and a fresh `randomUUID()` key; maps backend status to the legacy `{ data }` / `{ error }` contract. | `PARTIAL` — target route is not present in `apps/api/src`. |
| 2 | `POST /api/listening/generate` | Direct Groq chat completion; web called `/tokens/consume` (`listening_generate`, 8) with a SHA-256 key; no operation record. | Thin proxy to `POST /api/v1/listening/generate`; validates topic/level/category before proxying; forwards a fresh `randomUUID()` key; legacy `{ data }` / `{ error }` preserved. | `PARTIAL` — target route is not present in `apps/api/src`. |
| 3 | `POST /api/speaking` | Direct Groq chat completion with a strict zod response schema and HTML escaping; no token charge. | Thin proxy to `POST /api/v1/speaking/feedback`; zod input validation and owner-scoped SHA-256 fallback idempotency key retained; forwards `{ operationId, data }` unchanged. | `PARTIAL` — target route is not present in `apps/api/src`. |
| 4 | `POST /api/speaking/topic` | Web called `/tokens/consume` (`speaking_feedback`, 10) with SHA-256 key, then called Groq directly; invalid JSON fell back to echoing raw model text. | Unchanged from `HEAD`: direct Groq call and web-owned debit remain. | `NOT STARTED` |
| 5 | `POST /api/cms/lessons/generate-from-transcript` | Admin-only direct Groq call; no token charge; raw model text leaked in a 502 `raw` field; draft review was not durable. | Admin-only proxy to `POST /api/v1/content-workflow/generate-from-transcript` plus `GET /api/v1/content-workflow/operations/:operationId` polling; returns the legacy `{ data, operationId }` shape. | `PARTIAL` — the two referenced backend routes are not present in `apps/api/src/content-workflow/content-workflow.controller.ts` (`:85-140` lists only submission CRUD and review). |
| 6 | `POST /api/listening/upload-user` | Direct Groq Whisper + chat completion, `fs.writeFileSync` into `public/uploads/audio`, local `cms-storage` lesson, web-owned `/tokens/consume` (`listening_generate`, 8). | Direct Groq Whisper + chat completion and local `cms-storage` lesson remain; audio bytes now go to `POST /api/v1/files/upload` with the caller's key, and file validation/10 MiB limit were tightened. | `PARTIAL` — storage moved behind the backend, AI and lesson persistence did not. |
| 7 | `POST /api/cms/upload` | Admin-only image proxy to `http://localhost:4000/api/v1/files/upload`, with local filesystem fallback to `public/uploads/lessons` on backend failure. | Same `CMS_BACKEND_URL` default (`4000`) and same local fallback remain; added `utcDate` naming and a regression test at `apps/web/src/app/api/cms/upload/route.test.ts`. | `PARTIAL` — proxy exists; fallback and port inconsistency are unresolved. |
| 8 | `POST /api/cms/upload-audio` | Admin-only proxy to `http://localhost:3001/api/v1/files/upload` with strict magic-byte and MIME/extension checks. | Proxy-only, backend-persisted; rebuilds the `File` with a random name before forwarding; no local fallback. | `MIGRATED` (storage only; no AI call in this route). |
| 9 | `POST /api/auth/refresh` | Proxy to `POST /api/v1/auth/refresh-token`; forwards only the refresh cookie, strips refresh credentials from the JSON body, relays `Set-Cookie`. | Unchanged. | `MIGRATED` (non-AI auth proxy, listed for completeness of the route tree). |
| 10 | `GET /api/cms/lessons` | Admin-only proxy to `GET /api/v1/admin/content`, with a local-JSON fallback (backend unavailable) and client-side filtering/pagination. | Unchanged. | `PARTIAL` — backend admin content route exists (`apps/api/src/admin/admin.controller.ts:172`), but the local `cms-storage` fallback remains. |
| 11 | `GET/PUT/DELETE /api/cms/lessons/[id]` | GET proxied to public `/api/v1/lessons/:id` (the public `/lessons` controller is `apps/api/src/admin/lessons.controller.ts:21`); PUT/PATCH and DELETE proxied to `/api/v1/admin/content/:id`; dev-only local-JSON fallback. | Unchanged. | `PARTIAL` — backend handlers exist (`admin.controller.ts:185,194`; `lessons.controller.ts:33`), dev fallback remains. |

The only direct `GROQ_API_KEY` references left under `apps/web/src/app/api` are in `/api/speaking/topic` (`route.ts:7`) and `/api/listening/upload-user` (`route.ts:17-20`). All other AI routes in the tree are proxies.

## 3. Before / after contract detail

### 3.1 Translation generation — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | `apps/web/src/app/api/translation/generate/route.ts` called the Groq chat endpoint with `GROQ_API_KEY`, `GROQ_MODEL` (default `llama-3.3-70b-versatile`) and `max_tokens: 1024`. | Same path authenticates with `verifyAuthHeader`, parses the JSON body, then calls `POST /api/v1/translation/generate` with the bearer token and `Idempotency-Key: randomUUID()`. No provider key in the route. |
| Auth | Web JWT verification only; backend `/tokens/consume` accepted a bearer token. | Web verification retained; backend must enforce JWT + ownership from the forwarded bearer token. |
| Billing | Web called `/tokens/consume` with `{ feature: 'translation_ai', cost: 3 }` and no key; `TokensService` ignores `cost` and charges the catalog price. Retries debited again (`docs/billing-call-sites.md:56`). | Planned owner: NestJS `AiOperationsService` reserve with feature `translation_ai` (3 credits, `AI_OPERATION_COSTS` in `ai-operations.policy.ts:39-50`) and `markTerminal` with refund on known provider failures. No backend `/translation/generate` handler exists yet; do not charge in both tiers. |
| Response | `200 { data: { title, sentences, ... } }`; parse failure returned `502 { error: 'Failed to parse AI response', raw: <model text> }`. | `200 { data: <backend data> }` preserved for the page (`apps/web/src/app/(dashboard)/translation/page.tsx:436`); backend map: 400/401/402/409/429/502/500 → same web status with stable messages. Raw model text no longer returned. |
| Contract status | — | `PARTIAL`: browser contract is intact, but the target `/v1/translation/generate` handler is missing. Backend route must be added before the web proxy can be called `MIGRATED`; then delete the old direct-provider caller and verify no key is reachable from web. |

### 3.2 Listening generation — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Direct Groq chat completion after local validation of `topic` (1-500 chars), `level`, `category`. | Proxy to `POST /api/v1/listening/generate`; the same input validation remains at the edge, and trimmed/normalized fields are forwarded. |
| Auth | Web JWT verification; public `/tokens/consume` with bearer token. | Web verification retained; backend must authorize and scope the operation. |
| Billing | Web debit before AI: `{ feature: 'listening_generate', cost: 8 }` with SHA-256 key over `user.id:listening_generate:topic:level:category` (keyed, but no operation record or refund). | Planned owner: backend AI operation `listening_generate` (8 credits). The current proxy sends a fresh UUID key per attempt, so until a backend handler dedupes by durable operation key, a retry can charge again. Queue long generation jobs per roadmap `:505`, `:513-542`. |
| Response | `200 { data: <generated exercise> }`; parse failure `502 { error, raw }`. | `200 { data: <backend data> }` preserved; status mapping identical to translation. Raw model text removed. |
| Contract status | — | `PARTIAL`: validation and response shape are correct; backend `/v1/listening/generate` and quota/operation ownership are outstanding. |

### 3.3 Speaking feedback — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Direct Groq call with a strict zod schema: `text` ≤ 4000 chars, `topic` ≤ 200, `level` ≤ 20 (`[A-Za-z0-9_-]+`), `language` ≤ 30 (`[a-z_-]+`); response parsed into a fixed feedback shape and HTML-escaped. No token charge. | Proxy to `POST /api/v1/speaking/feedback` with a 120 s abort timeout; input zod schema retained; caller idempotency key is accepted when it matches `^[A-Za-z0-9._:-]{1,128}$`, otherwise derived as SHA-256 over `user.id:speaking_feedback:text:topic:level:language`. |
| Auth | Web JWT verification only. | Web verification retained; backend is expected to authorize the operation from the bearer token and enforce ownership. |
| Billing | None in this route; the separate WebSocket `audio_data` path charges `speaking_feedback` (10) with a fresh per-event key (`docs/billing-call-sites.md:28`). | Planned owner: backend AI operation `speaking_feedback` (10 credits) for the feedback call. Avoid a second charge in the web tier. There is no backend `/speaking/feedback` handler in `speaking.controller.ts:86-124` (only `transcribe`, `history`, `:id`). |
| Response | Legacy feedback object from the model, HTML-escaped by the web route. | Backend must return `{ operationId, data }`; the web route forwards it unchanged. The page call site (`apps/web/src/app/(dashboard)/speaking/page.tsx:241` uses `/api/speaking/topic`) must be checked before deleting any old schema code. |
| Contract status | — | `PARTIAL`: input validation and status forwarding are in place; backend route, response schema validation and operation-backed billing are missing. |

### 3.4 Speaking topic — `NOT STARTED`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Reads `level`, `category`, `language` from JSON; direct Groq chat completion (`temperature: 1`, `max_tokens: 512`). | Same. No proxy and no operation record. |
| Auth | `verifyAuthHeader` rejects unauthenticated callers. | Same; backend must additionally enforce ownership when the provider call moves. |
| Billing | Web calls `/tokens/consume` with `{ feature: 'speaking_feedback' }` and SHA-256 key over `user.id:speaking_topic:lang:level:category`; 400 mapped to "Insufficient tokens", provider errors to 502. Paid downstream failures are not refunded. | Planned owner: backend AI operation with a dedicated `speaking_topic` feature and price, or reuse `speaking_feedback` (10) only if ledger labeling is accepted; no double-charge during canary. |
| Response | `200 { data: { topic, prompt, tips, samplePhrases, duration, difficulty } }`; invalid JSON returns `200 { data: { topic: 'Error', prompt: <raw model text>, tips: [], ... } }`. | Must preserve the six-field shape but reject invalid JSON (e.g. `INVALID_AI_OUTPUT` → 502) instead of echoing raw text; update `apps/web/src/app/(dashboard)/speaking/page.tsx:241` to the new contract. |
| Contract status | — | `NOT STARTED`: no migration work is present in the current file. |

### 3.5 CMS generate-from-transcript — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Admin-only direct Groq call; `transcript` required, `language`/`level` interpolated into a prompt; `temperature: 0.3`, `max_tokens: 2048`; on JSON parse failure returned `502 { error: 'Failed to parse AI response', raw: <model text> }`. | Admin-only proxy: validates `transcript` ≤ 20 000 chars, language in a fixed allowlist, level `A1..C2`; obtains a client operation id from `x-client-operation-id` or `idempotency-key` (UUID fallback, ≤ 128 chars); POSTs to `/content-workflow/generate-from-transcript` then polls `/content-workflow/operations/:operationId` up to 20 times at 1 s intervals. |
| Auth | Web checks `verifyAuthHeader` + `isAdmin`. | Web check retained; the same bearer token is forwarded so backend can authorize the operation. |
| Billing | None. | Planned owner: backend operation reservation with draft persistence; no charge in the web tier. |
| Response | `200 { data: { vocabulary, questions } }` or `502` with raw text. | `200 { data: <draft>, operationId }`; mapped error codes are `VALIDATION_ERROR`, `INSUFFICIENT_CREDITS`, `OPERATION_CONFLICT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `INVALID_AI_OUTPUT`, `OPERATION_UNKNOWN`, `INTERNAL_ERROR` (roadmap `:480`); `202` for still-processing jobs. Publication stays in the review workflow; no implicit publish. |
| Contract status | — | `PARTIAL`: the web side is ready, but the referenced backend routes are absent from `content-workflow.controller.ts`. Restore the `{ data }` shape expected by `lesson-form.tsx:1278` during canary; the additional `operationId` field is additive. |

### 3.6 Listening upload-user — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Accepted multipart audio (≤ 15 MB) or a YouTube source; Groq Whisper + Groq chat; wrote audio into `public/uploads/audio`; created a lesson via `cms-storage` with `isUserUploaded: true`, `userId`, and `content.audioUrl`. | Same input modes with a 10 MiB decoded-byte budget, MIME/extension allowlists and magic-byte checks; audio bytes are uploaded to `POST /api/v1/files/upload` with a backend-provided URL; lesson is still created via `createLesson` from `cms-storage`. |
| Auth | `verifyAuthHeader`; owner id stored in the local lesson record. | Same; backend `/files/upload` receives the bearer token and enforces owner-scoped object keys. |
| Billing | Web called `/tokens/consume` with `{ feature: 'listening_generate', cost: 8 }`; key forwarded only when the client supplied one — retries could double-charge (`docs/billing-call-sites.md:55`). | Web still calls `/tokens/consume` (8) with `req.headers['idempotency-key'] || randomUUID()`. Planned owner: backend AI operation for STT + generation + lesson creation, charged once with a durable key. |
| Response | `200 { data: <created lesson from cms-storage> }`. | Same local `{ data }` shape today; target should be a backend-created lesson with `content.audioUrl` from the storage service and a stable `operationId`. |
| Contract status | — | `PARTIAL`: storage moved behind the backend; provider calls, billing and lesson ownership are still in the web process. |

### 3.7 CMS image upload — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Admin-only; validated JPEG/PNG/GIF/WebP, ≤ 5 MB, magic bytes; proxy to `CMS_BACKEND_URL` (default `http://localhost:4000/api/v1`) then local `fs.writeFileSync` fallback when the backend is down. | Same; fallback retained. Test added at `apps/web/src/app/api/cms/upload/route.test.ts`. |
| Auth | Web verifies JWT + admin role; backend receives the bearer token. | Same, but the fallback writes files without backend authorization. |
| Billing | None. | None expected. |
| Response | Proxy success returns `json.data ?? json`; fallback returns `{ url: '/uploads/lessons/<uuid>.<ext>', name, size, type }`. | Unchanged; the fallback URL is local to the web instance and cannot be relied on in multi-instance deployments. |
| Contract status | — | `PARTIAL`: remove the local fallback and use the same base URL as `upload-audio` (`NEXT_PUBLIC_API_URL` / 3001), then re-run `route.test.ts` against the proxy-only contract. |

### 3.8 CMS audio upload — `MIGRATED`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Admin-only; validated MIME/extension agreement and magic bytes, ≤ 50 MB; proxy to `http://localhost:3001/api/v1/files/upload`. | Proxy-only; rebuilds the `File` from validated bytes with a random name and forwards it; no local fallback (writing to `public/` after a backend rejection would bypass authorization). |
| Auth | Web verifies JWT + admin role; backend receives the bearer token. | Same. |
| Billing | None. | None. |
| Response | `{ url|data }` from `files/upload`; 401/403 mapped to 401, other backend failures to 502. | Unchanged. |
| Contract status | — | `MIGRATED` for storage ownership; no AI call or token charge belongs to this route (roadmap `:508`). |

### 3.9 Auth refresh — `MIGRATED` (out-of-scope reference)

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | Read only `refreshToken` from cookies; POSTed to `/api/v1/auth/refresh-token`; stripped refresh fields from JSON; forwarded `Set-Cookie`. | Unchanged. |
| Auth | Refresh cookie; no bearer token. | Same; backend `POST /auth/refresh-token` exists (`auth.controller.ts:134`). |
| Billing | None. | None. |
| Response | Sanitized JSON + relayed cookies; network error → 401 `{ message: 'Refresh failed' }`. | Unchanged. |
| Contract status | — | `MIGRATED`; documented only because it is part of the web API tree. |

### 3.10 CMS lesson collection — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | `GET`: admin-only proxy to `/admin/content` with local-JSON fallback and edge-side filters/pagination. `POST`: admin-only, backend first, dev-only `cms-storage` fallback. | Unchanged. A leftover `console.log` of the auth header exists at `route.ts:297` and must be removed in the follow-up slice (do not log credentials). |
| Auth | Web verifies JWT + admin role for both methods; backend receives the bearer token. | Same; backend `/admin/content` handlers exist (`admin.controller.ts:172,179`). |
| Billing | None. | None. |
| Response | `{ data: <lessons>, meta: { page, limit, total, totalPages } }`; `POST` returns a CMS-shaped lesson with 201. | Preserve this shape when removing the local fallback; backend rows are converted by `dbToCms` / `cmsToDb` in the route. |
| Contract status | — | `PARTIAL` — proxy is established; local JSON persistence is still a second source of truth. |

### 3.11 CMS lesson item — `PARTIAL`

| Aspect | Before (`HEAD`) | After (working tree / planned target) |
|---|---|---|
| Web route | `GET` proxy to `/lessons/:id` with local fallback; `PUT` → `PATCH /admin/content/:id`; `DELETE` → `DELETE /admin/content/:id`; dev-only local fallback for mutations. | Unchanged. |
| Auth | GET has no local auth check and calls the public lessons endpoint; PUT/DELETE verify JWT + admin role. | Same; keep the public/student GET contract distinct from the admin mutation contract. |
| Billing | None. | None. |
| Response | GET returns a CMS-shaped lesson; PUT returns the updated lesson; DELETE returns a raw backend body or `{ success: true }` from fallback. | Preserve shapes while removing the local fallback; backend handlers exist at `admin.controller.ts:185,194` and `lessons.controller.ts:33`. |
| Contract status | — | `PARTIAL` — proxy is established; dev fallback and the public-vs-admin GET distinction remain. |

## 4. Backend landing zones

| Target | Exists today? | Evidence | Used by |
|---|---|---|---|
| `POST /api/v1/translation/generate` | No | No matching decorator under `apps/api/src` | #1 |
| `POST /api/v1/listening/generate` | No | No matching decorator under `apps/api/src` | #2 |
| `POST /api/v1/speaking/feedback` | No | `speaking.controller.ts:86-124` only has `transcribe`, `history`, `:id` | #3 |
| Speaking topic generation endpoint | No | No matching decorator under `apps/api/src` | #4 |
| `POST /api/v1/content-workflow/generate-from-transcript`, `GET /api/v1/content-workflow/operations/:operationId` | No | `content-workflow.controller.ts:85-140` only has submission CRUD and review | #5 |
| `POST /api/v1/listening/upload-user` (STT + generation + lesson) | No | No matching decorator; only `/files/upload` and speaking `/transcribe` exist for media | #6 |
| `POST /api/v1/files/upload` | Yes | `files.controller.ts:36` | #6, #7, #8 |
| `POST /api/v1/tokens/consume` | Yes | `tokens.controller.ts:21` | #4, #6 (legacy; roadmap BILL-02 asks to retire it) |
| `GET /api/v1/admin/content`, `POST`, `PATCH/DELETE /admin/content/:id` | Yes | `admin.controller.ts:172,179,185,194` | #10, #11 |
| `GET /api/v1/lessons/:id` | Yes | `lessons.controller.ts:33` | #11 |
| `POST /api/v1/auth/refresh-token` | Yes | `auth.controller.ts:134` | #9 |
| FastAPI `/v1/ai/{chat,reading,writing,grammar,content,errors,nlp}` | Yes | `apps/ai-service/app/routers/` (`chat.py:30,93,117`; `reading.py:14,26`; `writing.py:11,14`; `grammar.py:15,18`; `content.py:23,31,54`; `errors.py:13,17`; `nlp.py:12,22`) | Generation work delegated by NestJS |
| `AiOperationsService` (`findOrCreate`, `claimLease`, `markTerminal`, `maybeRefund`) | Yes | `apps/api/src/ai-operations/ai-operations.service.ts:63,112,185`; policy states/prices in `ai-operations.policy.ts:39-50,64-96` | Orchestration for #1-#6 |
| `GET /api/v1/chat/operations/:operationId` | Yes | `chat.controller.ts:680-740` | Reference for the status endpoint pattern; chat-only today |

No `/v1/ai/speaking/*` or `/v1/ai/translation/*` router was found in the FastAPI service; generation for routes #1-#6 must be added to a backend handler and then delegated through the existing AI client adapter (`apps/api/src/common/services/ai-client.service.ts`), not called from the web tier.

## 5. Migration gate per route

Apply this order to every `PARTIAL` / `NOT STARTED` row before changing its status to `MIGRATED` (roadmap `:511`):

1. Add a characterization test that pins the current browser-visible response shape, status codes, auth behavior and idempotency behavior.
2. Add the backend handler with server-authoritative billing via `AiOperationsService` (single charge, `operationId` returned); reuse the error codes from REL-01 (`VALIDATION_ERROR`, `INSUFFICIENT_CREDITS`, `OPERATION_CONFLICT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `INVALID_AI_OUTPUT`, `OPERATION_UNKNOWN`, `INTERNAL_ERROR`).
3. Point the web proxy at the new endpoint, keeping `{ data }` / `{ error }` (plus additive `operationId`) intact; update the page call site only when the contract genuinely changes.
4. Canary on staging with both tiers present but only one tier charging; compare status codes, response bodies and token ledger entries.
5. Delete the stale direct-provider caller and local fallback; verify with a source scan that no `GROQ_API_KEY` or `fs.writeFileSync` remains in that web route.
6. Record the resulting status in this document with the test and canary evidence.

## 6. Constraints and open issues

- No two billing flows during migration: the web `/tokens/consume` call and a backend operation reservation must not both debit the same user action. The current translation proxy's fresh `randomUUID()` key does not dedupe retries until the backend owns the operation.
- Feature-code mislabels must be fixed deliberately, not silently: `speaking_feedback` is currently reused for speaking topic and writing error analysis, and `translation_ai` for reading analyze-text (`docs/billing-call-sites.md:71`).
- `cms-storage` remains a second source of truth for lessons (#6, #10, #11). Moving it to the backend lessons/admin content API is required before calling those routes `MIGRATED`.
- Local filesystem fallbacks (#6, #7, #10, #11) are not multi-instance safe and can bypass backend authorization.
- `CMS_BACKEND_URL` defaults disagree: `cms/upload` and `cms/lessons` use port 4000; `cms/upload-audio` uses `NEXT_PUBLIC_API_URL` / 3001. Unify on the API base before removing fallbacks.
- `GET /api/cms/lessons/[id]` is unauthenticated at the edge and targets a public backend endpoint; keep student-facing reads separate from admin draft reads.
- The transcript-generation proxy calls backend paths that do not exist yet; until they are added it terminates with a controlled 502/202, not a silent success.
- Long jobs (transcript generation, upload-user with STT + generation) should move to a queue with `jobId = operationId` per REL-03 (`LinguaAI_Engineering_Roadmap.md:513-542`); the current 20 × 1 s poll loop is a transitional bridge.
- Route #3 (`/api/speaking`) has no browser caller in the inspected web tree; #4 (`/api/speaking/topic`) does. Confirm with the UI owner before deleting either caller.
- No tests were added in this slice because the only assigned path is this document; the regression tests listed above are follow-ups in their respective route directories.
- No `.env` values or API keys were read, printed, or written; only environment variable names were referenced from source code.
