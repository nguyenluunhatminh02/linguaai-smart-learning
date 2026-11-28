# Endpoint Inventory — chat/ and tokens/ (base-02b, part B)

**Scope:** `apps/api/src/chat/`, `apps/api/src/tokens/` (read-only in this step).
**Snapshot commit:** `384f82797419d919bf626e8526add1c1e3c111f9` (main, 2026-11-28).
**Roadmap reference:** `LinguaAI_Engineering_Roadmap.md` sections BASE-02, BILL-01..05, CHAT-01..02, TEST-06.
**Legend:**
- **confirmed** — behavior observed directly in source at the cited line.
- **unverified** — inferred from source but not exercised by a test in this slice; must be proven by TEST-06 / BILL-04 regression.

---

## 1. Global wiring (applies to every route below)

| Concern | Value | Evidence |
|---|---|---|
| Global prefix | `api` | `apps/api/src/main.ts:112` — confirmed |
| Versioning | URI, default `v1` → full paths are `/api/v1/...` | `main.ts:126` — confirmed |
| Auth on both controllers | `@UseGuards(JwtAuthGuard)` at class level | `chat.controller.ts:48`, `tokens.controller.ts:10` — confirmed |
| Role guard | None on chat/tokens; only `admin.controller.ts` uses `@Roles(Role.ADMIN)` | confirmed |
| Global throttle | `HttpOnlyThrottlerGuard` (HTTP only, skips WS), 100 req / 60 000 ms default | `app.module.ts:49-54, 86-91, 128-131` — confirmed |
| Validation pipe | `whitelist: true, transform: true, forbidNonWhitelisted: true` | `main.ts:150-156` — confirmed |
| CORS allow-list | `Idempotency-Key` explicitly in `allowedHeaders` | `main.ts:102-109` — confirmed |
| Request id + idempotency middleware | Inbound `idempotency-key` validated against `/^[A-Za-z0-9._:-]{8,64}$/`; stored on `requestContextStorage` for services that cannot take it as a parameter | `main.ts:132-149` — confirmed |
| Prisma schema | `token_transactions.idempotency_key` is `String? @unique @db.VarChar(128)`; `chat_conversations` cascade-deletes `chat_messages` | `schema.prisma:491-511, 625-638` — confirmed |

---

## 2. Route inventory — `apps/api/src/chat/`

| # | Route | Auth | Ownership | Quota / billing | Idempotency | Observed evidence |
|---|---|---|---|---|---|---|
| C1 | `POST /chat/send` | JwtAuthGuard | Enforced in `chat.service.ts:39-42` (`findFirst id + user_id`, 404 otherwise) | **Yes** — `consumeTokens(userId,'ai_chat',undefined,scopedKey)` runs BEFORE `sendMessage` | Header `idempotency-key` read at `chat.controller.ts:62`; scoped as `${userId}:${key}` at line 69; guards the **debit only** — LLM call and message writes still run on replay | `chat.controller.ts:57-72`, `chat.service.ts:26-75` — confirmed |
| C2 | `POST /chat/stream` | JwtAuthGuard | **None** — `conversationId` from DTO is ignored; client-supplied history is normalized and forwarded verbatim to Groq | **None** — no `consumeTokens` call on this path | **None** — no idempotency key read | `chat.controller.ts:74-122` — confirmed. **BUG-02 shape:** stream bypasses quota and ownership; frontend `chat/page.tsx:340-342` bills via a second `/chat/send` call after the stream completes (unverified: double charge if the persist call retries). |
| C3 | `GET /chat/conversations` | JwtAuthGuard | `user_id` filter in service | None | n/a | `chat.controller.ts:124-128`, `chat.service.ts:77-83` — confirmed. Fixed `take: 50`, no pagination (unverified: behavior with >50 conversations). |
| C4 | `GET /chat/conversations/:id/messages` | JwtAuthGuard | `ParseUUIDPipe` + ownership check in `chat.service.ts:86-89` | None | n/a | `chat.controller.ts:130-137` — confirmed |
| C5 | `DELETE /chat/conversations/:id` | JwtAuthGuard | `ParseUUIDPipe` + ownership check in `chat.service.ts:98-102`; cascade delete via schema | None | n/a | `chat.controller.ts:139-146`, `schema.prisma:508` — confirmed |

