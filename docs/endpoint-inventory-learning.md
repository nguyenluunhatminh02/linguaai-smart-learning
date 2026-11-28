# Endpoint inventory — decks, cards, SRS, learning (part C)

Scope: endpoint/auth/quota inventory for `apps/api/src/decks/`, `apps/api/src/cards/`, `apps/api/src/srs/`, and `apps/api/src/learning/`. This is a read-only inventory: no source behaviour was changed. It covers the BASE-02 requirement to list endpoints with auth/role/quota, and feeds SEC-01/SEC-02 (authorization matrix, ownership), BILL-02 (billing call sites), and SEC-06 (distributed rate limiting).

Paths below are relative to the repository root. Line numbers were captured at the time of writing and should be treated as evidence anchors, not stable forever.

## Global policy (applies to every route in this document)

| Concern | Finding | Evidence |
|---|---|---|
| Route prefix | `app.setGlobalPrefix("api")` plus URI versioning with default version `1` → every route is served under `/api/v1/...`. | `apps/api/src/main.ts:112`, `apps/api/src/main.ts:125-126` |
| Authentication | All four controllers apply `@UseGuards(JwtAuthGuard)` and `@ApiBearerAuth()` at class level. No public/anonymous route and no role-specific guard (`@Roles`, admin guard) exists in the four directories. Auth is therefore `Bearer` JWT access token, any authenticated user. | `decks/decks.controller.ts:11-14`, `cards/cards.controller.ts:33-36`, `srs/srs.controller.ts:8-11`, `learning/learning.controller.ts:8-11` |
| Identity source | `JwtAuthGuard` extends Passport's `AuthGuard('jwt')` (`common/guards/jwt-auth.guard.ts:5`); `JwtStrategy.validate` requires `type === 'ACCESS'`, checks JTI blacklist, loads the user, and returns a `User` object with `id` from `payload.sub` (`auth/strategies/jwt.strategy.ts:34-55`, `:73-81`, `:127-164`; `common/mappers/user.mapper.ts:9`). Controllers read `@CurrentUser('id')`, which is `request.user['id']` (`common/decorators/current-user.decorator.ts:3-8`). Identity is server-derived from the token; no user id is trusted from a body/query except where it is only an ownership *filter*. | `common/guards/jwt-auth.guard.ts:5`, `auth/strategies/jwt.strategy.ts:135-164`, `common/decorators/current-user.decorator.ts:3-8` |
| Rate limit (default) | One global `HttpOnlyThrottlerGuard` (`ThrottlerGuard` subclass; skips non-HTTP contexts) is registered through `APP_GUARD`. Limits come from `ThrottlerModule.forRoot` using `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` environment names. No route in the four directories uses `@SkipThrottle()`. | `app.module.ts:45-54`, `app.module.ts:86-91`, `app.module.ts:127-132` |
| Rate limit storage | No shared/Redis storage is configured for `ThrottlerModule`; counters are per-process (in-memory). This is an open SEC-06 gap for multi-instance deployments. | `app.module.ts:86-91` |
| Credit quota | The only credit-consuming route in scope is `POST /decks/:deckId/cards/generate-from-text` (10 credits per call). Costs are server-authoritative in `TokensService.COSTS`; other routes do not call `consumeTokens`. | `tokens/tokens.service.ts:16-28`, `:110-119`, `cards/cards.service.ts:252-259` |
| Idempotency plumbing | Middleware accepts an `Idempotency-Key` header matching `/^[A-Za-z0-9._:-]{8,64}$/` and stores it in `requestContextStorage` (`main.ts:132-149`); `Idempotency-Key` is allowed by CORS (`main.ts:102-109`). The in-scope consumer is card generation. SRS uses client-supplied `operationId`/`sessionId` instead. | `main.ts:132-149`, `common/utils/request-context.ts:1-7` |
| Validation | Global `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })` (`main.ts:150-156`). Route ids use `ParseUUIDPipe`; list sizes are clamped in controllers. | `main.ts:150-156`, `decks/decks.controller.ts:37-39`, `srs/srs.controller.ts:24`, `srs/srs.controller.ts:69` |

Legend for the tables:

