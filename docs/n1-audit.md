# N+1 Audit — db-29

> Scope: static scan of `apps/api/src` against roadmap DB-04 (line 645: "Kiểm tra N+1 bằng Prisma query metrics/log ở test") and DB-04 line 646 ("Đẩy aggregate thích hợp xuống SQL: `SrsService.getStats()`").
> Date: 2026-11-28. Plan-only — no source files edited.

## Method

- `rg` for `Promise\.all|\.map\(|for \(const|createMany|groupBy|\.count\(|findMany|bcrypt\.(hash|compare)` across suspected services.
- Manual read of each hit to confirm whether the loop issues one DB/Redis/SMTP call per iteration, or is a bounded in-memory fan-out.
- Cross-referenced with `PrismaService` (`apps/api/src/prisma/prisma.service.ts:15-186`) which already exposes `PRISMA_QUERY_METRICS_ENABLED` and a `PrismaQueryMetricsPort` sink — the verification commands below reuse that port rather than adding SQL logging in production.

## Suspected sites (ranked by cost)

| # | File : lines | Pattern | Cost per call (before) | Notes |
|---|---|---|---|---|
| 1 | `apps/api/src/notifications/notifications-cron.service.ts:46-64` | `for (group of dueCards) await notificationsService.create(...)` — 1 INSERT per user | 1 groupBy + U inserts | Best first target. Replace with chunked `createMany` (e.g. 500 rows/chunk). |
| 2 | `apps/api/src/common/services/scheduled-delete.service.ts:28-68` | `for (user of users) await $transaction(9 deleteMany + 1 update)` | ~11 * U queries, one transaction per user | Bulk per-table `deleteMany({user_id:{in: ids}})` + `users.updateMany` in one transaction per chunk. |
| 3 | `apps/api/src/quiz/quiz.service.ts:221-235` and `:478-484` | `Promise.all(dto.questions.map(q => prisma.quiz_questions.create(...)))` | N parallel INSERTs (no `@ArrayMaxSize` on `CreateQuizDto.questions`; only AI-generated count capped at 20) | Replace with `createManyAndReturn` (or `createMany` + one `findMany` by `quiz_id`); restore stable question order. |
| 4 | `apps/api/src/srs/srs-reminder.service.ts:26-79` | Two `groupBy` passes over `user_card_progress` + sequential `emailService.sendSrsReminderEmail` per user | 2 groupBy + U SMTP round-trips | Collapse to one `groupBy` with `_count`; bounded-concurrency email dispatch (e.g. `p-limit(5)`). |
| 5 | `apps/api/src/srs/srs.service.ts:315-349` `getStats()` | Full `user_card_progress.findMany` + `cards.count` with unbounded `notIn(learnedCardIds)` + in-JS filter/count | 1 full-table scan + 1 count with growing `notIn` list | Named in roadmap DB-04 line 646. Push aggregation to SQL: `groupBy` + raw aggregate with the same visible-card filter. |
| 6 | `apps/api/src/users/users.service.ts:416-427` | `for (q of questions) { bcrypt.hash; tx.security_questions.create }` inside one transaction | 2 * Q queries (max Q=3) | `Promise.all` the bcrypt hashes, then one `createMany`. Low priority — bounded to 3. |
| 7 | `apps/api/src/auth/services/device.service.ts:101-117` | `for (dev of oldestActiveDevices) await tokenService.revokeDeviceSession(...)` then redundant `user_devices.updateMany` for the same IDs | 3 * E queries (E = excess devices) + 1 duplicate updateMany | Add `TokenService.revokeDeviceSessions(userId, deviceIds[])` bulk path; drop the duplicate `updateMany` (the per-device call already sets `active: false`). |
| 8 | `apps/api/src/auth/services/token.service.ts:380-394` | `for (key of otherKeys) await redis.set(revoked-device:..., ttl)` | 1 Redis SET per evicted device | Use a pipeline (`RedisService.setManyWithTtl`); `redis.service.ts:155` `mset()` has no TTL, so a pipeline is required. |
| 9 | `apps/api/src/auth/services/password-history.service.ts:52-53` | `for (entry of history) await bcrypt.compare(...)` | Q CPU-bound bcrypt compares (bounded by `HISTORY_LIMIT`) | CPU fan-out only, not DB. `Promise.all` is fine; keep fail-closed semantics. |

## Verified NOT N+1 (do not change)

| File : lines | Reason |
|---|---|
| `apps/api/src/analytics/analytics.service.ts:27-59` dashboard | 9 fixed parallel queries inside one `Promise.all`; count is O(1) in input size. |
| `apps/api/src/analytics/analytics.service.ts:130-231` leaderboard | 3 fixed queries (`groupBy` + `findMany` + one fallback `findMany`). |
| `apps/api/src/recommendations/recommendations.service.ts:246` | Already batches decks with `id: { in: deckIds }`. |
| `apps/api/src/decks/decks.service.ts:105-127` | Already uses `Promise.all` of 3 counts after a single `findMany`. |
| `apps/api/src/notifications/notifications.service.ts:33-54` `findAll` | Two parallel queries (`findMany` + `count`); constant. |
| `apps/api/src/users/users.service.ts:556-590` GDPR export | ~20 parallel `findMany` inside one `Promise.all`; constant in user count (always 1 user). |