### Chat DTO notes (`apps/api/src/chat/dto/chat.dto.ts`)
- `ChatMessageDto.role` restricted to `user | assistant` via `@IsIn` (line 17) — confirmed; comment on line 14-15 flags that accepting `system` would allow prompt injection.
- `ChatMessageDto.content` `@MaxLength(8000)` (line 22); controller truncates again to 2000 via `normalizeUserInput` (`chat.controller.ts:38-44`) — confirmed.
- `SendChatDto.conversationId` is a plain `@IsString()` with **no `ParseUUIDPipe`** — unverified: non-UUID values reach `findFirst` and rely on Prisma to reject.
- `SendChatDto.language` is free-text at DTO level; controller applies `resolveLanguage()` allowlist (`chat.controller.ts:12-32, 66, 84`) — confirmed.

---

## 3. Route inventory — `apps/api/src/tokens/`

| # | Route | Auth | Ownership | Quota / billing | Idempotency | Observed evidence |
|---|---|---|---|---|---|---|
| T1 | `GET /tokens/balance` | JwtAuthGuard | Identity from `req.user.id` | Triggers `checkAndApplyDailyTopup` (auto-grant); Redis 5-min cache; `todayUsed` uses local `setHours(0,0,0,0)` while top-up uses UTC `toISOString().slice(0,10)` | n/a | `tokens.controller.ts:15-19`, `tokens.service.ts:38-96, 319-360` — confirmed. **BUG-05 shape:** timezone mismatch between grant boundary and usage boundary. |
| T2 | `POST /tokens/consume` | JwtAuthGuard | Identity from `req.user.id` | Delegates to `TokensService.consumeTokens`; server-side `COSTS` map ignores client-supplied `dto.cost` | Header `idempotency-key` read raw at `tokens.controller.ts:24` and passed **unscoped / unvalidated** to the service — **any user can replay any other user's key** (or collide with the deterministic `daily_topup:userId:YYYY-MM-DD` key) | `tokens.controller.ts:21-26`, `tokens.service.ts:103-178` — confirmed. **BUG-02 / legacy double-charge surface:** this public route exists alongside the per-feature internal calls; callers that hit both are billed twice. |
| T3 | `POST /tokens/purchase` | JwtAuthGuard | Identity from `req.user.id` | **Grants `dto.amount` with type `'purchase'` and no payment verification** | None | `tokens.controller.ts:28-32`, `tokens.service.ts:183-230` — confirmed. **BUG-01:** any authenticated user can mint tokens. |
| T4 | `GET /tokens/history` | JwtAuthGuard | Identity from `req.user.id` | None | n/a | `tokens.controller.ts:34-38`, `tokens.service.ts:365-370` — confirmed. No pagination (unverified: behavior with large history). |

### Tokens DTO notes (`apps/api/src/tokens/dto/tokens.dto.ts`)
- `ConsumeTokensDto.cost` is `@IsOptional @IsNumber @Min(1)` but **the server ignores it** (`tokens.service.ts:106-112`) — confirmed. Field exists only for legacy client compatibility.
- `PurchaseTokensDto.amount` is `@IsNumber @Min(1)` — confirmed; no upper bound, no signature, no provider verification.

### TokensService internals (`apps/api/src/tokens/tokens.service.ts`)
- `COSTS` map (lines 10-21): authoritative server-side pricing — confirmed.
- `consumeTokens`: idempotency check runs **outside** the `$transaction` (lines 117-133); does not catch Prisma `P2002` on the later `create` — unverified: race between two instances could surface a 500 instead of a clean replay.
- `addTokens` replay check (lines 190-197) returns the existing row **without verifying user / type / amount** — unverified: a colliding key for a different grant returns the wrong balance.
- Deterministic daily keys: `daily_checkin:userId:YYYY-MM-DD` and `daily_topup:userId:YYYY-MM-DD` — confirmed.
- `dailyCheckIn`: Redis fail-closed (throws `ForbiddenException`, line 253) — confirmed.
- `checkAndApplyDailyTopup`: Redis failure is logged and the DB idempotency key still enforces once-per-day — confirmed (`tokens.service.ts:326-330`).

---

## 4. Pricing catalog (server-authoritative)

Source: `TokensService.COSTS` at `apps/api/src/tokens/tokens.service.ts:10-21`, mirrored in `apps/web/src/stores/token-store.ts:7-17` (display only).