- **Auth**: `JWT` = class-level `JwtAuthGuard`, any authenticated user; no public or role-restricted route appears here.
- **Identity**: how the acting user id reaches the handler.
- **Ownership**: where authorization relative to the resource owner is enforced (`controller`, `service`, Prisma `where` filter, or `none`).
- **Rate limit**: `global` = global throttler only; `global + route` = global plus an additional `@Throttle`.
- **Credits**: `none` or the feature code charged via `TokensService.consumeTokens`.
- **Idempotency**: mechanism present (and its strength), or `none`.

## 1. Decks — `/api/v1/decks` (6 routes)

Controller: `apps/api/src/decks/decks.controller.ts`. Service: `apps/api/src/decks/decks.service.ts`.

| Method + path | Auth | Identity | Ownership | Rate limit | Credits | Idempotency | Evidence |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/decks` | JWT | `@CurrentUser('id')` | Controller passes JWT id to service; service sets `creator_id: userId` on create. Cannot create a deck for another user. | global | none | none | `decks/decks.controller.ts:18-22`; `decks/decks.service.ts:14-23` |
| `GET /api/v1/decks` (own + public; `page`, `limit`, `language`) | JWT | `@CurrentUser('id')` | Service filter `OR: [{ creator_id: userId }, { is_public: true }]`; authenticated caller sees own private decks plus all public decks. `page`/`limit` clamped in controller. | global | none | none | `decks/decks.controller.ts:24-40`; `decks/decks.service.ts:25-45` |
| `GET /api/v1/decks/my` | JWT | `@CurrentUser('id')` | Service filter `creator_id: userId`; own decks only. | global | none | none | `decks/decks.controller.ts:42-46`; `decks/decks.service.ts:53-65` |
| `GET /api/v1/decks/:id` | JWT | none (JWT id not read) | **Gap**: service `findById` looks up deck by id with no `is_public`/owner check; any authenticated user can read a private deck if they know its UUID. | global | none | none | `decks/decks.controller.ts:48-52`; `decks/decks.service.ts:47-51` |
| `PATCH /api/v1/decks/:id` | JWT | `@CurrentUser('id')` | Service loads deck then compares `deck.creator_id !== userId` → `ForbiddenException`. Owner only. | global | none | none | `decks/decks.controller.ts:54-62`; `decks/decks.service.ts:67-78` |
| `DELETE /api/v1/decks/:id` | JWT | `@CurrentUser('id')` | Service checks creator match, then refuses deletion if other learners have progress/reviews/sessions: public decks are soft-deleted (unlisted via `is_public: false`), private decks produce `ConflictException`. | global | none | none | `decks/decks.controller.ts:64-68`; `decks/decks.service.ts:80-123` |

## 2. Cards — `/api/v1/decks/:deckId/cards` (7 routes)

Controller: `apps/api/src/cards/cards.controller.ts`. Service: `apps/api/src/cards/cards.service.ts`. Deck ownership for mutations is centralized in `CardsController.requireDeckOwner` (`cards/cards.controller.ts:43-49`): `DecksService.findById(deckId)` then `deck.creator_id !== userId` → `ForbiddenException`.

| Method + path | Auth | Identity | Ownership | Rate limit | Credits | Idempotency | Evidence |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/decks/:deckId/cards` | JWT | `@CurrentUser('id')` | Controller `requireDeckOwner` (deck owner only); service also resolves deck via `findById`. | global | none | none | `cards/cards.controller.ts:51-60`; `cards/cards.service.ts:26-47` |
| `POST /api/v1/decks/:deckId/cards/bulk` | JWT | `@CurrentUser('id')` | Controller `requireDeckOwner`; body is a validated wrapper capped at 200 cards (`BulkCreateCardsDto`). | **global + route**: `@Throttle({ default: { ttl: 60_000, limit: 10 } })` | none | none | `cards/cards.controller.ts:21-31`, `:62-72` |
| `POST /api/v1/decks/:deckId/cards/generate-from-text` | JWT | `@CurrentUser('id')` | Controller `requireDeckOwner`; service resolves deck again. | global | **10 credits** (`cards_generate`) | Client `Idempotency-Key` via request context → token key `${userId}:cards_generate:${key}` (8-64 char allowlist); card `seed_key` replay returns the prior batch without recharging. See gap G4. | `cards/cards.controller.ts:74-88`; `cards/cards.service.ts:171-207`, `:211-259`; `tokens/tokens.service.ts:27`, `:110-140` |
| `GET /api/v1/decks/:deckId/cards` | JWT | `@CurrentUser('id')` (optional param) | **Gap**: service queries cards by `deck_id` only; it does not check deck visibility or owner. The JWT id is used only to attach the caller's `user_card_progress`, not to filter the cards. | global | none | none | `cards/cards.controller.ts:90-97`; `cards/cards.service.ts:49-91` |
| `GET /api/v1/decks/:deckId/cards/:id` | JWT | none (JWT id not read) | **Gap**: `findById` fetches a card by id without checking deck visibility/ownership; any authenticated user can read a card from a private deck if they know its UUID. | global | none | none | `cards/cards.controller.ts:99-103`; `cards/cards.service.ts:93-97` |
| `PATCH /api/v1/decks/:deckId/cards/:id` | JWT | `@CurrentUser('id')` | Controller checks ownership of `deckId` only; service updates by `id` alone. **Gap**: no check that the card actually belongs to `deckId`, so an owner can update another deck's card by pairing their own deck id with that card's id. | global | none | none | `cards/cards.controller.ts:105-115`; `cards/cards.service.ts:99-112` |
| `DELETE /api/v1/decks/:deckId/cards/:id` | JWT | `@CurrentUser('id')` | Same pattern as PATCH: `deckId` ownership checked in controller, but card-to-deck membership is not verified. Cards with study history are soft-retired instead of deleted; `card_count` is decremented once. | global | none | none | `cards/cards.controller.ts:117-126`; `cards/cards.service.ts:114-142` |

