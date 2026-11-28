# WebSocket Architecture: Raw `ws` Adapter and Cross-Instance Pub/Sub

**Scope:** This document describes the current WebSocket transport used by the Speaking feature (`/speaking-ws`), why the Socket.IO Redis adapter does not apply, and two design options for cross-instance message delivery in a multi-instance deployment.

**Status:** Documentation-only slice. No application source changes are made here.

---

## 1. Current Design (Single Instance)

### 1.1 Transport Stack

The API server (`apps/api`) uses NestJS with the raw `ws` library, not Socket.IO:

| Layer | Module / Path | Detail |
|---|---|---|
| **Bootstrap** | `apps/api/src/main.ts:566` | `app.useWebSocketAdapter(new WsAdapter(app))` — installs the NestJS `@nestjs/platform-ws` adapter. |
| **Gateway** | `apps/api/src/speaking/speaking.gateway.ts` | `@WebSocketGateway({ path: '/speaking-ws', maxPayload: 8MB, cors: false })` — raw `ws` gateway on the `/speaking-ws` path. |
| **Module** | `apps/api/src/app.module.ts:129` | `SpeakingModule` is imported into the root module; the gateway is discovered automatically. |
| **Client URL** | `apps/web/src/features/speaking/utils.ts:216` | `wss://<api-host>/speaking-ws?token=<jwt>` — token is passed in the query string because browsers cannot set custom headers on `new WebSocket()`. |

### 1.2 Protocol Frames

All frames are JSON strings sent over a single persistent connection. The client schema is defined in `apps/web/src/features/speaking/schemas/speaking.ts`:

| Event | Direction | Payload Shape |
|---|---|---|
| `connected` | Server → Client | `{ sid: string }` — session ID assigned after JWT verification. |
| `session_ready` | Server → Client | `{}` — emitted after `start_session` is accepted. |
| `status` | Server → Client | `{ phase?: "transcribing" \| "analyzing", message?: string }` — progress indicator. |
| `transcript` | Server → Client | `{ text: string }` — STT result from Groq Whisper. |
| `feedback_chunk` | Server → Client | `{ chunk: string }` — streaming LLM token. |
| `feedback_done` | Server → Client | `{ transcript, feedback, scores, feedbackBasis, scoresAvailable }` — terminal result. |
| `error` | Server → Client | `{ message: string }` — fatal or transient error. |
| `start_session` | Client → Server | `{ topic, level, language }` — initiates a speaking session. |
| `audio_data` | Client → Server | `{ audio: string (base64), mimeType: string }` — audio chunk for STT + LLM analysis. |

**Validation rules:**
- JWT is verified on connect (`handleConnection`) and re-verified on every paid request (`verifyConnection`).
- Audio payload is bounded to `MAX_UPLOAD_BYTES` (shared with REST) and decoded via `decodeStrictBase64` before any billable work.
- Rate limiting: max 20 `audio_data` messages per connection within a 60-second window.

### 1.3 Identity, Billing, and Lifecycle Boundaries

| Concern | Boundary | Implementation |
|---|---|---|
| **Authentication** | Per-connection + per-request | JWT from query param verified in `handleConnection`; re-verified in `verifyConnection` before every Groq call. Revoked tokens (`revokedTokens` Map) and deleted/inactive accounts are checked. |
| **Billing** | Source instance only | `tokensService.consumeTokens()` is called on the instance that receives the `audio_data` message. Remote instances must not re-run paid work. |
| **Persistence** | Source instance only | `speaking_submissions` row is inserted on the source instance after `feedback_done`. |
| **Session state** | Process-local | `sessions` Map stores `{ topic, level, language, startedAt }` keyed by `client._sid`. This state is lost on restart. |
| **Token revocation** | Process-local | `revokedTokens` Map tracks revoked JTIs with expiry. Not shared across instances. |

### 1.4 Why Socket.IO Redis Adapter Does Not Apply

The roadmap note at `LinguaAI_Engineering_Roadmap.md:961` explicitly warns:

> `main.ts` uses `WsAdapter` from `@nestjs/platform-ws`, not Socket.IO. Do not add the Socket.IO Redis adapter and assume it works.

