# Sequence diagrams

Scope: these diagrams are a static source review of this checkout. They describe
the implemented control flow, not measured runtime behaviour. Line-level source
citations point at the files that were read; no secrets, `.env` values or real
IDs are reproduced. The async generation section separates **current code** from
the **proposed** end-state so a proposed flow is never mistaken for a shipped
feature.

## 1. Chat streaming (as implemented)

Sources: `apps/web/src/app/(dashboard)/chat/page.tsx`,
`apps/web/src/lib/sse-parser.ts`, `apps/api/src/chat/chat.controller.ts`,
`apps/api/src/chat/chat.service.ts`, `apps/api/src/common/services/groq.service.ts`,
`apps/api/src/ai-operations/ai-operations.service.ts`,
`apps/api/src/ai-operations/ai-operations.policy.ts`,
`apps/api/src/ai-operations/ai-operations.repository.ts`,
`apps/api/src/tokens/tokens.service.ts`.

The browser posts to the **NestJS** `/chat/stream` endpoint with a client
`Idempotency-Key` and consumes the SSE reply through `parseSseStream`.
`GroqService` is a compatibility adapter: despite its name, `chatStream()` POSTs
to FastAPI `/v1/ai/chat/stream` through `AiClientService` (or the adapter's own
axios client). FastAPI's `/ai/chat/stream` is a separate gateway-guarded route;
it is **not** drawn inside the NestJS chat path below.

```mermaid
sequenceDiagram
    autonumber
    participant W as Web chat + sse-parser
    participant C as NestJS ChatController
    participant O as AiOperationsService/Repository + Policy
    participant T as TokensService
    participant DB as PostgreSQL (Prisma)
    participant S as ChatService
    participant G as GroqService adapter / FastAPI stream

    W->>C: POST /chat/stream (Idempotency-Key, message, language, conversationId?)
    C->>C: parse key (<=128, UUID-like or opaque), validate language + message
    C->>DB: findFirst chat_conversations by id + user_id (ownership)
    C->>O: findOrCreate(user, feature=ai_chat, key, canonical payload)
    O->>O: compute SHA-256 request hash (sorted canonical JSON)
    O->>DB: findFirst by (user, feature, client key); insert RESERVED on miss
    Note over O,DB: Same key + different hash => 409; P2002 insert => read-back replay

    alt Fresh RESERVED row
        C->>T: reserveTokens(operationId, ai_chat, server cost 5)
        T->>DB: Serializable tx: daily top-up marker, balance decrement, debit ledger
    else Replayed SUCCEEDED row
        Note over C: No second debit and no second provider call
    else Live lease / key conflict / terminal failure
        C-->>W: HTTP 409/400/401/403/404/429 (no SSE headers opened)
    end
    C->>O: claimLease(version) when not terminal (RUNNING + lease token)
    O->>DB: updateMany fenced by version; version++, attempt_count++

    C->>W: flush SSE headers (text/event-stream, no buffering)
    C-->>W: event accepted {operationId, conversationId}

    alt SUCCEEDED replay
        C->>DB: find chat_messages by result_ref + conversation owner
        C-->>W: event delta {seq, text} (saved answer, truncated to 16 KiB)
        C->>T: getBalance (best effort)
        C-->>W: event completed {operationId, messageId, balance}
    else Fresh run
        C->>S: sendStream(userId, dto, {signal, onDelta, onCompleted})
        S->>DB: resolve/create owned conversation; read <=50 ordered messages
        S->>G: chatStream(messages, allowlisted system prompt, {signal})
        loop Bounded streaming (120s deadline, 15s heartbeat, 1MiB write cap)
            G-->>S: delta text
            S-->>C: onDelta (16 KiB delta cap, 16 KiB total output cap)
            C-->>W: event delta {seq, text}
        end
        G-->>S: clean EOF with content (empty output => AI_UNAVAILABLE)
        S->>DB: transaction: insert user chat_messages + assistant chat_messages
        S-->>C: onCompleted {messageId} (only after commit)
        C->>O: markTerminal(SUCCEEDED, version, leaseToken, resultRef=messageId)
        O->>DB: updateMany fenced by exact version + lease token
        C->>T: settleTokens(operationId, ai_chat, cost 5) -> zero-amount settle ledger
        C->>T: getBalance (best effort)
        C-->>W: event completed {operationId, messageId, balance}
    end

    alt Failure after headers opened (allowlisted code only)
        C->>O: markTerminal(FAILED or UNKNOWN for PROVIDER_TIMEOUT, errorCode)
        O->>T: maybeRefund: known codes => addTokens with key refund:aiop:<id>
        T->>DB: ledger unique key makes refund at most once
        C-->>W: event failed {operationId, code, safe message}
    else Client close / backpressure / deadline
        C->>G: abort signal (provider stream closed; no user/assistant rows persisted)
    end

    Note over W: eof or [DONE] is incomplete, never success; only completed is accepted
    W->>C: GET /chat/operations/:operationId (after a lost connection)
    C->>DB: read ai_operations + chat_messages by committed result_ref only
    C-->>W: {status, result} (read-only; no provider call or charge)
```

