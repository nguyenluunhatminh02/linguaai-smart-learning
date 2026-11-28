# Timezone policy: UTC instants, UTC days, local display

Status: policy decision for roadmap slice `db-26`. This document defines the rule;
the code changes needed to reach it are tracked separately (BUG-06, BILL-05 and the
timezone follow-up slice). It does not change runtime behaviour by itself.

## 1. Decision

**UTC midnight is the single authoritative server day boundary.** Every
day-scoped rule — token grants, daily usage counters, XP/streak rows, check-in
bonuses and leaderboard windows — is evaluated on a UTC day, identified by the
`YYYY-MM-DD` prefix of an ISO-8601 UTC timestamp.

Local time is **display-only**. A client may render an instant in the learner's
local timezone and may label a UTC day with a local date, but the client must
never decide which day an activity, grant or check-in belongs to.

A UTC day `D` is the half-open interval `[D T00:00:00.000Z, (D+1) T00:00:00.000Z)`.
Use half-open bounds (`gte` start, `lt` end) everywhere; never use inclusive
end-of-day bounds, which lose sub-millisecond events and drift across DST.

Worked example:

| Event | UTC day | Consequence |
| --- | --- | --- |
| `2026-11-28T23:59:00Z` | `2026-11-28` | First grant/check-in of that UTC day |
| `2026-11-29T00:01:00Z` | `2026-11-29` | Separate grant/check-in allowed; previous day's counters closed |
| Same UTC day, two calls | same day | Duplicate call returns `alreadyCheckedIn: true` and grants 0 |

A learner in UTC+7 sees those instants as 06:59 and 07:01 on 29 November local
time. The UI may show both as "29 Nov" in that locale; the server still treats
them as two different days. Conversely, a learner in UTC-7 sees the same events
as 16:59 and 17:01 on 28 November. That must not merge them into one server day.

## 2. Scope by domain

| Domain | Authoritative boundary | Authoritative source | Local timezone used for |
| --- | --- | --- | --- |
| Daily top-up grant | UTC midnight | `daily_credit_grants` row keyed by `(user_id, grant_type, day)` | Nothing |
| Daily check-in bonus | UTC midnight | `daily_credit_grants` (`DAILY_CHECKIN` markers) | Cosmetic "today" label only |
| Daily token usage (`todayUsed`) | UTC midnight | `token_transactions.created_at` in `[start, endExclusive)` | Nothing |
| XP / activity / activity streak | UTC midnight | `user_streaks.date` + `users.streak_count` | Formatting timestamps in the UI |
| Leaderboard windows | UTC week/month | `user_streaks.date` window | Nothing |
| SRS scheduling | Instant arithmetic (`next_review_date`) | Stored timestamp compared to `now` | Optional human-readable due label |
| Notifications / reminder crons | Server UTC schedule | Cron configuration | Nothing in the persistence layer |

Never mix a local-date key with UTC timestamps in the same comparison. That is
the defect class behind BUG-05/BUG-06 (usage counted on local midnight while
grants used UTC midnight).

## 3. Two distinct streak concepts

These are different products of different actions and must keep separate names
in code, API responses and UI copy. Both are computed on UTC days, but neither
may be substituted for the other.

| Concept | Storage | Meaning | Updated by |
| --- | --- | --- | --- |
| **Activity streak** | `user_streaks` rows and `users.streak_count` | Consecutive UTC days with recorded learning activity (review, quiz, lesson) | `AnalyticsService.recordActivity` |
| **Check-in bonus streak** | `daily_credit_grants` rows of type `DAILY_CHECKIN` | Consecutive UTC days with a claimed daily check-in bonus | `TokensService.dailyCheckIn` / `checkInStreak` |

Rules:

- Claiming a check-in bonus does **not** increment `users.streak_count`.
- Recording learning activity does **not** create a check-in grant row.
- The check-in reward table (`TokensService.CHECKIN_BONUSES`, 7 entries:
  `[5, 5, 8, 8, 10, 10, 15]`) is driven only by the check-in streak. It repeats
  after day 7.
- `user_streaks` upserts accumulate XP/minutes for the same UTC day; a second
  activity on that day must not increment `streak_count` twice.
- A missing UTC day breaks a streak. There is no "grace period" in either
  concept.

## 4. Current state in this checkout

Documented so the rollout has an explicit starting point (line numbers are
indicative and may move in later slices):