| Feature code | Cost (credits) | Call sites (billing owner) |
|---|---:|---|
| `ai_chat` | 5 | `chat.controller.ts:70` (pre-pay, scoped key) |
| `writing_feedback` | 10 | `writing.controller.ts:60` (pre-pay, hash-scoped key) |
| `reading_generate` | 8 | `reading.controller.ts:30` (pre-pay, user-scoped key) |
| `grammar_explain` | 5 | `grammar.controller.ts:40` (pre-pay, HMAC-scoped key) |
| `listening_generate` | 8 | `web/src/app/api/listening/generate/route.ts:36` (Next.js route, SHA-256 scoped key) |
| `quiz_generate` | 6 | `quiz.controller.ts:43` (pre-pay, raw client key — **unscoped**) |
| `translation_ai` | 3 | `reading.controller.ts:47` (pre-pay, **no idempotency key**) |
| `speaking_feedback` | 10 | `speaking.service.ts:184` (post-pay, after transcript); `speaking.gateway.ts:234` (WS, `speaking-ws-${sid}-${ts}` key) |
| `learning_path` | 5 | **no call site found in `apps/`** — catalog entry is dead code (unverified) |
| `cards_generate` | 10 | `cards.cards.service.ts:253` (post-pay, after AI success, user-scoped key) |
| `writing` error analysis (reuses `speaking_feedback` slot) | 10 | `writing.controller.ts:177` (comment at line 178-179 explains the reuse) |

---

## 5. External billing call sites (read-only inventory)

### 5.1 API-side callers of `TokensService.consumeTokens`

| Caller | Feature | Key shape | Pre/post pay |
|---|---|---|---|
| `chat.controller.ts:70` | `ai_chat` | `${userId}:${clientKey}` | pre |
| `quiz.controller.ts:43` | `quiz_generate` | raw client header (unscoped) | pre |
| `reading.controller.ts:30` | `reading_generate` | `${userId}:${clientKey}` | pre |
| `reading.controller.ts:47` | `translation_ai` | none | pre |
| `grammar.controller.ts:40` | `grammar_explain` | HMAC(`${JWT_SECRET}:${userId}:grammar_explain:${key}`) | pre |
| `writing.controller.ts:60` | `writing_feedback` | `buildAssessKey(userId, dto, clientKey \|\| randomUUID())` | pre |
| `writing.controller.ts:177` | `speaking_feedback` (reused slot) | same shape as above | pre |
| `speaking.service.ts:184` | `speaking_feedback` | caller-supplied | post |
| `speaking.gateway.ts:234` | `speaking_feedback` | `speaking-ws-${sid}-${ts}` | post |
| `cards.service.ts:253` | `cards_generate` | `${userId}:cards_generate:${validKey}` (capped 128) | post |
| `tokens.controller.ts:25` (legacy public) | client-chosen | raw header, unscoped, unvalidated | pre |
| `users.controller.ts:247` (`POST /users/me/tokens/consume`) | client-chosen, validated user + feature-scoped key (`${userId}:${feature}:${rawKey}`, 128 cap) | pre; maps 403 → 402 |

### 5.2 API-side callers of `TokensService.addTokens`

| Caller | Type | Feature | Notes |
|---|---|---|---|
| `tokens.controller.ts:31` (`POST /tokens/purchase`) | `purchase` | `''` | **BUG-01** — no payment verification |
| `admin.controller.ts:95` (`POST /admin/users/:id/tokens`) | `admin_grant` | `body.reason` | gated by `@Roles(Role.ADMIN)` |
| `tokens.service.ts:278` (inside `dailyCheckIn`) | `bonus` | `daily_checkin` | deterministic key `daily_checkin:userId:YYYY-MM-DD` |
| `tokens.service.ts:343` (inside `checkAndApplyDailyTopup`) | `daily_topup` | `daily_topup` | deterministic key `daily_topup:userId:YYYY-MM-DD` |

### 5.3 Web-side callers of `/tokens/*` HTTP endpoints

| Caller | Endpoint | Notes |
|---|---|---|
| `web/src/stores/token-store.ts:138` | `GET /tokens/balance` | via `apiClient` |
| `web/src/stores/token-store.ts:157` | `POST /tokens/consume` | body `{ feature, cost }` — hits the legacy public route |
| `web/src/stores/token-store.ts:194` | `POST /tokens/purchase` | body `{ amount }` — exercises BUG-01 |
| `web/src/stores/token-store.ts:211` | `GET /tokens/history` | no pagination |
| `web/src/hooks/use-balance.ts:14,26` | `/tokens/balance`, `/tokens/consume` | legacy hook, body `{ amount }` (does not match current DTO) |
| `web/src/app/(dashboard)/chat/page.tsx:162,180,231,267` | `/chat/conversations`, `/chat/conversations/:id/messages`, `/chat/send`, `/chat/stream` | `useTokenGate("ai_chat")` wraps the action but the actual debit happens on `/chat/send` after the stream |
| `web/src/app/api/speaking/topic/route.ts:36` | `/tokens/consume` | SHA-256 scoped key, Bearer `GROQ_API_KEY` to upstream |
| `web/src/app/api/listening/generate/route.ts:36` | `/tokens/consume` | SHA-256 scoped key |
| `web/src/app/api/listening/upload-user/route.ts:62` | `/tokens/consume` | forwards inbound idempotency key |
| `web/src/app/api/translation/generate/route.ts:18` | `/tokens/consume` | forwards inbound idempotency key |
| `web/src/app/(dashboard)/pricing/page.tsx:205` | `/tokens/purchase` | comment notes the endpoint grants free tokens |
| `web/src/app/(dashboard)/admin/users/page.tsx:266` | `/admin/users/:id/tokens/history` | admin UI |

