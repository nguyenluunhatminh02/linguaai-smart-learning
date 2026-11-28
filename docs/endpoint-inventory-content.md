# Endpoint / Auth / Quota Inventory — Part D

**Slice:** base-02d
**Scope:** `apps/api/src/writing/`, `apps/api/src/reading/`, `apps/api/src/speaking/`, `apps/api/src/grammar/`, `apps/api/src/files/`
**Date:** 2026-11-28
**Status:** Read-only inventory; no source files were edited.

---

## 1. Global API policies (apply to all HTTP routes below)

| Policy | Value | Source |
|---|---|---|
| Global prefix | `/api` | `main.ts:112` |
| Versioning | URI, default version `v1` | `main.ts:126` |
| Effective base path | `/api/v1/<controller>/<route>` | |
| ValidationPipe | `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true` | `main.ts:150-156` |
| Global throttle | `HttpOnlyThrottlerGuard` (HTTP only; WS contexts skipped), default 100 requests / 60 s from `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS` | `app.module.ts:86-91, 45-54, 127-131` |
| CORS allowed headers | `Content-Type`, `Authorization`, `x-timezone-offset`, `Idempotency-Key` | `main.ts:104-109` |
| Request ID | Server UUID; inbound `x-request-id` accepted only when `^[A-Za-z0-9._-]{1,64}$` | `main.ts:132-148` |
| Idempotency header | Inbound `Idempotency-Key` accepted only when `^[A-Za-z0-9._:-]{8,64}$` | `main.ts:133, 138-140` |
| Swagger | Enabled outside production; production requires `SWAGGER_ENABLED=true` | `main.ts:158-169` |

All controllers in scope use `@ApiBearerAuth()` and `@UseGuards(JwtAuthGuard)`. Billing is server-authoritative: `TokensService.consumeTokens()` ignores client-supplied cost, validates the feature against `COSTS`, uses a serializable DB transaction, rejects negative balances with 403, and supports per-user/feature/amount idempotency via `token_transactions.idempotency_key` (`tokens.service.ts:103-178`). Daily free grant: 30 tokens (`tokens.service.ts:24`).

### Cost table used by this slice

| Feature key | Cost | Call sites in scope |
|---|---|---|
| `writing_feedback` | 10 | writing assess |
| `reading_generate` | 8 | reading generate |
| `translation_ai` | 3 | reading analyze-text |
| `grammar_explain` | 5 | grammar explain |
| `speaking_feedback` | 10 | speaking transcribe (after success), WS audio_data, writing error-analysis (reused) |

---

## 2. HTTP route inventory

### Writing — `/api/v1/writing` (all routes behind `JwtAuthGuard`)

| Route | Method | Auth / ownership | Input limits | Billing | AI call | Cache / idempotency |
|---|---|---|---|---|---|---|
| `assess` | POST | JWT; `userId` from `@CurrentUser('id')`, passed to persistence | `userText` ≤ 10 000 chars; `language` 2-30 letters/spaces; `targetLevel` in A1..C2; `promptText` ≤ 2 000 | 10 `writing_feedback`, before AI; idempotency key derived from user + client header or random UUID + payload hash; replay verified against the user's own transaction, then an identical prior submission is returned instead of a new AI call | `POST /v1/ai/writing/assess` via `AiClientService` | No reused AI cache; per-user submission dedupe by exact text/prompt/language; paid replay returns stored `ai_feedback` |
| `error-analysis` | GET | JWT; user-scoped submissions and token transaction checks | `language` optional (default english); `limit` clamped 1-20 (default 20) | 10 units charged under `speaking_feedback` (no dedicated `writing_error_analysis` price); key = user + language + limit + optional client key | `POST /v1/ai/errors/analyze` only when stored errors exist | In-process `Map` cache keyed by user/language/limit, TTL 5 min, max 200 entries, FIFO eviction; cache hit still verifies the token transaction exists |
| `history` | GET | JWT; `where.user_id = userId` | `page` ≥ 1 (no upper clamp); `limit` 1-100 (default 10) | None | None | None |
| `:id` | GET | JWT; controller `findFirst({ id, user_id })` ownership check → 404 before service read | `ParseUUIDPipe` on `id` | None | None | None |