- `apps/api/src/tokens/tokens.service.ts:352-375` already defines shared UTC day
  helpers (`utcDay`, `shiftUtcDay`); grants, `todayUsed`
  (`tokens.service.ts:583-595`), daily check-in (`:597-721`) and top-up (`:723+`)
  use UTC day identity. Redis keys are advisory hints only; the DB marker is the
  authority, so a cache flush or stale fixture cannot grant twice.
- `apps/api/src/analytics/analytics.service.ts:20-36` derives `today` and the
  daily window from a client-supplied `x-timezone-offset` header.
- `analytics.service.ts:74` shifts the raw SQL grouping by the same offset.
- `analytics.service.ts:134-192` (`recordActivity`) accepts a fourth
  `timezoneOffsetMinutes` argument and writes the offset-derived date into
  `user_streaks`, including the "yesterday" lookup used to extend
  `users.streak_count`.
- `analytics.service.ts:222-236` computes leaderboard week/month starts with
  server-local `getDay()`/`setDate()`/`getFullYear()` calls while comparing
  against `user_streaks.date`, which may itself be offset-derived.
- `apps/api/src/analytics/analytics.controller.ts:19-28` parses
  `x-timezone-offset` and passes it into `getDashboard`; the header is likewise
  allowed by CORS (see `docs/endpoint-inventory-content.md:19`).
- `apps/web/src/components/features/daily-checkin.tsx:13-15,26-56,86-92,94-131,138-154`
  stores the last check-in date, streak and history in `localStorage` under
  browser-local dates (`getLocalDayStr`) and calls
  `POST /users/me/tokens/daily-checkin`. The button can therefore be disabled or
  enabled on a different day than the server uses.

## 5. Target implementation contract

### 5.1 Shared helpers

Use one set of UTC helpers (in `apps/api/src/common/utils/date.util.ts`) rather
than duplicating `toISOString().slice(0, 10)` and `86_400_000` arithmetic:

- `utcDay(now = new Date())` → `{ day, start, endExclusive }`
- `shiftUtcDay(day, deltaDays)` → `YYYY-MM-DD`
- `dayWindow(day)` → the same half-open `[start, endExclusive)` pair

`TokensService`'s existing private helpers should delegate to these, keeping
their behaviour. `DateUtil.addDays` remains instant arithmetic and is not a day
boundary helper.

### 5.2 Analytics

- `getDashboard(userId)` drops the offset parameter; `today`, the 7-day history
  and the `last_review_date` window use UTC days.
- The raw activity aggregation groups by `to_char(completed, 'YYYY-MM-DD')`
  with no offset interval; stored timestamps are UTC instants.
- `recordActivity(userId, xp, minutes)` drops the offset parameter; `today` and
  `yesterday` are UTC day strings, and the upsert/streak extension is unchanged
  otherwise.
- `getLeaderboard` derives `thisWeek` from UTC Monday and `thisMonth` from UTC
  day 1, and bounds the window with the current UTC day. Do not use local
  `getDay()`, `setDate()` or `new Date(year, month, 1)`.
- Callers (for example quiz and learning controllers/services) pass three
  arguments. Extra arguments are harmless at runtime but must be removed so the
  API has one meaning.

### 5.3 Check-in status and response

Add a read-only status endpoint so the UI can render server truth before any
mutation, proposed as:

`GET /users/me/tokens/daily-checkin/status` →
`{ utcDay, checkedIn, streak, tokensEarnedToday, history }`

Extend `POST /users/me/tokens/daily-checkin` with `utcDay` in addition to its
current `balance`, `todayUsed`, `tokensEarned`, `alreadyCheckedIn` and `streak`
fields. `utcDay` must be the same value the grant marker was written under and
the same value the status endpoint reports.

The check-in streak in both endpoints is the **check-in bonus streak**, never
`users.streak_count`.

### 5.4 UI

- On mount, fetch the status endpoint; drive `checkedIn`, `streak` and the 7-day
  timeline from its response. `utcDay` is the timeline's "today".
- The button is disabled when `checkedIn === true` or while the request is in
  flight. The client must not consult `localStorage` or `getLocalDayStr()` to
  decide eligibility.
- After a successful POST, replace local state from the response (`utcDay`,
  `streak`, `tokensEarned`, `balance`); do not synthesize the new streak with
  `streak + 1`.
