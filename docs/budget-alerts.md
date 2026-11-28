# OPS-23 — Budget alert: per-user and global policy (placeholder)

Status: **placeholder**. This document records the intended shape of the
per-user/day and global/day budget policy, the alert thresholds, the
feature kill-switch rules, and the runbook for the `budget limit` alert
referenced by `docs/runbooks.md` §5 and roadmap OPS-03 (line 934) /
AI-03 (line 703). No code, metric producer, env value or alert rule is
claimed to exist in this checkout. Thresholds are explicitly marked
PLACEHOLDER and must be baselined against staging traffic before any
paging is enabled.

Source of truth for the day boundary: `docs/timezones.md` (BILL-05) —
UTC midnight is the single authoritative server day. All budget
counters, kill switches and alert windows in this document use that
same UTC day.

Source of truth for the alert contract skeleton: `docs/runbooks.md` §5
(symptoms, checks, mitigation, recovery, owner). This document adds the
policy and threshold placeholders that §5 assumes but does not define.

## 1. Scope

Two independent scopes share the same evaluation shape but have
different counters, different caps and different escalation owners.

| Scope | Counter source | Cap source | Owner |
| --- | --- | --- | --- |
| Per-user / day | `ai_operations` rows for one `user_id` within the UTC day (`reserved_credits` or `charged_credits`, summed) | Per-user daily allowance (from the learner credit ledger / plan tier) | Billing on-call |
| Global / day | `ai_operations` rows for all `user_id`s within the UTC day | Global daily spend cap (deployment configuration) | AI cost owner + platform on-call |

Both scopes are evaluated on the UTC day `D =` the `YYYY-MM-DD` prefix
of the current UTC instant, with the half-open window
`[D T00:00:00.000Z, (D+1) T00:00:00.000Z)` — identical to the rule in
`docs/timezones.md` §1. Never mix a local-date key with UTC timestamps
in the same comparison.

Credit units in this document are **learning credits** from the
`ai_operations` ledger (`reserved_credits` / `charged_credits`, priced
by `AiOperationsPolicy.AI_OPERATION_COSTS`). They are not provider
tokens or USD cost: the `provider_attempts` table does not yet exist in
Prisma, so provider-side cost accounting is out of scope for this
placeholder and must not be fabricated.

## 2. Thresholds (PLACEHOLDER)

All percentages below are proposals. Replace each value with a number
baselined from at least one full staging traffic day before enabling
any paging. Do not copy these numbers into production configuration.

| Threshold | Scope | Proposed trigger | Proposed severity | Action |
| --- | --- | --- | --- | --- |
| Warn | per-user / day | usage ≥ **<replace-me>**% of user daily cap (e.g. 50%) | info | Structured log; no user-visible effect |
| Critical | per-user / day | usage ≥ **<replace-me>**% of user daily cap (e.g. 80%) | warn | Reduce concurrency / backoff for that user+feature; notify billing on-call |
| Block | per-user / day | usage ≥ **<replace-me>**% of user daily cap (e.g. 100%) | high (page) | Reject new billable operations for that user with 429 + `retryAfter` aligned to the next UTC midnight |
| Warn | global / day | usage ≥ **<replace-me>**% of global daily cap (e.g. 50%) | info | Structured log; no user-visible effect |
| Critical | global / day | usage ≥ **<replace-me>**% of global daily cap (e.g. 80%) | warn | Reduce concurrency for the hottest feature(s); notify AI cost owner |
| Block | global / day | usage ≥ **<replace-me>**% of global daily cap (e.g. 100%) | high (page) | Reject new billable operations globally with 429 + `retryAfter` aligned to the next UTC midnight |
| Kill-switch active | per feature | feature kill switch is set (any scope) | info + audit | Stop accepting new operations for that feature; in-flight operations continue under existing leases |

The three severity levels map to the runbook escalation in
`docs/runbooks.md` §0.6: info is logged, warn notifies the on-call
channel, high pages the on-call. No threshold may page on its own
without a second-person approval step recorded in the incident ticket
for any action that moves money or flips a kill switch.

## 3. Evaluation contract (placeholder)

A future `AiBudgetPolicy` (pure) and `AiBudgetService` (injectable)
should expose an evaluation of the form:

- Input: `{ scope, userId?, feature, usage, limit, now }`
- Output: `{ allowed, blockedReason?, severity, threshold, resetAt }`

Rules:

1. `resetAt` is always the next UTC midnight (`dayWindow(day).endExclusive`
   from `docs/timezones.md` §5.1). Never a local midnight, never a
   rolling 24-hour window.
2. `usage` is the sum of `reserved_credits` (for the gate) or
   `charged_credits` (for the post-hoc alert) over `ai_operations`
   rows whose `created_at` falls in the UTC day window, grouped by
   `user_id` for per-user scope and ungrouped for global scope.
3. The policy is pure and testable with injectable threshold overrides
   so staging baselines do not require code changes. Constants in the
   policy file are marked `PLACEHOLDER` and must not be read as
   production values.
4. `feature` is one of the keys of
   `AiOperationsPolicy.AI_OPERATION_COSTS`; unknown features throw and
   must not silently pass the gate.
5. The service calls the repository aggregate, applies the policy, and
   on `allowed === false` returns HTTP 429 with `retryAfter` equal to
   the number of seconds until `resetAt`. On Redis failure the service
   is fail-closed (reject), matching `RateLimiterService` semantics
   (`apps/api/src/common/services/rate-limiter.service.ts:109-149`).
6. Bucket keys for Redis counters must not contain raw user IDs in
   plaintext; hash the user identifier before composing the key, and
   never log the raw user ID in alert payloads.

## 4. Feature kill switch

A kill switch is a per-feature boolean that, when active, causes the
budget gate to reject every new operation for that feature regardless
of remaining cap. It is orthogonal to the percentage thresholds above.

Rules:

1. The kill switch is configuration, not code: it is read from a
   deployment-time source (env / secret store) and re-evaluated per
   request. A runtime toggle endpoint is TARGET and must require a
   second-person approval recorded in the incident ticket before any
   state change (consistent with `docs/runbooks.md` §0.6).
2. The kill switch is per-feature, never global-by-default. A global
   pause is a separate, higher-severity decision and must not be
   reached by cascading per-feature switches.
3. In-flight operations that already hold a lease are not cancelled by
   a kill switch flip; they complete or expire under the existing
   `AiOperationsPolicy` lease and attempt rules
   (`ai-operations.policy.ts:158-177`). New `findOrCreate` / reserve
   calls for the killed feature are rejected with a bounded error code
   (e.g. `FEATURE_DISABLED`) and no debit.
4. The set of features that may be killed is the same set accepted by
   `AiOperationsPolicy.getCost`; adding a feature to the kill-switch
   list without a catalog entry is a configuration error and must fail
   closed.
5. Every kill-switch transition (on or off) emits an audit event with
   the feature name, the decision owner, the UTC instant, and the
   incident ticket reference. No user IDs, prompts, audio or provider
   strings in the audit payload.

## 5. Alert event contract (placeholder)

Each alert event emitted by the budget subsystem should carry at least:

- `alert`: `budget_limit`
- `scope`: `user` | `global`
- `feature`: bounded label from the AI operation catalog
- `severity`: `info` | `warn` | `high`
- `threshold`: the percentage that fired (one of the PLACEHOLDER values
  from §2)
- `usage`, `limit`: the numerator and denominator that produced the
  percentage, in learning-credit units
- `resetAt`: ISO-8601 UTC instant of the next UTC midnight
- `utcDay`: the `YYYY-MM-DD` UTC day the counter belongs to

Forbidden in the event payload (OPS-03 line 933, `docs/runbooks.md`
§0.5): raw user IDs, request IDs, raw URLs, emails, prompts, audio,
JWTs, API keys, `.env` values, free-text provider error strings. User
identity, when needed for investigation, lives only in the
access-controlled incident record.

## 6. Environment variable names (PLACEHOLDER)

Only names are listed below. No values, no defaults that look like
values, no real credentials. Each name is a placeholder to be filled
from the deployment secret store; the Joi schema in
`apps/api/src/config/env.validation.ts` should validate presence and
shape only, with a safe fail-closed default when the variable is
absent.