### Reading — `/api/v1/reading` (all routes behind `JwtAuthGuard`)

| Route | Method | Auth / ownership | Input limits | Billing | AI call | Cache / idempotency |
|---|---|---|---|---|---|---|
| `generate` | POST | JWT; userId used for DB row ownership | `level`, `topic` strings; `wordCount` 100-1000 (default 300), `language` string (default english) | 8 `reading_generate` before AI; optional `Idempotency-Key` namespaced as `<userId>:<key>` | `POST /v1/ai/reading/generate` | Redis cache keyed by level/topic/language/wordCount for 24 h; cached prompt content reused but a fresh passage row is always created for the caller |
| `analyze-text` | POST | JWT; userId used only for billing | `text` 1-10 000 chars, `language` optional string | 3 `translation_ai` before AI; no idempotency key passed | `POST /v1/ai/nlp/analyze` | None |
| `recommendations` | GET | JWT; userId scopes recent-passage lookup and cache key | `language` optional (default english); `limit` clamped 1-50 (default 5) | None | None (curated topic pool + DB history) | Redis cache `recommendations:<userId>:<language>` for 1 h |
| `history` | GET | JWT; `where.generated_by_user_id = userId` | `page` clamped 1-10 000 (default 1); `limit` 1-100 (default 10) | None | None | None |
| `:id` | GET | JWT only; **no ownership filter** — `findUnique({ id })` returns any passage UUID | `ParseUUIDPipe` on `id` | None | None | None |

Note: `analyze-text` also has a route-local `@Throttle({ default: { ttl: 60000, limit: 10 } })` in addition to the global throttle.

### Speaking — `/api/v1/speaking` (all routes behind `JwtAuthGuard`)

| Route | Method | Auth / ownership | Input limits | Billing | AI call | Cache / idempotency |
|---|---|---|---|---|---|---|
| `transcribe` | POST | JWT; userId passed to service and billing | `audio` base64 string ≤ 2 000 000 chars (service cap); optional `mimeType` (MIME format, ≤ 100 chars), `language` restricted to 8 supported names | 10 `speaking_feedback` **after** successful transcript; no key passed from controller (service accepts optional `idempotencyKey`) | Groq Whisper (`GROQ_MODEL_STT`, default `whisper-large-v3`) called directly from the API, not via `AiClientService` | None. No key in production; dev without API key, or dev transcription failure, returns canned transcript — and in the no-key path returns before charging |
| `history` | GET | JWT; `where.user_id = userId` | `page` ≥ 1 (no upper clamp); `limit` clamped 1-50 (default 10) | None | None | None |
| `:id` | GET | JWT; `findFirst({ id, user_id })` → 404 if not owned | raw string id (no UUID pipe) | None | None | None |

### Grammar — `/api/v1/grammar` (all routes behind `JwtAuthGuard`)

| Route | Method | Auth / ownership | Input limits | Billing | AI call | Cache / idempotency |
|---|---|---|---|---|---|---|
| `explain` | POST | JWT; userId used for billing and key scoping only (no user data persisted) | `grammarPoint` ≤ 500 chars; `language` optional string; `userQuestion` ≤ 1 000 chars | 5 `grammar_explain`; client `Idempotency-Key` hashed with JWT secret + userId + feature | `POST /v1/ai/grammar/explain` | Redis cache 1 h. Key includes userId when supplied; because the controller calls `explain(dto)` without userId, caching is limited to generic questions without `userQuestion` (user-specific questions skip cache) |

Route-local rate limit: `@RateLimit({ limit: 20, window: 60, keyPrefix: 'grammar_explain' })` (Redis-backed `RateLimitGuard`, separate from the global throttler).

### Files — `/api/v1/files` (all routes behind `JwtAuthGuard`)