## 3. Spaced repetition — `/api/v1/srs` (7 routes)

Controller and service: `apps/api/src/srs/srs.controller.ts`, `apps/api/src/srs/srs.service.ts`. All per-user reads filter `user_id: userId`; deck visibility for study data is `OR: [{ creator_id: userId }, { is_public: true }]` via `assertDeckAccess` (`srs/srs.service.ts:11-19`) and inline Prisma filters (`:30`, `:52`, `:93`, `:226`, `:234`, `:302`). No credits are charged on SRS routes.

| Method + path | Auth | Identity | Ownership | Rate limit | Credits | Idempotency | Evidence |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/srs/due-cards?deckId=&limit=` | JWT | `@CurrentUser('id')` | `assertDeckAccess(userId, deckId)` (owner or public deck); queries filter `user_id` and deck visibility; `limit` clamped 1-100. | global | none | none | `srs/srs.controller.ts:15-25`; `srs/srs.service.ts:21-71` |
| `POST /api/v1/srs/review` | JWT | `@CurrentUser('id')` | Card must be visible (owner/public deck, not retired). Progress and review events are keyed by `user_id`. Advisory transaction lock `srs:${userId}:${cardId}` serializes concurrent reviews. | global | none | Optional client `operationId` (UUID) persisted on `srs_review_events`; replay validates user/card/grade, otherwise `409 Conflict`. No `Idempotency-Key` header support. | `srs/srs.controller.ts:27-31`; `srs/srs.service.ts:73-112`, `:114-177`; `srs/dto/srs.dto.ts:4-24` |
| `POST /api/v1/srs/session/start` | JWT | `@CurrentUser('id')` | `assertDeckAccess` for new sessions; `confirmSession` rejects a replayed `sessionId` belonging to another user/deck with `409 Conflict`. | global | none | Optional client `sessionId` (UUID) with DB unique-constraint replay handling. | `srs/srs.controller.ts:33-37`; `srs/srs.service.ts:179-202`; `srs/dto/srs.dto.ts:26-35` |
| `POST /api/v1/srs/session/finish` | JWT | `@CurrentUser('id')` | `updateMany` and lookup are scoped by `id` **and** `user_id`; caller cannot finish another user's session. | global | none | In effect: finishing an already-finished session has no effect (`finished_at: null` predicate) but returns the stored session. | `srs/srs.controller.ts:39-43`; `srs/srs.service.ts:204-218` |
| `GET /api/v1/srs/stats` | JWT | `@CurrentUser('id')` | Progress filtered by `user_id`; card/deck visibility filter applied. | global | none | none | `srs/srs.controller.ts:45-49`; `srs/srs.service.ts:220-270` |
| `GET /api/v1/srs/retention-dashboard` | JWT | `@CurrentUser('id')` | Progress filtered by `user_id`; card/deck visibility filter applied. | global | none | none | `srs/srs.controller.ts:51-60`; `srs/srs.service.ts:296-395` |
| `GET /api/v1/srs/forecast?days=` | JWT | `@CurrentUser('id')` | Progress filtered by `user_id`; `days` clamped 1-365. Note: this query does not re-check deck visibility (unlike the other SRS reads) — it counts only the caller's progress rows. | global | none | none | `srs/srs.controller.ts:62-70`; `srs/srs.service.ts:272-294` |

## 4. Learning — `/api/v1/learning` (6 routes)

Controller and service: `apps/api/src/learning/learning.controller.ts`, `apps/api/src/learning/learning.service.ts`. Scenario content is static in `apps/api/src/learning/communication-scenarios.ts`, so scenario reads need no resource-level ownership check. Completion and phrase writes are keyed to the JWT user. No credits are charged on learning routes.

| Method + path | Auth | Identity | Ownership | Rate limit | Credits | Idempotency | Evidence |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/learning/scenarios` | JWT | none (static catalogue) | No user-owned resource; returns a projected list of static scenarios. | global | none | none | `learning/learning.controller.ts:15-18`; `learning/learning.service.ts:12-16` |
| `GET /api/v1/learning/scenarios/:slug` | JWT | none (static catalogue) | No user-owned resource. **Gap**: unlike other controllers, `slug` is a raw `@Param` without `ParseUUIDPipe`/validation; lookup is a static-array match. | global | none | none | `learning/learning.controller.ts:20-23`; `learning/learning.service.ts:18-25`, `:97-101` |
| `POST /api/v1/learning/scenarios/:slug/complete` | JWT | `@CurrentUser('id')` | Completion row keyed by `(user_id, activity_type, activity_id)` → `learning_completions.upsert`; caller only writes their own record. Answer shape validated (`CompleteScenarioDto`). | global | none | Natural dedupe via DB compound-key upsert; repeated completion overwrites/updates the same row. | `learning/learning.controller.ts:25-32`; `learning/learning.service.ts:35-52`, `:103-114`; `learning/learning.dto.ts:3-10` |
| `POST /api/v1/learning/scenarios/:slug/save-phrase` | JWT | `@CurrentUser('id')` | Transaction locks the caller's user row, upserts a private deck under `creator_id = userId` + `learning_collection = 'communication'`, then dedupes cards by `learning_phrase_key`. No other user can reach that deck via this route. | global | none | DB unique keys + row lock; repeated save returns `{ alreadySaved: true }`. | `learning/learning.controller.ts:34-37`; `learning/learning.service.ts:58-95` |
| `GET /api/v1/learning/progress` | JWT | `@CurrentUser('id')` | Query filtered by `user_id: userId`. | global | none | none | `learning/learning.controller.ts:39-42`; `learning/learning.service.ts:27-33` |
| `POST /api/v1/learning/progress` | JWT | `@CurrentUser('id')` | `saveCompletion` upsert keyed by `(user_id, activity_type, activity_id)`; `activityType` restricted to `reading|listening`, `activityId`/`language` validated. | global | none | Natural dedupe via compound-key upsert. | `learning/learning.controller.ts:44-47`; `learning/learning.service.ts:54-56`, `:103-114`; `learning/learning.dto.ts:12-27` |

