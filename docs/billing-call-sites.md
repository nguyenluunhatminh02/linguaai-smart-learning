# BILL-02 — Billing call-site inventory

Scope: roadmap item BILL-02 (`LinguaAI_Engineering_Roadmap.md:203-230`). Every call to `consumeTokens`, `/tokens/consume`, `consumeAndRun`, and `useTokenGate` under `apps/api` and `apps/web` is listed below with its feature code, server handler, billing owner, and explicit double-charge verdict. This is a read-only inventory; no application source was changed by this slice.

## Verdict legend

| Verdict | Meaning |
|---|---|
| No | A stable, user-scoped idempotency key reaches `TokensService.consumeTokens`; replay returns the stored transaction without a second debit. |
| Risk | Debit is keyed, but the key is client-supplied/optional, un-namespaced, server-generated per attempt, or another path can debit the same user action. A retry or parallel path can charge twice. |
| Yes | The same user action reliably produces two debits, or a retry with no stable key produces a fresh debit. |
| N/A | Test or non-debiting client helper; no production debit occurs at this line. |

Billing owner is the component that actually calls `TokensService.consumeTokens`. UI components and Next.js proxy routes are never billing owners on their own: they either only read/refresh balance or call the public consume endpoint. `TokensService.consumeTokens` (`apps/api/src/tokens/tokens.service.ts:103`) ignores the optional `_cost` argument and always uses `TokensService.COSTS[feature]`; an unknown feature throws `BadRequestException`. A key hit is accepted only when the stored transaction matches the same user, feature, and amount (`tokens.service.ts:117-133`); otherwise the request is rejected or debited afresh.

## API — direct server-side debits

| Call site | Feature code | Server handler | Billing owner | Double-charge verdict |
|---|---|---|---|---|
| `apps/api/src/chat/chat.controller.ts:70` | `ai_chat` (5) | `POST /chat/send` → `ChatController.send` | `TokensService` via `ChatController` | Risk — the header key is user-scoped (`${userId}:${idempotencyKey}`) and dedupes a replay of `/chat/send`, but `POST /chat/stream` (`chat.controller.ts:74-122`) performs the same paid AI turn for free and the web client persists via `/chat/send` with no key (`apps/web/src/app/(dashboard)/chat/page.tsx:231-235`). The same turn can be billed once by `/chat/send` and left unbilled by `/chat/stream`; concurrent or retry paths have no shared operation id. |
| `apps/api/src/reading/reading.controller.ts:30` | `reading_generate` (8) | `POST /reading/generate` → `ReadingController.generate` | `TokensService` via `ReadingController` | No — key is namespaced as `${userId}:${idempotencyKey}`; a repeat with the same header returns the stored transaction. |
| `apps/api/src/reading/reading.controller.ts:47` | `translation_ai` (3) | `POST /reading/analyze-text` → `ReadingController.analyzeText` | `TokensService` via `ReadingController` | Risk — no idempotency key is accepted at this handler, so every retry debits again. The rate limit (`@Throttle` 10/minute) reduces frequency but is not dedupe. The feature code also mislabels an NLP analysis as translation spend. |
| `apps/api/src/grammar/grammar.controller.ts:40` | `grammar_explain` (5) | `POST /grammar/explain` → `GrammarController.explain` | `TokensService` via `GrammarController` | No — key is SHA-256 hashed with the caller id and feature, so it is stable across retries, opaque, and user-scoped. |
| `apps/api/src/quiz/quiz.controller.ts:43` | `quiz_generate` (6) | `POST /quiz/generate-from-topic` → `QuizController.generateFromTopic` | `TokensService` via `QuizController` | Risk — the raw client `idempotency-key` header is passed through with no user or feature namespace. A key reused by another caller/feature is rejected by `TokensService` rather than silently skipping the debit, but the same user replaying the same key across features gets a `400` instead of a clean duplicate outcome; without a stable client key every retry debits again. |
| `apps/api/src/writing/writing.controller.ts:60` | `writing_feedback` (10) | `POST /writing/assess` → `WritingController.assess` | `TokensService` via `WritingController` | Yes (unkeyed retries) — `clientKey || randomUUID()` (`writing.controller.ts:59`) generates a fresh key whenever the client omits the header, and the web client posts no header (`apps/web/src/app/(dashboard)/writing/page.tsx:138-142`). Each retry debits again even when the cached submission makes the handler return a previously computed assessment. The post-charge transaction lookup (`writing.controller.ts:66-77`) only validates the fresh key; it cannot dedupe it. |
| `apps/api/src/writing/writing.controller.ts:177` | `speaking_feedback` (10) | `GET /writing/error-analysis` → `WritingController.analyzeErrors` | `TokensService` via `WritingController` | No within the 5-minute cache TTL — the stable per-user/parameter key (`writing.controller.ts:159-161`) is verified against a real transaction before a cached result is returned, and a process restart invalidates the in-memory cache. Risk after TTL expiry because a fresh debit is charged for the same analysis; feature code `speaking_feedback` is a mislabel chosen only because its price matches. |
| `apps/api/src/cards/cards.service.ts:253` | `cards_generate` (10) | `POST /decks/:deckId/cards/generate-from-text` → `CardsService.generateFromText` (via cards controller) | `TokensService` via `CardsService` | Risk — the service accepts an optional header/request-context key and namespaces it to `${userId}:cards_generate:${validKey}` (`cards.service.ts:183-192`), but the web caller sends no key. Without a key the debit is unkeyed; the `seed_key` batch check (`cards.service.ts:194-207`) only helps when a key exists. AI is called before the debit, so failed generations are free, but successful unkeyed retries can charge twice. |
| `apps/api/src/speaking/speaking.gateway.ts:234` | `speaking_feedback` (10) | WebSocket `audio_data` event → `SpeakingGateway` | `TokensService` via `SpeakingGateway` | Yes (repeat audio) — the key is `speaking-ws-${client._sid}-${Date.now()}` (`speaking.gateway.ts:233`), so every event, including a resend of identical audio, gets a new key and a new debit. There is no per-audio operation id or cache check. |
| `apps/api/src/speaking/speaking.service.ts:184` | `speaking_feedback` (10) | `POST /speaking/transcribe` → `SpeakingService.transcribeAudio` | `TokensService` via `SpeakingService` | Risk — the method receives `idempotencyKey` and forwards it, but no HTTP/WS handler in the inspected callers supplies one, so retries are unkeyed debits. The debit correctly happens only after a transcript is produced (`speaking.service.ts:183`). |