Reasons:
1. **Different wire protocol.** Socket.IO has its own handshake, packet framing, and room semantics. The `ws` library speaks raw WebSocket frames with no built-in broadcast or room abstraction.
2. **No drop-in compatibility.** Installing `socket.io-redis` would require migrating the entire gateway to `@nestjs/platform-socket.io`, changing the client SDK, and renegotiating the frame schema.
3. **Current gateway uses raw `ws` events.** The `@SubscribeMessage` decorators in `SpeakingGateway` bind to `ws` message events, not Socket.IO events.

---

## 2. Cross-Instance Pub/Sub Options

When running multiple API instances behind a reverse proxy (e.g., nginx, Traefik, or a cloud load balancer), a client connected to instance A will not receive events emitted by instance B unless a cross-instance delivery mechanism exists. Two options are described below.

### Option A: Per-Socket Delivery with Sticky Routing or Durable Outbox (Recommended Baseline)

This option avoids adding a pub/sub broker entirely. Instead, it relies on routing intelligence or durable state to ensure each message reaches the correct instance.

#### A1. Sticky Session Routing

- **Mechanism:** The reverse proxy routes all requests (including WebSocket upgrades) from the same client to the same backend instance using a sticky cookie or IP hash.
- **Pros:** Simplest; no extra infrastructure; no serialization overhead.
- **Cons:** Breaks on instance restart/failure; requires the proxy to support WebSocket sticky sessions; uneven load distribution if some clients are long-lived.
- **Neighbour dependency:** Reverse proxy must support `Upgrade: websocket` header passthrough and sticky session configuration.

#### A2. Durable Outbox with Polling

- **Mechanism:** When a paid operation completes on instance A, it writes the result to a durable store (e.g., PostgreSQL `speaking_submissions` or a dedicated `outbox_events` table). The client polls a REST endpoint (`GET /api/v1/speaking/operations/:operationId`) to retrieve the result, regardless of which instance it reconnects to.
- **Pros:** Works without sticky sessions; survives instance failure; leverages existing DB as source of truth.
- **Cons:** Adds latency (polling interval); not real-time; requires the client to handle both streaming and polling paths.
- **Neighbour dependency:** `OutboxRepository` (`apps/api/src/queue/outbox.repository.ts`) already provides PENDING/CLAIMED/PUBLISHED semantics with fenced lease claims. The chat controller already uses this pattern for SSE operations.

**Recommendation:** Option A is the baseline for beta/staging. It requires no new infrastructure and aligns with the current design where billing and persistence are local to the source instance.

### Option B: Opt-In Redis/NATS Pub/Sub Fan-Out

This option introduces a dedicated pub/sub channel for explicit broadcast events (e.g., session termination, token revocation) while keeping per-socket delivery for real-time streaming.

#### B1. Architecture

```
┌──────────────┐         ┌──────────────┐
│  Instance A  │         │  Instance B  │
│              │         │              │
│  SpeakingGW  │──publish─▶ Redis/NATS   │
│  Subscriber  │◀──subscribe──│           │
└──────────────┘         └──────────────┘
```

- **Publisher:** When an event needs cross-instance delivery (e.g., admin revokes a token), the source instance publishes an envelope to a dedicated channel (e.g., `linguaai:ws:broadcast` or `linguaai:ws:user:<userId>`).
- **Subscriber:** Each instance runs a dedicated Redis/NATS subscriber connection that listens to the channel and forwards matching events to local sockets.
- **Envelope schema:**
  ```json
  {
    "instanceId": "uuid",
    "channel": "user:<userId>",
    "event": "token_revoked",
    "data": { "jti": "..." },
    "timestampMs": 1234567890,
    "signature": "hmac-sha256(...)"
  }
  ```

#### B2. Delivery Semantics

| Property | Detail |
|---|---|
| **At-most-once** | Redis pub/sub does not persist messages. If a subscriber reconnects, messages published during the gap are lost. NATS core has the same limitation; NATS JetStream adds durability. |
| **Self-suppression** | An instance must ignore events it published (check `instanceId` against its own identity). |
| **Authentication** | Every envelope must carry a signature (HMAC with a shared secret) to prevent cross-tenant event leakage. |
| **No sensitive data** | Envelopes must never contain transcripts, audio bytes, raw tokens, or secrets. Only IDs and event codes. |

#### B3. Neighbour Dependencies