## Cross-cutting primitives and neighbouring interfaces (reference only)

These are read-only references for the slices that will fix the gaps; nothing here is edited by this inventory.

- `TokensService.consumeTokens(userId, feature, _cost?, idempotencyKey?)` and server-side `COSTS` catalog: `apps/api/src/tokens/tokens.service.ts:16-28`, `:110-185`. `TokensModule` is `@Global()` and exports the service (`apps/api/src/tokens/tokens.module.ts:6-12`), which is why `CardsService` can inject it without importing the module in `CardsModule` (`apps/api/src/cards/cards.module.ts:7-12`).
- `AiClientService.post` call for generation: `apps/api/src/cards/cards.service.ts:211-223`; provided by `CardsModule` (`apps/api/src/cards/cards.module.ts:4-11`).
- `DecksService.findById` shared with cards: `apps/api/src/decks/decks.service.ts:47-51`; exported by `DecksModule` (`apps/api/src/decks/decks.module.ts:5-9`).
- Idempotency-key propagation: `apps/api/src/main.ts:132-149` → `apps/api/src/common/utils/request-context.ts:1-7` → `apps/api/src/cards/cards.service.ts:183-192`.
- Prisma models backing these routes: `decks`, `cards`, `user_card_progress`, `srs_review_events`, `review_sessions`, `learning_completions` in `apps/api/prisma/schema.prisma`.