---

## 6. Idempotency key handling — summary

| Layer | Behavior | Status |
|---|---|---|
| CORS preflight | `Idempotency-Key` in `allowedHeaders` | confirmed |
| Global middleware (`main.ts:132-149`) | Validates inbound key format (8–64 chars, `[A-Za-z0-9._:-]`) and stores it in `requestContextStorage` | confirmed |
| `chat.controller.ts:62-70` | Header scoped with `${userId}:` and applied to the **debit only**; the LLM call and message writes are not guarded | confirmed |
| `chat.controller.ts:74-122` (`/chat/stream`) | No key read, no debit, no persisted operation | confirmed |
| `tokens.controller.ts:24-25` (legacy `/tokens/consume`) | Raw, unscoped, unvalidated header — cross-user replay and collision with daily keys possible | confirmed |
| `users.controller.ts:235-252` (preferred consume) | Validated regex, scoped `${userId}:${feature}:${rawKey}`, 128-char cap; 403 → 402 | confirmed |
| `quiz.controller.ts:43`, `reading.controller.ts:47`, `speaking.gateway.ts:233` | Unscoped / unstable / absent keys remain on some internal paths | confirmed |
| `TokensService.consumeTokens` (`tokens.service.ts:117-133, 158-167`) | Key checked before `$transaction`; `P2002` from concurrent inserts is not handled; no operation state exists to replay | confirmed for code shape, unverified for runtime race behavior |
| `TokensService.addTokens` (`tokens.service.ts:190-197`) | Replay returns stored row without checking user/type/amount | confirmed |

---

## 7. Outstanding issues for later slices (roadmap mapping)

| Issue | Roadmap | Evidence | Next slice |
|---|---|---|---|
| Public `/tokens/purchase` mints tokens without payment | BUG-01 / BILL-01 (`LinguaAI_Engineering_Roadmap.md:69, 192-201`) | `tokens.controller.ts:28-32` | Disable route; internal grant API only |
| `/chat/stream` has no quota, ownership, or persistence; `/chat/send` bills post-hoc | CHAT-01/02 (`:333-380`) | `chat.controller.ts:74-122`, `chat/page.tsx:340-342` | Unified reserve → stream → finalize orchestration |
| Legacy `/tokens/consume` is unscoped and invites double-charge | BILL-02 (`:203-230`) | `tokens.controller.ts:21-26` | Remove after callers migrate; server-authoritative pricing retained |
| `todayUsed` local time vs grant UTC day | BILL-05 (`:322-331`) | `tokens.service.ts:78-79, 236, 320` | One day boundary policy + durable grant marker |
| Idempotency guards only the debit, not the AI turn | BILL-03/04 (`:232-320`) | `tokens.service.ts:117-167` | `ai_operations` with RESERVED/RUNNING/terminal states and unique keys |
| No pagination on `/tokens/history` or `/chat/conversations` | BILL-01, BASE-02 | `tokens.service.ts:365-370`, `chat.service.ts:77-83` | Add cursor/offset pagination |
| Client-supplied history used by `/chat/stream` | CHAT-01 (`:346-348`) | `chat.controller.ts:87-89` | Server-derived history from DB |

---

## 8. Verification status for this inventory

- **confirmed:** all lines in sections 1–7 were read from source; no tests were run in this step, no source files were edited.
- **unverified:** race behavior under two instances, actual double-charge incidence, effect of >50 conversations, non-UUID `conversationId` handling, and the `learning_path` dead catalog entry. These require TEST-06 / BILL-04 test execution, which is out of scope for this inventory step.
- No API keys, tokens or `.env` values were read or recorded; no secrets appear in this document.