| Dependency | Current State | Required Change |
|---|---|---|
| **RedisService** | Exposes only `get/set/del/eval/keys/incrWithExpiry` (`apps/api/src/common/services/redis.service.ts`). No `subscribe` or raw client accessor. | Add a dedicated pub/sub service or expose the raw `ioredis` client for `subscribe()`/`psubscribe()`. |
| **JwtService/PrismaService/TokensService** | Unchanged. Used for auth verification and billing on the source instance. | No change needed. |
| **Common module exports** | `RedisService` is provided globally. | Add new pub/sub service to the common module. |
| **Reverse proxy** | Must support `Upgrade: websocket` header passthrough. | Verify nginx/Traefik config allows WebSocket upgrades to all instances. |

#### B4. Risks

| Risk | Mitigation |
|---|---|
| **JWT in query string/log leakage** | Strip query params from access logs at the proxy; use short-lived tokens. |
| **Cross-tenant event leakage** | Use user-scoped channels (`user:<userId>`) and HMAC-signed envelopes. |
| **At-most-once loss during reconnect** | Accept loss for non-critical events; use NATS JetStream for durable delivery if needed. |
| **Duplicate billing on reconnection** | Idempotency key (`speaking-ws-<sid>-<timestamp>`) ensures `consumeTokens` is charged once. |
| **Sticky-session requirements** | If using Option A1, configure proxy sticky sessions; otherwise fall back to Option A2. |
| **WebSocket message-size limits** | `maxPayload: 8MB` is set in the gateway; enforce client-side chunking. |
| **Redis being optional** | The current design treats Redis as a cache/rate-limit transport. Pub/sub must fail closed (log warning, skip broadcast) if Redis is unavailable. |

---

## 3. Testing Strategy

### 3.1 Unit Contract Tests

- **Envelope serialize/parse/reject:** Validate that envelopes conform to the schema above; reject malformed/expired payloads.
- **Local-vs-remote fan-out:** Assert that local-only single-instance behavior is unchanged when pub/sub is disabled.
- **Self-suppression:** Verify that an instance ignores its own published events.
- **Malformed/expired payload rejection:** Test JWT expiry, revoked JTI, and invalid HMAC signatures.

### 3.2 Two-Instance Integration

- **Real Redis/NATS pub/sub:** Spin up two API instances and one Redis/NATS broker; verify cross-instance delivery.
- **Restart/reconnect delivery:** Kill instance A mid-stream; verify client reconnects to instance B and retrieves result via polling (Option A2) or receives broadcast (Option B).
- **Regression:** Confirm that local-only single-instance behavior is unchanged when pub/sub is disabled.

---

## 4. Decisions and Blockers

### Decisions

1. **Documentation-only slice:** `docs/websocket-architecture.md` is created as the single artifact; no application source changes are made in this task.
2. **Reject Socket.IO:** The current design is documented as raw `ws`/`WsAdapter`; adding `@nestjs/platform-socket.io` or `socket.io-redis` is explicitly rejected as a drop-in solution.
3. **Two options presented:** Per-socket delivery with sticky routing/durable outbox (recommended baseline) versus opt-in Redis/NATS pub/sub fan-out for explicit broadcast events.
4. **JWT/user ownership preserved:** Per-paid-request re-verification, token consumption, and submission persistence remain on the source instance; remote instances must not re-run paid work.
5. **Authentication on every envelope:** Cross-instance event envelopes must carry authentication/authorization claims (HMAC signature), with no transcript, audio, raw token, or secret values in broadcast payloads.
6. **RedisService limitation acknowledged:** RedisService currently exposes no `subscribe` or raw-client interface, so a dedicated pub/sub service/accessor is a neighbour dependency rather than an existing capability.

### Blockers

1. **File creation required:** The computed task specifies `docs/websocket-architecture.md` is in scope, but the file did not exist prior to this write. Git status confirms it is now a new untracked file.
2. **Pub/sub library choice unresolved:** The roadmap only says "design pub/sub for the raw ws protocol." The exact choice (NATS vs Redis vs NATS JetStream) cannot be finalized from the repo alone and must be a deployment decision.
3. **No local `.env` values read:** Deployment config references `REDIS_PASSWORD` via Compose variables only; no credentials were read or included in this document.