## API — public consume handlers

| Call site | Feature code | Server handler | Billing owner | Double-charge verdict |
|---|---|---|---|---|
| `apps/api/src/tokens/tokens.controller.ts:25` | caller-supplied (`dto.feature`) | `POST /tokens/consume` → `TokensController.consumeTokens` | `TokensService` via `TokensController` | Risk — the idempotency key comes straight from an optional header with no validation or namespacing. Missing key means every repeat debits. `dto.cost` is ignored by the service, so price is still server-authoritative. Kept public for legacy callers; BILL-02 calls for removing it once those callers migrate. |
| `apps/api/src/users/users.controller.ts:247` | caller-supplied (`dto.feature`) | `POST /users/me/tokens/consume` → `UsersController.consumeTokens` | `TokensService` via `UsersController` | No (when the header is present) — the handler requires a valid `^[0-9a-zA-Z._:-]{8,128}$` key and namespaces it as `${user.id}:${dto.feature}:${rawKey}` (`users.controller.ts:235-245`), so replays dedupe. Risk only if the 128-character `slice(0, 128)` truncates otherwise distinct long keys into a collision. This is the stricter legacy twin of the public `/tokens/consume` route. |

## Web — direct consume calls and gates

| Call site | Feature code | Server handler | Billing owner | Double-charge verdict |
|---|---|---|---|---|
| `apps/web/src/hooks/use-balance.ts:26` | none — body is `{ amount }` | `POST /tokens/consume` → `TokensController` | `TokensService` (only if the request ever succeeds) | N/A / broken — `ConsumeTokensDto` has no `amount` field, so the unknown feature check rejects the request. No valid debit occurs; no idempotency header is sent. |
| `apps/web/src/stores/token-store.ts:151,157` | `AIFeature` supplied by caller (`ai_chat`, `writing_feedback`, …) | `POST /tokens/consume` → `TokensController` | `TokensService` via public consume route | Risk — posts `{ feature, cost }` with no `Idempotency-Key` header, so every invocation debits. `cost` is ignored server-side. Tests at `apps/web/src/stores/token-store.spec.ts:62,65,87` assert this exact unkeyed payload rather than dedupe. |
| `apps/web/src/components/ui/token-cost.tsx:72,76` (`useTokenGate` / `consumeAndRun`) | feature passed in (`ai_chat`, `grammar_explain`, `writing_feedback`) | No HTTP consume call at all | None | N/A — despite the name, `consumeAndRun` only checks `canAfford(feature)`, runs the supplied action, and calls `loadBalance()` in `finally` (`token-cost.tsx:76-84`). It performs no debit and must not be treated as a security control. |
| `apps/web/src/app/(dashboard)/chat/page.tsx:197,342` | `ai_chat` | `POST /chat/send` via `persist()` and `POST /chat/stream` (free) | `TokensService` via `ChatController.send` | Risk — the gate does not debit; the only debit is a `/chat/send` call with no operation key, after a free stream already produced the answer. |
| `apps/web/src/app/(dashboard)/grammar/page.tsx:101,115` | `grammar_explain` | `POST /grammar/explain` → `GrammarController.explain` | `TokensService` via `GrammarController` | No — the gate does not debit; the server handler hashes a stable key. A retry without a client key still debits once per attempt, but no second debit comes from this page path. |
| `apps/web/src/app/(dashboard)/writing/page.tsx:59,137` | `writing_feedback` | `POST /writing/assess` → `WritingController.assess` | `TokensService` via `WritingController` | Yes — the gate does not debit and the request sends no idempotency header, so the server generates a fresh UUID per attempt; repeated submissions debit repeatedly even when a cached assessment is returned. |