Operational notes grounded in code:

- Every failure code exposed over SSE comes from a fixed allowlist in
  `chat.controller.ts`; provider text is logged server-side only.
- Refund policy (`ai-operations.policy.ts`): `PROVIDER_TIMEOUT` and
  `OPERATION_UNKNOWN` require reconciliation (UNKNOWN, no automatic refund);
  other known errors are refunded once via `refund:aiop:<operationId>`.
- `tokens.service.ts` uses `op:<user>:<operationId>:debit|settle` and
  `refund:aiop:<operationId>` ledger keys, so the ledger unique constraint is
  the at-most-once guard.

## 2. SRS review (as implemented)

Sources: `apps/web/src/app/(dashboard)/flashcards/[deckId]/study/page.tsx`,
`apps/api/src/srs/srs.controller.ts`, `apps/api/src/srs/srs.service.ts`,
`apps/api/src/srs/fsrs.algorithm.ts`.

There is **no AI call and no token debit** in this path. Idempotency is the
`srs_review_events` row plus a per-card PostgreSQL advisory transaction lock,
not an `ai_operations` row.

```mermaid
sequenceDiagram
    autonumber
    participant W as Flashcards study page
    participant C as NestJS SrsController
    participant S as SrsService
    participant DB as PostgreSQL (Prisma)
    participant F as FsrsAlgorithm (FSRS-4.5)

    W->>C: GET /srs/due-cards?deckId&limit (1..100, default 20)
    C->>S: getDueCards(userId, deckId, limit)
    S->>DB: assertDeckAccess (creator or public deck)
    S->>DB: user_card_progress where next_review_date <= now (retired_at null)
    S->>DB: fill remainder with unseen cards in the visible deck
    S-->>W: {dueCards[{card, progress}], newCards, totals}

    W->>C: POST /srs/session/start {deckId, sessionId?}
    C->>S: startSession(userId, dto)
    S->>DB: findUnique review_sessions by id (if supplied)
    alt Existing session
        S->>S: confirm userId + deckId match (else 409)
        S->>DB: re-check deck access
    else New session
        S->>DB: assertDeckAccess; insert review_sessions
        Note over DB: P2002 => read back existing row and confirm ownership
    end
    S-->>W: session {id, startedAt}

    loop For each graded card
        W->>C: POST /srs/review {cardId, grade 1..4, operationId}
        C->>S: reviewCard(userId, dto)
        S->>DB: BEGIN transaction; pg_advisory_xact_lock('srs:<userId>:<cardId>')
        alt operationId already in srs_review_events
            S->>DB: findUnique event by id
            S->>S: replay checks: same user/card/grade + current card access
            S-->>W: saved result (no new scheduling write)
        else Fresh review
            S->>DB: cards.findFirst (visible, not retired)
            S->>DB: user_card_progress.findUnique (prior state)
            S->>F: calculate(grade, ease, difficulty, repetitions, daysSinceLast)
            F-->>S: {stability, difficulty, interval, repetitions, retrievability}
            S->>F: getNextReviewDate(interval)
            S->>DB: upsert user_card_progress (stability, difficulty, interval,<br/>repetitions, next/last_review_date, quality_history)
            S->>DB: insert srs_review_events {id, user, card, grade, saved result}
            S-->>W: scheduling response (nextReviewDate ISO string)
        end
        Note over S,DB: COMMIT; P2002 on event insert => read-back replay outside tx
    end

    W->>C: POST /srs/session/finish {sessionId, cardsReviewed, cardsCorrect, durationSeconds}
    C->>S: finishSession(userId, dto)
    S->>S: reject cardsCorrect > cardsReviewed
    S->>DB: updateMany review_sessions where owner + finished_at null; re-read row
    S-->>W: finished session
    W->>W: invalidateQueries(next-learning-activity, dashboard-stats, decks, retention-dashboard)
```

## 3. Async lesson generation

### 3a. Current code (as implemented in this checkout)

Sources: `apps/web/src/app/api/listening/generate/route.ts`,
`apps/web/src/app/api/translation/generate/route.ts`,
`apps/web/src/app/api/cms/lessons/generate-from-transcript/route.ts`,
`apps/api/src/admin/lessons.controller.ts`,
`apps/api/src/content-workflow/content-workflow.controller.ts`,
`apps/api/src/queue/queue.module.ts`, `apps/api/src/queue/outbox.repository.ts`,
`apps/api/src/queue/queue.service.ts`, `apps/api/src/queue/queue.processor.ts`,
`apps/api/src/app.module.ts`.

Important accuracy notes before the diagram:

- The three Next.js generation routes in this checkout are **BFF proxies**, not
  direct Groq fetches. They call `verifyAuthHeader` (and `isAdmin` for CMS),
  validate input, then POST to the NestJS backend with a fresh UUID key. The
  legacy `{ data }` / `{ error }` envelope is preserved for the pages.