- Weekday labels may still be localized with `Intl.DateTimeFormat` — that is
  display formatting only. If a UTC day is rendered as a local calendar date,
  label it unambiguously (for example show the UTC date or a tooltip) so a
  learner near midnight is not told they "already checked in today" when the
  UTC day has just changed.
- Remove the legacy `daily_checkin`, `daily_checkin_streak` and
  `daily_checkin_history` keys from the client once status is authoritative;
  do not read them as a fallback.

### 5.5 `x-timezone-offset`

Phase 1: the server ignores the header. Existing clients that still send it
keep working and the header becomes harmless; do not reject or validate it.
Phase 2: remove all server parsing, the fourth `recordActivity` argument and the
CORS allowance once no deployed client sends it. Until phase 2, the header may
be documented as deprecated with no effect on any day computation.

## 6. Data migration and backfill

**No schema migration is required for this policy.** `daily_credit_grants.day`
and `user_streaks.date` are dates, and the target format (`YYYY-MM-DD` UTC) is
already what the code writes.

There is one data cleanup obligation, however: historical `user_streaks.date`
values were written with the client offset at the time of the request, and the
offset used is not stored. Those rows cannot be reinterpreted as UTC days —
the same string may mean two different instants for two learners. Do not attempt
a deterministic conversion.

One-time remediation for `user_streaks` / `users.streak_count`:

1. Pick a deployment instant and record it (UTC) in the change log.
2. Reset `users.streak_count` to 0 for all accounts (or to a clearly labelled
   legacy value if product requires), and remove or archive pre-cutover
   `user_streaks` rows. Preserve `xp_earned`/`minutes_studied` totals in
   `users.total_xp` if those are needed for rankings; the daily rows themselves
   are the ambiguous part.
3. Rebuild `users.streak_count` from post-cutover UTC `user_streaks` rows
   (or recompute from `review_sessions`, `quiz_attempts` and
   `learning_completions` grouped by UTC day if a historical streak must be
   restored). The check-in bonus streak needs no rebuild: it is already derived
   from `daily_credit_grants` UTC markers.
4. Announce the reset in the UI at the cutover, since visible streak numbers
   will change.

Any backfill script must be idempotent, run in a transaction, and be exercised
against a copy of production data first. Never infer a timezone from a user's
country or locale.

## 7. Rollout order

1. **Backend first, additive:** add shared UTC helpers, a status endpoint and
   `utcDay` in the check-in response; switch dashboard/activity/leaderboard
   computation to UTC. Ignore `x-timezone-offset`. This is safe for old clients:
   the header becomes inert and response fields are additive.
2. **Update tests and stale call sites:** change `recordActivity` callers to
   three arguments, replace offset-specific assertions, and verify status and
   POST agree at `2026-11-28T23:59Z` vs `2026-11-29T00:01Z`.
3. **UI switch:** mount-time status fetch, server-driven `checkedIn`/`streak`,
   server response applied after POST, remove `localStorage` day logic.
4. **Cleanup:** remove `x-timezone-offset` parsing, the fourth service argument
   and the CORS allowance; remove legacy localStorage keys.
5. **Data cutover:** execute the one-time streak reset/rebuild from section 6
   with a user-visible notice.

Steps 1-2 and 3-4 can ship separately; step 5 must happen after step 1 and
before any claim that historical streaks are UTC-correct.

## 8. Acceptance checks

- `23:59Z` and `00:01Z` on adjacent dates produce two grants/check-ins, two
  `user_streaks` days and two `todayUsed` buckets.
- Repeating a grant/check-in in the same UTC day grants 0 tokens and returns
  `alreadyCheckedIn: true` (top-up writes a `amount = 0` marker when balance is
  already sufficient, so spending later that day cannot re-grant).
- Concurrent calls and a Redis flush can never produce two grants for one UTC
  day; the `daily_credit_grants` unique index and transaction are the guard.
- A missed UTC day resets both streak concepts independently.
- Dashboard `streak`, 7-day activity and leaderboard windows do not change when
  a client sends, omits or varies `x-timezone-offset`.
- Status and POST check-in report the same `utcDay`, `streak` and `checkedIn`
  semantics for the same request time.
- No client-side date comparison gates the check-in button.
- No test or code path writes a timezone-derived date into `user_streaks` or a
  grant marker.

## 9. Out of scope for this document

This doc records the policy only. The implementation and test changes listed in
sections 5-7 are separate slices and must not be assumed complete: the analytics
offset header, client-local check-in state and leaderboard local-week boundary
are still present in the checkout described in section 4.