| Route | Method | Auth / ownership | Input limits | Billing | AI call | Storage |
|---|---|---|---|---|---|---|
| `upload` | POST (multipart/form-data, `FileInterceptor('file')`) | JWT; no per-user ownership on stored file — URL is public | MIME allowlist: jpeg/png/gif/webp ≤ 10 MB; mpeg/mp3/wav/ogg/webm/mp4/m4a/aac/flac ≤ 50 MB. MIME checked from client-supplied `file.mimetype`, not content signature | None | None | Synchronous `fs.writeFileSync` into `<cwd>/uploads`, UUID filename + original extension; URL `<API_URL>/uploads/<filename>`; static assets exposed publicly with `X-Content-Type-Options: nosniff` |
| `tts` | POST | JWT; no ownership (generates a public URL) | Inline body `{ text, language }` with **no DTO validation** (ValidationPipe cannot constrain an inline type); service only checks both fields are truthy | None (external Google Translate TTS URL, no token cost) | No LLM; builds `https://translate.google.com/translate_tts?...` URL | None |

---

## 3. WebSocket inventory — `/speaking-ws`

Gateway: `speaking.gateway.ts`. Path is `/speaking-ws` (gateway paths are not affected by the HTTP global prefix). `maxPayload` 8 MiB; `cors: false`.

### Connection policy

1. Origin allowlist from `CORS_ORIGINS`, falling back to `FRONTEND_URL`, then `http://localhost:3000`; a present-but-unlisted Origin is rejected (missing Origin accepted for non-browser clients).
2. JWT is mandatory for every environment, supplied as `?token=<access token>` in the connection URL. The gateway checks `payload.type === 'ACCESS'`, string `sub`, JTI revocation/expiry, that the user exists and `is_deleted: false`, and that `is_active` is true. Failures send `error` and close with code 1008.
3. On every paid `audio_data` frame the token/account state is re-verified (`verifyConnection`) so logout, expiry or deactivation closes an already-open socket.
4. `JwtModule` registration fails at startup if `JWT_SECRET` is missing (`speaking.module.ts:14-20`).

### Events

| Direction | Event | Policy / limits | Billing | AI / data |
|---|---|---|---|---|
| Client → server | `start_session` | Requires authenticated, non-rejected socket; rate-limited by `allowMessage`; topic ≤ 500 chars, level in A1..C2 (default B1), language in 8 supported names (default english) | None | Stores session in in-process `Map` keyed by connection sid; emits `session_ready` |
| Client → server | `audio_data` | Authenticated + active session required; one frame at a time (`_busy` prevents overlap); base64 ≤ 7 MiB and charset-validated; MIME restricted to 8 audio types; max 20 messages per 60 s window per connection, enforced in memory | 10 `speaking_feedback` charged before STT/LLM, key `speaking-ws-<sid>-<timestamp>`; insufficient balance sends `error` and returns | Groq Whisper STT then Groq Llama streaming feedback (defaults `llama-3.3-70b-versatile`), transcript truncated to 8 000 chars, `max_completion_tokens: 1200`; result persisted best-effort to `speaking_submissions` |
| Server → client | `connected` | Sent on successful connection | — | Carries `sid` |
| Server → client | `session_ready` | After `start_session` | — | Empty payload |
| Server → client | `status` | Phase `transcribing` then `analyzing` | — | Vietnamese progress messages |
| Server → client | `transcript` | After STT | — | Recognized text |
| Server → client | `feedback_chunk` | Per stream token | — | Incremental LLM feedback |
| Server → client | `feedback_done` | Final event | — | Transcript, cleaned feedback, parsed `[SCORES]` (0-100 overall/grammar/vocabulary or null), `feedbackBasis: 'transcript'`, `scoresAvailable` |
| Server → client | `error` | Invalid input, busy, no session, rate limit, auth failure, insufficient tokens, upstream failure (sanitized message) | — | Raw SDK/upstream errors are never relayed |
| Lifecycle | disconnect / reject | Aborts in-flight Groq calls via `AbortController`, deletes session, closes socket with 1008 on rejection | — | No submission row written for rejected/aborted sockets |

The global `ThrottlerGuard` is HTTP-only (`shouldSkip` returns true for WS contexts); WS rate limiting is entirely the gateway's per-process in-memory counter.

---

## 4. AI-service and direct-provider calls