## Web — Next.js proxy routes (server-side fetch to the public consume route)

| Call site | Feature code | Server handler | Billing owner | Double-charge verdict |
|---|---|---|---|---|
| `apps/web/src/app/api/speaking/topic/route.ts:36` | `speaking_feedback` (10) | Next.js route `POST /api/speaking/topic` → `POST /tokens/consume` | `TokensService` via `TokensController` | No — SHA-256 key derived from `user.id`, language, level, and category is sent as `Idempotency-Key` (`route.ts:32-43`). Groq is then called directly with no durable operation record, so a paid downstream failure is not refunded. |
| `apps/web/src/app/api/listening/generate/route.ts:36` | `listening_generate` (8) | Next.js route `POST /api/listening/generate` → `POST /tokens/consume` | `TokensService` via `TokensController` | No — stable SHA-256 key derived from user/topic/level/category (`route.ts:30-46`). The request body is validated before charging. Groq is called directly with no durable operation record. |
| `apps/web/src/app/api/listening/upload-user/route.ts:62` | `listening_generate` (8) | Next.js route `POST /api/listening/upload-user` → `POST /tokens/consume` | `TokensService` via `TokensController` | Risk — the `Idempotency-Key` header is forwarded only when the client supplies one (`route.ts:67-69`); the web caller does not reliably supply it, so retries can double-charge. |
| `apps/web/src/app/api/translation/generate/route.ts:18` | `translation_ai` (3) | Next.js route `POST /api/translation/generate` → `POST /tokens/consume` | `TokensService` via `TokensController` | Risk — no `Idempotency-Key` header is sent at all (`route.ts:18-27`), so every retry debits again. Groq is called directly with no durable operation record. |

## Regression tests that pin current behaviour

| Call site | What it asserts | Note |
|---|---|---|
| `apps/api/test/tokens.e2e-spec.ts:55,57` | public `POST /tokens/consume` decrements balance | Sends `cost: 10, feature: ai_chat`; the service ignores the cost and uses 5 from the catalog in the current implementation — verify the expected balance before relying on this test. |
| `apps/api/test/tokens.e2e-spec.ts:65,69,79` | same key replayed twice leaves balance unchanged | Confirms dedupe only when a key is sent to the public route. |
| `apps/api/src/tokens/tokens.service.spec.ts:144,155,169,180` | key hit returns cached result, success debits and invalidates cache, insufficient balance throws | Covers the authoritative `TokensService.consumeTokens` behaviour. |
| `apps/web/src/stores/token-store.spec.ts:62,65,87` | store posts `{ feature, cost }` with no idempotency header | Locks in the unkeyed client debit; update when BILL-03 introduces operation ids. |

## Consolidated risks and constraints for the next slice

1. Two public consume endpoints (`/tokens/consume`, `/users/me/tokens/consume`) plus a shared `TokensService`; retire the public one only after all web/proxy callers carry server-issued operation ids.
2. Client-side `useTokenGate` is a UX check, not a billing control. No client cost or balance check may authorize an AI operation.
3. `speaking_feedback` is reused for writing error analysis and speaking topic generation; `translation_ai` is reused for reading analyze-text. Ledger labels do not match the user-visible feature.
4. Optional or client-generated keys (`Date.now()` in the WS gateway, `randomUUID()` in writing assess, absent in translation/upload routes, raw in quiz) are the direct cause of the Yes/Risk verdicts.
5. `token_transactions.idempotency_key` is `VarChar(128)`; the users controller truncates with `.slice(0, 128)` (`users.controller.ts:245`), which can collide for long keys.
6. Chat has two paths for one AI turn: free `/chat/stream` and debited `/chat/send` persistence. BILL-03 should reserve once and persist once through a single operation id.
7. Proxy routes call Groq directly with no durable operation record, so a successful debit has no compensating action if the downstream call fails.
8. No API keys, tokens, or `.env` values were read or recorded during this inventory.