| Variable name (placeholder) | Purpose | Secret? |
| --- | --- | --- |
| `<replace-me:BUDGET_USER_WARN_THRESHOLD>` | Per-user warn percentage (0-100) | No |
| `<replace-me:BUDGET_USER_CRITICAL_THRESHOLD>` | Per-user critical percentage (0-100) | No |
| `<replace-me:BUDGET_USER_BLOCK_THRESHOLD>` | Per-user block percentage (0-100) | No |
| `<replace-me:BUDGET_GLOBAL_WARN_THRESHOLD>` | Global warn percentage (0-100) | No |
| `<replace-me:BUDGET_GLOBAL_CRITICAL_THRESHOLD>` | Global critical percentage (0-100) | No |
| `<replace-me:BUDGET_GLOBAL_BLOCK_THRESHOLD>` | Global block percentage (0-100) | No |
| `<replace-me:BUDGET_DAY_BOUNDARY_UTC>` | Day boundary override; default `00:00` UTC, must match `docs/timezones.md` | No |
| `<replace-me:BUDGET_KILL_SWITCH_FEATURES>` | Comma-separated list of features whose kill switch is active at boot | No |
| `<replace-me:BUDGET_FAIL_CLOSED>` | `true` (default) / `false`; behaviour when Redis is unavailable | No |
| `<replace-me:BUDGET_USER_DAILY_CAP>` | Per-user daily cap in learning credits, when not derived from plan tier | No |
| `<replace-me:BUDGET_GLOBAL_DAILY_CAP>` | Global daily cap in learning credits | No |

Follow the convention in `docs/provider-setup.md`: placeholders are
written as `<replace-me>` or `<replace-me:NAME>`; real values live
only in gitignored local env files or the deployment secret store.
Never commit a resolved value. Never echo env files in CI.

## 7. Runbook summary

The full runbook lives in `docs/runbooks.md` §5. This section records
only the budget-specific additions that §5 assumes.

### Symptoms

- Per-user or global usage crosses a PLACEHOLDER threshold from §2.
- A feature kill switch is active and that feature's operations stop
  being accepted.
- Users receive 429 responses with `retryAfter` pointing at the next
  UTC midnight.

### Checks

1. Confirm the price source is server-side only:
   `AiOperationsPolicy.AI_OPERATION_COSTS` and
   `TokensService.PRICING_CATALOG`. No client-supplied price enters a
   reserve/settle path (BILL-04 line 316).
2. Confirm the counter uses the UTC day boundary from
   `docs/timezones.md` §1. A counter keyed by local midnight is the
   defect class of BUG-05/BUG-06 and must not be trusted.
3. Confirm the scope: one identity, one feature, one model, or global.
   Use bounded labels only; keep identity analysis in access-controlled
   logs.
4. Confirm the kill switch, if any, was flipped with a recorded
   approval and incident ticket (§4.1, `docs/runbooks.md` §0.6).
5. Confirm Redis health: a fail-closed budget gate surfaces as 429/503
   spikes that look like provider outages but are not
   (`docs/runbooks.md` §3, checks 3 and 5).

### Mitigation

- At warn: notify the on-call channel; do not silently raise the cap.
- At critical: reduce concurrency / backoff for the affected
  scope+feature; do not disable the gate.
- At block: reject new billable operations for the offending scope or
  feature; preserve at-most-once billing semantics (no debit without
  an operation id).
- If the counter is wrong (UTC boundary, TTL, multi-instance drift),
  fix the counter under a reviewed change and reconcile spend from the
  ledger; do not disable the gate globally to restore service.

### Recovery

Confirm spend counters use server-side pricing and UTC boundaries, the
kill switch is cleared with an audited decision, and the ledger still
matches (`docs/runbooks.md` §1). Record the cap, observed usage,
feature, decision, approvers and UTC clear time. If the gate was never
implemented, leave the alert in a documented "no producer" state
rather than inventing evidence.

### Owner

Primary: AI cost owner with API/platform on-call. Billing owner for
per-user cap decisions. Security owner for suspected abuse or
credential compromise. Second-person approval required for any kill
switch or money movement (`docs/runbooks.md` §0.6).

## 8. Out of scope for this document

- The `AiBudgetPolicy`, `AiBudgetService`, repository aggregate
  methods, env-validation schema changes, module wiring and unit tests
  are separate slices and are not claimed to exist here.
- Provider-side cost accounting (`provider_attempts` table, USD cost,
  token counts) is out of scope; this document uses learning credits
  only.
- Prometheus scrape endpoint, alert rule registration and Grafana
  dashboards are TARGET (`docs/runbooks.md` §Open decisions).
- The canonical `PROVIDER_TIMEOUT` status and the
  `OPERATION_UNKNOWN` / `INVALID_AI_OUTPUT` mapping remain open
  (`docs/reliability.md` §2.2, §9).
- No `.env` file, secret, API key or resolved configuration value was
  read, written or recorded while producing this document.