## Gaps and unverified items (carry into SEC-01/02, BILL-02, SEC-06)

| ID | Gap | Impact / suggested owner | Evidence |
|---|---|---|---|
| G1 | `GET /decks/:id`, `GET /decks/:deckId/cards`, and `GET /decks/:deckId/cards/:id` do not enforce `is_public`/owner visibility. | Any authenticated user can enumerate another user's private deck/card content if they have the UUID (SEC-02). Add visibility checks in `DecksService.findById`/`CardsService.findByDeck`/`findById` or in the controllers. | `decks/decks.service.ts:47-51`; `cards/cards.controller.ts:90-103`; `cards/cards.service.ts:49-97` |
| G2 | Card `PATCH`/`DELETE` check ownership of `deckId` but not that the card belongs to that deck. | Deck owner can modify/retire a card from another deck by supplying their own deck id in the path (SEC-02). Add a `card.deck_id === deckId` check in the controller or scope the service update/delete by both ids. | `cards/cards.controller.ts:105-126`; `cards/cards.service.ts:99-142` |
| G3 | `ThrottlerModule` has no shared store; limits are per-process and keyed without an explicit user/feature dimension. | Multi-instance deployments multiply the effective limit; no per-user/per-feature quotas (SEC-06). | `app.module.ts:86-91`, `:127-132`; roadmap `SEC-06` at `LinguaAI_Engineering_Roadmap.md:433` |
| G4 | `generate-from-text` calls the AI before reserving credits, and does not refund when persistence fails (the debit key stays active so a retry can yield cards with no new charge). | Conflicts with BILL-02's "reserve credit before AI call"; a successful debit can be followed by a failed save. Consider the durable operation pattern in BILL-03. | `cards/cards.service.ts:209-281`; `LinguaAI_Engineering_Roadmap.md:222` |
| G5 | SRS review/session idempotency depends on optional client `operationId`/`sessionId`; without them retries are not deduplicated. No `Idempotency-Key` header support on SRS or learning writes. | Duplicate reviews/sessions possible on client retry; align with the shared idempotency convention. | `srs/dto/srs.dto.ts:20-35`; `srs/srs.service.ts:87-103`, `:179-193` |
| G6 | No per-route quota/credit gate on learning completion writes or on plain deck/card CRUD; abuse is limited only by the global throttler. | Bulk completion spam or deck/card creation floods are possible; evaluate feature-level quotas. | `learning/learning.controller.ts:25-47`; `decks/decks.controller.ts:18-22`; `cards/cards.controller.ts:51-72` |
| G7 | `GET /learning/scenarios/:slug` accepts an unvalidated `slug` (no pipe/DTO), unlike UUID paths elsewhere. | Currently backed by a static array, so impact is limited to error shape, but add explicit validation consistent with the rest of the API. | `learning/learning.controller.ts:20-23`; `learning/learning.service.ts:97-101` |

No source files were modified and no tests were added by this inventory. No secrets, API keys, token values, or `.env` contents are recorded here; only environment variable *names* for the rate limiter are referenced.

This document is an output of slice `base-02c` and is intended to be merged with the inventories produced by the neighbouring slices before the SEC-01 authorization matrix and BILL-02 billing call-site table are finalized.