- The backend endpoints those proxies call (`/listening/generate`,
  `/translation/generate`, `/content-workflow/generate-from-transcript`,
  `/content-workflow/operations/:id`) are **not present** in this checkout's
  NestJS controllers; the CMS route in particular returns a generation-service
  error today. The diagram shows the client-side flow and marks the missing
  server step explicitly.
- Queue/outbox/processor source files exist (`apps/api/src/queue/`), but
  `QueueModule` is **not registered** in `apps/api/src/app.module.ts`, no
  generation controller calls `QueueService`/`OutboxRepository`, and no worker
  is started. These are scaffolding for REL-03, not an enabled path.
- FastAPI `/ai/content/generate-cards` and `/ai/content/generate-quiz-questions`
  exist in `apps/ai-service`, but are not wired into these three Next.js routes.

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser (lesson/CMS page)
    participant N as Next.js generation BFF route
    participant A as NestJS backend (endpoint not in this checkout)
    participant DB as PostgreSQL
    participant Q as Queue/outbox (present as unregistered code)
    participant F as FastAPI AI service (not on these routes)

    U->>N: POST listening/translation/CMS generation request (+ JWT)
    N->>N: verifyAuthHeader; CMS also isAdmin; validate payload + key length
    alt Validation or auth fails
        N-->>U: 400/401 immediately (backend not contacted)
    end
    N->>A: POST backend generation (Authorization forwarded, Idempotency-Key=UUID)
    Note over A: In this checkout these endpoints are absent from NestJS controllers;<br/>no token consume call exists in the BFF routes themselves
    A-->>N: 200 {data: ...} or mapped 400/401/402/409/429/502
    N-->>U: legacy {data} or {error} response

    rect rgb(255, 244, 214)
    Note over N,DB: CMS-only loop, written in route.ts but unreachable without the missing backend endpoints
    N->>A: POST /content-workflow/generate-from-transcript -> {operationId, status}
    loop until terminal (max 20 polls, 1s apart)
        N->>A: GET /content-workflow/operations/:operationId
        A-->>N: {status, draft?, errorCode?}
    end
    N-->>U: {data, operationId} on SUCCEEDED; 202 OPERATION_UNKNOWN if still processing
    end

    rect rgb(255, 235, 235)
    Note over Q,F: NOT CONNECTED: scaffolding only — QueueModule is not imported by AppModule,<br/>no endpoint enqueues, no BullMQ worker is started, so this does not run today
    Q->>DB: (would) reserve + operation + outbox atomically
    Q->>Q: (would) claim outbox, enqueue jobId=operationId
    Q->>F: (would) call bounded generation with deadline
    F-->>Q: (would) validated output
    Q->>DB: (would) persist + settle atomically
    end
```

### 3b. Target architecture (PROPOSED / NOT IMPLEMENTED — roadmap REL-03)

Source: `LinguaAI_Engineering_Roadmap.md` REL-03 and supporting code scaffolding in
`apps/api/src/queue/`. The existing queue scaffolding supplies IDs-only payloads,
`jobId = operationId`, fenced outbox claims and an in-process processor with a
55s provider deadline and bounded concurrency; a production BullMQ worker is not
wired. Nothing in this subsection should be read as currently shipped.

```mermaid
sequenceDiagram
    autonumber
    participant U as Web
    participant A as NestJS generation endpoint (PROPOSED)
    participant D as PostgreSQL (PROPOSED orchestration)
    participant P as Outbox publisher (PROPOSED)
    participant Q as Queue + worker (scaffold exists, not wired)
    participant F as FastAPI AI service
    U->>A: POST generation + operation key
    A->>D: reserve tokens + create operation + outbox row (one transaction)
    A-->>U: 202 Accepted + operationId
    P->>D: claim pending outbox (FOR UPDATE SKIP LOCKED, lease token)
    P->>Q: enqueue jobId=operationId (IDs only)
    P->>D: mark outbox PUBLISHED (fenced by lease token)
    Q->>F: generate with deadline (bounded attempts)
    F-->>Q: validated output
    Q->>D: persist result + settle tokens atomically
    Q->>D: mark operation SUCCEEDED (fenced by version/lease)
    U->>A: GET operation status by operationId
    A-->>U: terminal result (or recoverable UNKNOWN)

    Note over Q,D: Failure policy: known error -> FAILED + at-most-one refund via<br/>refund:aiop:<operationId>; timeout -> UNKNOWN requiring reconciliation;<br/>expired lease -> another worker may claim; exhausted attempts -> poison/dead-letter.<br/>The queue processor currently has no token settle/refund step.
```

What remains before 3b is real: register the queue/outbox modules in `AppModule`,
add the generation endpoint that performs the atomic reserve+operation+outbox
write, connect the publisher to a started worker (the in-process processor is a
test-sized stand-in), and add the settle/refund bookkeeping to the worker's
failure path. Until then, the roadmap target stays a proposal.