## Neighbor interfaces required for the fix pass

| Provider | New method | Shape |
|---|---|---|
| `NotificationsService` | `createMany(entries)` | `entries: {userId, type, channel, title, message, data?}[]` -> `Prisma.BatchPayload` |
| `RedisService` | `setManyWithTtl(entries)` | `entries: {key, value, ttlSeconds}[]` via pipeline (existing `mset()` at `redis.service.ts:155` has no TTL) |
| `TokenService` | `revokeDeviceSessions(userId, deviceIds[])` | Bulk Redis DEL + bulk `revoked-device:` SET + one `user_devices.updateMany`; preserve fail-closed on Redis outage |
| `EmailService` | (no signature change) | Caller wraps `sendSrsReminderEmail` in a bounded-concurrency helper |

## Verification commands

All commands run from the repo root. None log query text or params; the Prisma metrics port only carries bounded, non-sensitive labels (`classifyPrismaOperation` at `prisma.service.ts:72-90`).

### 1. Count queries per service method in unit tests

```bash
# Enable the existing metrics port for the test run only.
PRISMA_QUERY_METRICS_ENABLED=true pnpm --filter api test -- \
  -t "NotificationsCronService|ScheduledDeleteService|QuizService|SrsReminderService|SrsService|DeviceService|TokenService"
```

In each new/extended `*.spec.ts`, inject a stub `PrismaQueryMetricsPort` and assert on `recordQuery` call count:

```ts
const sink = { recordQuery: jest.fn(), recordError: jest.fn() };
// provide via PRISMA_QUERY_METRICS token in Test.createTestingModule(...)
// then:
expect(sink.recordQuery).toHaveBeenCalledTimes(expectedCount);
```

Expected counts after the fix pass (per single invocation):

| Method | Before | After |
|---|---|---|
| `NotificationsCronService.handleDailySRSReminder` (U users) | 1 + U | 1 + ceil(U/500) |
| `ScheduledDeleteService.permanentlyDeleteExpiredAccounts` (U users) | ~11 * U | ~11 (one chunked transaction) |
| `QuizService.create` (N questions) | 1 + N | 2 (create quiz + createManyAndReturn) |
| `QuizService.generateFromAi` (N questions) | 1 + N | 2 |
| `SrsReminderService.sendDailyReminders` (U users) | 2 + U | 1 + U (email I/O unchanged; DB drops 2 -> 1) |
| `SrsService.getStats` | 2 + full-table scan | 1 aggregate (groupBy + raw) |
| `DeviceService.registerDevice` (E evictions) | 3 * E + 1 | 1 bulk revoke |
| `TokenService.revokeOtherSessions` (E others) | 1 + E | 1 + 1 (pipeline) |

### 2. Lint / typecheck guard

```bash
pnpm --filter api lint
pnpm --filter api build   # catches any Prisma type drift from createManyAndReturn
```

### 3. Prisma query-log smoke (dev only, never in production)

```bash
# One-shot: run the API with query events on, hit one endpoint, count lines.
LOG_LEVEL=debug PRISMA_QUERY_METRICS_ENABLED=true pnpm --filter api dev &
# ...exercise the endpoint via curl or the web app...
# Watch the metrics sink output; do NOT grep the raw SQL.
```

### 4. Roadmap acceptance

```bash
# Confirm the two DB-04 checkboxes this audit addresses.
grep -n "Kiểm tra N+1\|SrsService.getStats" LinguaAI_Engineering_Roadmap.md
# Expected: lines 645 and 646.
```

## Out-of-scope / blockers

- `apps/api/src/quiz/dto/quiz.dto.ts`: `CreateQuizDto.questions` has no `@ArrayMaxSize`. The fix pass should add `@ArrayMaxSize(20)` to match the AI-generated cap; record as a separate commit if the DTO is shared with other callers.
- `EmailService.sendSrsReminderEmail` is sequential in the cron. Adding `p-limit` is a behavioural change (concurrent SMTP) — confirm with the email provider's rate limits before enabling.
- `RedisService.setManyWithTtl` requires a pipeline; the existing `mset()` at `redis.service.ts:155` cannot be reused because it does not set TTL. Do not change `mset()` callers without auditing them.
- `TokenService.revokeDeviceSessions` must preserve fail-closed semantics on Redis outage — the bulk path must throw `ServiceUnavailableException` when `failClosedOnRedisOutage` is true and Redis is down, matching `revokeDeviceSession` today.