| Caller | Upstream | Path / model | Billed feature |
|---|---|---|---|
| `WritingService.assess` | AI service (via `AiClientService`, base URL `<AI_SERVICE_URL>/v1`) | `/v1/ai/writing/assess` | `writing_feedback` (10) |
| `WritingService.analyzeErrors` | AI service | `/v1/ai/errors/analyze` | `speaking_feedback` (10, reused) |
| `ReadingService.generate` | AI service | `/v1/ai/reading/generate` | `reading_generate` (8) |
| `ReadingService.analyzeText` | AI service | `/v1/ai/nlp/analyze` | `translation_ai` (3) |
| `GrammarService.explain` | AI service | `/v1/ai/grammar/explain` | `grammar_explain` (5) |
| `SpeakingService.transcribe` | Groq SDK direct | Whisper `GROQ_MODEL_STT` (default `whisper-large-v3`) | `speaking_feedback` (10, after success) |
| `SpeakingGateway.onAudioData` | Groq SDK direct | Whisper STT + Llama feedback (`GROQ_MODEL`, default `llama-3.3-70b-versatile`) | `speaking_feedback` (10, before AI) |
| `FilesService.generateTTS` | Public Google Translate TTS URL (client-side fetch) | `translate.google.com/translate_tts` | None |

`AiClientService` adds `X-API-Key` (first entry of `AI_SERVICE_API_KEYS`) and `X-Request-ID`, uses a 60 s timeout, and retries only connection-level errors that provably occurred before the request reached the AI service (3 attempts, 1 s/2 s backoff). 4xx errors are mapped through with the AI service's `detail` message; 5xx/timeouts are not retried to avoid duplicate billed completions.

---

## 5. Gaps and observations

1. **Reading `GET /reading/:id` has no ownership filter** (`reading.service.ts:165-167`). Any authenticated user who knows a passage UUID can read another user's generated passage. Writing and speaking detail routes check ownership in the controller; this one does not.
2. **Writing `error-analysis` has no dedicated token price.** It is charged as `speaking_feedback` (10) with a local constant kept in sync manually (`writing.controller.ts:16, 177-193`). A rename or price change in `TokensService.COSTS` could desynchronize the validation check.
3. **WS rate limits are per-process in-memory** (`speaking.gateway.ts:434-446`, sessions/token revocation maps likewise). They do not hold across multiple API instances or restarts; the REST `grammar_explain` and `analyze-text` limits are Redis/global-throttler backed by comparison.
4. **File upload validates declared MIME, not content signature.** A client can label arbitrary bytes as `image/png` (within size limits). Files are written synchronously to local disk and served publicly from `/uploads/`; horizontal scaling and shared storage are not addressed.
5. **`POST /files/tts` uses an inline body type**, so the global `ValidationPipe` cannot enforce text/length/language validation; the service only checks truthiness and interpolates `language` into the upstream URL after lowercasing.
6. **`/speaking/transcribe` is charged only after a successful transcript.** In development with no Groq key, or on dev-mode transcription failure, a canned transcript is returned without a token debit; in production with no key it returns 503. The service's optional `idempotencyKey` is not exposed by the HTTP controller.
7. **`GET /writing/history` and `GET /speaking/history` clamp only the lower bound of `page`**, unlike reading history which caps it at 10 000; a very large page produces a large DB `skip`.
8. **Writing assess and error-analysis use in-process/short-lived replay protections** (submission dedupe and a 200-entry `Map`) while idempotency transactions are durable; a process restart loses the AI-response caches but not the token ledger.

---

## 6. Summary counts

- HTTP routes inventoried: **15** (writing 4 + reading 5 + speaking 3 + grammar 1 + files 2). The planning-phase estimate of 12 undercounted; the verified count is from controller route decorators.
- WebSocket events inventoried: **9** (`connected`, `session_ready`, `start_session`, `audio_data`, `status`, `transcript`, `feedback_chunk`, `feedback_done`, `error`).
- AI-backed operations: **5 via the AI service**, **3 via direct Groq calls** (HTTP transcribe, WS STT, WS LLM), plus 1 external TTS URL generator.
- Paid operations: **7** (writing assess, writing error-analysis, reading generate, reading analyze-text, speaking transcribe, WS audio_data, grammar explain).
