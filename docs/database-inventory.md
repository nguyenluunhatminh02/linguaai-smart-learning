# Database inventory (DB-01)

Scope: schema and query-shape inventory for the NestJS API in `apps/api`. This document records what exists; it does not change schema, migrations, or runtime behaviour. Evidence is taken from `apps/api/prisma/schema.prisma`, the migration SQL under `apps/api/prisma/migrations/`, the generated client in `apps/api/src/generated/prisma/`, and non-test service/repository code under `apps/api/src/`.

Cardinality notation is logical (per parent row) unless noted: `1:1`, `1:N`, `N:M`. No production row counts or `EXPLAIN` results were available, so index observations are query-shape observations only.

## 1. Sources of truth and drift

| Source | Tables/models | Notes |
| --- | --- | --- |
| `schema.prisma` | 36 models | Prisma models: `login_history`, `notifications`, `refresh_tokens`, `roles`, `security_questions`, `user_roles`, `users`, `password_history`, `oauth_accounts`, `verification_tokens`, `mfa_secrets`, `user_devices`, `login_attempts`, `audit_logs`, `decks`, `cards`, `learning_completions`, `srs_review_events`, `user_card_progress`, `review_sessions`, `writing_submissions`, `speaking_submissions`, `reading_passages`, `chat_conversations`, `chat_messages`, `quizzes`, `quiz_questions`, `quiz_attempts`, `user_streaks`, `badges`, `user_badges`, `content_items`, `user_token_balance`, `token_transactions`, `ai_operations`, `daily_credit_grants`. |
| Migrations | 39 created tables | Baseline adds 30 tables including `device_fingerprints`; later migrations add 11 tables. `device_fingerprints` is dropped by `20250106000000_merge_device_fingerprints_to_user_devices`, leaving 39. |
| Raw-SQL-only tables | 4 | `skill_proficiency`, `placement_attempts`, `content_submissions` (migrations `20261128003000_skill_proficiency` / `20261128004000_content_workflow`, deliberately absent from `schema.prisma`) and `outbox_events` (referenced by `apps/api/src/queue/outbox.repository.ts`, with no `CREATE TABLE` anywhere in the repository). |
| Generated Prisma client | 36 delegates | Stale for the BILL-03/BILL-05 slices: comments in `apps/api/src/ai-operations/ai-operations.repository.ts` and `apps/api/src/tokens/tokens.service.ts` say the client predates those models, but `index.d.ts` currently exposes both `ai_operations` and `daily_credit_grants` delegates. Code still uses optional/narrow delegate access for `daily_credit_grants` (`users.service.ts`, `tokens.service.ts`). Regenerate once and align the comments or code in a separate slice. |

Migration timeline relevant to inventory:

| Migration | Effect |
| --- | --- |
| `20250101000000_baseline_init` | Creates `uuid-ossp`, 6 enum types, 30 tables, baseline indexes and FKs. |
| `20250102000000_add_token_tables` | Creates `user_token_balance`, `token_transactions` + `(user_id, created_at)` index. |
| `20250103000000_remove_ticket_booking_columns` | Drops `users.notification_order_enabled`, `users.notification_promotion_enabled`. |
| `20250104000000_clean_notification_type_enum` | Rewrites `notifications.type` with a temporary enum; final values `SYSTEM`, `SECURITY`, `ACCOUNT`. |
| `20250105000000_remove_mfa_columns_from_users` | Copies legacy MFA secrets into `mfa_secrets`, then drops `users.two_factor_secret` and `users.mfa_backup_codes`. |
| `20250106000000_merge_device_fingerprints_to_user_devices` | Adds `user_devices.fingerprint` + index, migrates data, drops `device_fingerprints`. |
| `20260606000000_add_token_idempotency` | Adds `token_transactions.idempotency_key` + unique and non-unique indexes. |
| `20261127000000_learning_journey` | Adds learning columns, `learning_completions`, `srs_review_events` and their indexes. |
| `20261127001000_learning_completion_duration` | Adds `learning_completions.duration_seconds` (no default in migration; schema has `@default(0)` — drift to reconcile in a schema slice). |
| `20261128000000_add_ai_operations` | Creates `ai_operations` + status enum, unique idempotency index, lease scan index, user index. |
| `20261128001000_add_daily_credit_grants` | Creates `daily_credit_grants` + grant-type enum, unique `(user_id, grant_type, day)` and `(user_id, day)` indexes. |
| `20261128003000_skill_proficiency` | Creates raw-SQL-only `skill_proficiency` and `placement_attempts` with composite indexes. |
| `20261128004000_content_workflow` | Creates raw-SQL-only `content_submissions` with status/queue/version/author/reviewer indexes. |

FK operators in the baseline migration use `ON UPDATE CASCADE` for most user-owned tables, while `schema.prisma` maps several to `onUpdate: NoAction` (e.g. `login_history`, `refresh_tokens`, `security_questions`). Record this drift; do not silently flip FK behaviour in this documentation slice.

## 2. Table inventory

PII key: **D** direct identifier (email, phone, name, IP, device ID, token, avatar URL), **Q** quasi-identifier (location, locale, timestamps, user-agent), **C** content authored by the user, **S** secret/security material, **—** none expected. Write paths name the owning module; read paths name the dominant query sites.

### 2.1 Identity, auth and audit

| Table | Cardinality | Write path | Read path | Indexes | Retention | PII | Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `users` | Root; 1 per account | `auth.service.ts` register/OAuth, `users.service.ts` settings, `password.service.ts`, `mfa.service.ts`, `session.service.ts`, `admin.service.ts` | Nearly every service by PK; admin list/count; scheduled delete scans `delete_status` + `delete_requested_at` | PK `id`; unique `email`; indexes on `email_verification_token`, `password_reset_token`. No index on `delete_status`/`delete_requested_at` or `is_deleted`. | 30-day grace (`DELETE_GRACE_PERIOD_MS` in `common/constants/auth.constants.ts`), then `scheduled-delete.service.ts` anonymizes in place; `purgeUserData()` removes owned rows. No hard DELETE of the root row. | D/Q/S | `auth` for credentials; `users` for profile/preferences; `admin` for moderation; `common/scheduled-delete` for lifecycle. |
| `roles` | 1 per role (ADMIN/USER/MODERATOR) | Seed/manual; no app write found | Join via `user_roles`; role guard lookups | PK; unique `name` | None defined; reference data | — | `auth` / authorization matrix. |
| `user_roles` | N:M users↔roles | `users.service.ts` export only reads; role assignment not found in app code | Role checks via `users` relation | Composite PK `(users_id, roles_id)`; indexes on both FKs | Removed by `purgeUserData()`; not touched by scheduler | — (role membership is Q) | `auth`. |
| `login_history` | N per user; append-only audit | `common/services/audit-log.service.ts` | `users.service.ts` export/purge; admin/user audit views | PK; FK `user_id` has no explicit index in baseline | Deleted by scheduler after grace and by `purgeUserData()`; no time-based rolling window | D/Q | `auth` / audit logging. |
| `audit_logs` | N per user/event; append-only | `admin.controller.ts`, `content-workflow.controller.ts`, `common/audit-log.service.ts` | Admin/audit queries | PK; `user_id`, `action` | Same as `login_history`; no age-based pruning | D/Q/C (free-text `details` may contain identifiers) | `common` audit; controllers emit. |
| `login_attempts` | N per email/IP/user | `login-attempt.service.ts` create on attempts | Same service for lockout counts/history; export/purge | PK; `email`, `ip_address`; no index on `attempted_at` or `(email, attempted_at)` | Scheduler + `purgeUserData()`; no rolling deletion | D/Q | `auth`. |
| `refresh_tokens` | N per active session/device | `refresh-token.service.ts`, `session.service.ts` | Token lookup by unique `token`, rotation/revocation scans | PK; unique `token`; no index on `user_id` or `expires_at` | Expiry is evaluated in app code; rows deleted on logout/revoke, scheduler and purge. No scheduled expired-row cleanup found. | S/D | `auth` session management. |
| `verification_tokens` | N per user/purpose | `auth.service.ts` | Verification service by `token_hash` | PK; unique `token_hash`; `user_id`; no `expires_at` index | `used`/`expires_at` checked in app; deleted by scheduler and purge; no expired-row cleanup job | S/D | `auth`. |
| `mfa_secrets` | 1 per user | `mfa.service.ts` upsert/update/delete; baseline migration backfills legacy columns | `mfa.service.ts` by `user_id` | PK; unique `user_id` | Deleted on MFA disable, scheduler and purge | S | `auth` MFA. |
| `password_history` | N per user, capped (default 5) | `password-history.service.ts` create + `cleanupOldPasswords()` | Same service, `created_at DESC` with `take` | PK; `user_id`. Pruning query needs `(user_id, created_at DESC)` for ordering at scale. | Row-count based: keep newest `PASSWORD_HISTORY_LIMIT` (default 5, min 1); also deleted at grace expiry and purge | S | `auth` password policy. |
| `oauth_accounts` | N per user/provider | `auth.service.ts`, `oauth2.controller.ts` delete | `auth.service.ts` lookup by `(provider, provider_user_id)` | PK; unique `(provider, provider_user_id)`; `user_id` | Deleted on unlink, scheduler and purge | S/D | `auth` OAuth. |
| `security_questions` | N per user | `users.service.ts` / `security-question.service.ts` | `users.service.ts` settings/export/purge | PK; FK `user_id` is not separately indexed in baseline | Scheduler + purge | C | `users` / security questions. |
| `user_devices` | N per user, `max_devices` default 3 | `device.service.ts`, `token.service.ts`, `users.service.ts` | By unique `device_id`, by `user_id` for lists and oldest-active eviction | PK; unique `device_id`; `user_id`; `fingerprint` (from later migration) | No TTL; eviction when count exceeds `max_devices`; scheduler + purge. `device_fingerprints` data merged here in `20250106000000`. | D/Q | `auth` device trust. |
| `notifications` | N per user | `notifications.service.ts`, cron | Inbox `findMany`/`count` by user, `is_read` and `created_at` | PK; `created_at`, `is_read`, `user_id` | No retention policy; only deleted explicitly by user or purge. Scheduler does not delete notifications. | C/D (message payload) | `notifications`. |

### 2.2 Learning, SRS and gamification

| Table | Cardinality | Write path | Read path | Indexes | Retention | PII | Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `decks` | 1 per creator + public catalog; N cards each | `decks.service.ts` create/update/delete; `learning.service.ts` upsert phrase collection | By PK, creator, `is_public`, `(creator_id, learning_collection)` | PK; `creator_id`; unique `(creator_id, learning_collection)` | Cascade delete removes cards; purge deletes creator decks. No retention for stale public decks. | C/Q | `decks` / learning. |
| `cards` | N per deck; seed/phrase keys unique within deck | `learning.service.ts` create saved phrase; `cards.service.ts` retires via `retired_at` | `cards.service.ts`, `srs.service.ts`, `decks.service.ts` filters `retired_at: null` | PK; `deck_id`; unique `(deck_id, seed_key)`, `(deck_id, learning_phrase_key)`; no index on `retired_at` | Soft retirement (`retired_at`) when studied; no hard deletion or age-based cleanup found | C | `cards` / learning. |
| `user_card_progress` | 1 per `(user, card)` | `srs.service.ts` reviewCard upserts ease/interval/repetition and event | Due-card query filters `(user_id, next_review_date <= now)` joined to cards/decks; analytics counts due/mastered/today | PK; unique `(user_id, card_id)`; `user_id`, `card_id`, `next_review_date`. Candidate (unproven): composite `(user_id, next_review_date)` for the due-card path. | No TTL; deleted on purge or cascade. Retired cards keep progress rows. | Q (learning history) | `srs`. |
| `srs_review_events` | N per review; append-only | `srs.service.ts` inside review transaction (idempotent by client key) | Replay lookup by id; counts in deck delete and export | PK; `user_id`, `card_id`. `id` has no DB default — generated by app. | No TTL; purge/cascade only | Q/C (JSON result) | `srs`. |
| `review_sessions` | N per user/deck session | `srs.service.ts` create/update `finished_at` | `analytics.service.ts` UNION ALL of finished sessions; history lists; admin stats | PK; `user_id`, `deck_id`, `started_at`; no index on `finished_at` | No TTL; purge/cascade only | Q | `srs` / analytics. |
| `learning_completions` | 1 per `(user, activity_type, activity_id)` | `learning.service.ts` upsert; optional raw `attempt_number` update guarded by information_schema check | `learning.service.ts` list; analytics UNION ALL; export/purge | PK; unique `(user_id, activity_type, activity_id)`; `(user_id, language, completed_at)` | No TTL; purge/cascade. Schema default 0 for `duration_seconds` vs migration without default — reconcile separately. | Q | `learning` / analytics. |
| `user_streaks` | 1 per `(user, date)` | `learning.service.ts` / gamification paths | `analytics.service.ts` 7-day lookup; export/purge | PK; unique `(user_id, date)`; `user_id` | No TTL; purge/cascade | Q | `learning`. |
| `badges` | 1 per badge definition | Manual/seed; no app write found | Joined through `user_badges` | PK | Reference data | — | `learning`. |
| `user_badges` | N:M users↔badges | Gamification award paths | Profile/export/purge | Composite PK `(user_id, badge_id)`; `user_id` | Purge/cascade | — | `learning`. |
| `skill_proficiency` (raw SQL) | 1 per `(user, language, skill)` | `proficiency.service.ts` `INSERT ... ON CONFLICT` under advisory lock | `proficiency.service.ts` `SELECT ... FROM skill_proficiency` by user/language | PK `(user_id, language, skill)`; `(user_id, language, updated_at)` | No TTL; FK cascade on user deletion; **not** in `purgeUserData()` and not in export | Q | `proficiency` (peer-owned, intentionally model-less). |
| `placement_attempts` (raw SQL) | N per user/language/skill | `proficiency.service.ts` insert in transaction with proficiency upsert | `proficiency.service.ts` history query | PK `id`; `(user_id, language, skill, created_at)` | No TTL; FK cascade; **not** in `purgeUserData()` and not in export | Q | `proficiency`. |

### 2.3 Content, writing, speaking, reading, chat, quiz

| Table | Cardinality | Write path | Read path | Indexes | Retention | PII | Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `content_items` | N published/draft items | `admin.service.ts` CRUD; content workflow changes status via submissions | Catalog by `type`, `published`, admin list/count | PK; `type`, `published`; no `(type, published, level)` composite | No TTL; admin delete hard-deletes; referenced submissions cascade | C (curated content, not personal) | `admin` / content. |
| `content_submissions` (raw SQL) | N versions per content item | `content-workflow.service.ts` raw insert with version = `MAX(version)+1`, raw review update | Raw queue by `status`/`created_at`, latest version by `(content_item_id, version)` | PK; `(status, created_at)`, `(content_item_id, version)`, `author_id`, `reviewer_id` | No TTL; FK cascade from content item/author; **not** in `purgeUserData()` and not in export | C/D (author/reviewer IDs) | `content-workflow`. |
| `writing_submissions` | N per user | `writing.service.ts` create with AI feedback JSON | History by user; export/purge | PK; `user_id`; no `created_at` index | No TTL; purge/cascade | C (essay text + feedback) | `writing`. |
| `speaking_submissions` | N per user | `speaking.gateway.ts` create transcript/feedback/scores/audio URL | `speaking.service.ts` list/count by user; export/purge | PK; `user_id`, `created_at` | No TTL; purge/cascade. Audio file storage is optional in DB; external objects not covered by DB purge. | C/D (transcript, `audio_url`) | `speaking`. |
| `reading_passages` | N generated per user | `reading.service.ts` create | History by `generated_by_user_id`; export/purge | PK; `generated_by_user_id` | No TTL; purge/cascade | C | `reading`. |
| `chat_conversations` | N per user; N messages each | `chat.service.ts` create/delete | `getConversations()` by `user_id` `created_at DESC LIMIT 50`; ownership check before reads | PK; `user_id`; no `(user_id, created_at)` composite | No TTL; explicit user delete cascades messages; purge deletes conversations | C/Q | `chat`. |
| `chat_messages` | N per conversation; append-only | `chat.service.ts` `persistTurn()` writes user + assistant rows in one transaction | `loadHistory()` / `getMessages()` by `conversation_id`, ordered `(created_at, id)` with bounded `take` | PK; `conversation_id`. Candidate (unproven): `(conversation_id, created_at, id)` for ordered bounded history. | Inherits conversation delete/cascade; no independent TTL | C (message content) | `chat`. |
| `quizzes` | N per creator, optional deck | `quiz.service.ts` create/delete | By PK, creator list/count, deck association | PK; `creator_id`; no `language`/`published` index | No TTL; purge/cascade; deck delete sets `deck_id` NULL | C | `quiz`. |
| `quiz_questions` | N per quiz | `quiz.service.ts` create with quiz | By `quiz_id` | PK; `quiz_id` | Cascade with quiz | C | `quiz`. |
| `quiz_attempts` | N per user/quiz | `quiz.service.ts` create with idempotency check | By `(user_id, quiz_id)`, history, analytics UNION ALL | PK; `user_id`, `quiz_id`; no `completed_at` index | No TTL; purge/cascade | Q/C (answers JSON) | `quiz`. |

### 2.4 Token economy, AI operations, outbox

| Table | Cardinality | Write path | Read path | Indexes | Retention | PII | Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `user_token_balance` | 1 per user (`user_id` is PK) | `tokens.service.ts` create/reserve/refund inside transactions | `findUnique(user_id)` in token operations, export, purge | PK `user_id`; no separate balance index needed | Deleted on purge/cascade. Invariant to verify in DB-01: `balance >= 0` — currently enforced in application transaction logic, not a DB CHECK. | — (financial state keyed by user) | `tokens` / billing. |
| `token_transactions` | N per user; append-only ledger | `tokens.service.ts` create with `idempotency_key` in transaction | By `(user_id, created_at)` for history, by `idempotency_key` for replay | PK; `(user_id, created_at)`; unique + non-unique on `idempotency_key` (the non-unique index duplicates the unique one) | No TTL; corrections use compensating entries, not row mutation (application policy; no DB trigger). Purge deletes rows. | Q (amount/type/feature/timestamp) | `tokens` / billing. |
| `ai_operations` | N per user/feature/client operation | `ai-operations.service.ts` / repository: reserve, claim with lease/version, mark terminal | Idempotency lookup by `(user_id, feature, client_operation_id)`, lease scan by `(status, lease_until)`, user list | PK; unique `(user_id, feature, client_operation_id)`; `(status, lease_until)`; `user_id`; no index on `(user_id, created_at)` for list ordering | No TTL found for terminal operations; purge deletes by user. `conversation_id`/`result_ref` are plain UUIDs with no FK by design. | Q/C (`request_hash`, `error_code`, `result_ref`) | `ai-operations` / billing. |
| `daily_credit_grants` | 1 per `(user, grant_type, UTC day)`, including `amount = 0` | `tokens.service.ts` grant paths via delegate (narrow fallback in code) | Lookup by `(user_id, grant_type, day)`; export/purge | PK; unique `(user_id, grant_type, day)`; `(user_id, day)` | No TTL; purge by user. Unique index is the once-per-day invariant. | Q | `tokens` / billing. |
| `outbox_events` (raw SQL, no DDL in repo) | N per AI operation job | `OutboxRepository.create()` inside reserve transaction | Claim `PENDING`/expired `CLAIMED` `ORDER BY created_at` with `FOR UPDATE SKIP LOCKED`; reconcile expired leases; lookup by `operation_id` | Unknown: no migration defines indexes. Claim path needs `(status, created_at)` and lease scan needs `(status, lease_until)`; reconcile/claim use `lease_until < now`. | `PUBLISHED`/`FAILED` rows accumulate: no cleanup query found in repository. `MAX_ATTEMPTS` default 5, not a retention limit. | Q/C (payload holds IDs only by design) | `queue` / reliability. Table DDL must be added by an owner in a separate slice. |

## 3. Cross-cutting observations

1. **Retention is narrow.** Only three concrete policies exist: 30-day account deletion grace (`scheduled-delete.service.ts`), per-user password-history count cap (`password-history.service.ts`), and card soft retirement (`cards.service.ts`). No age-based pruning exists for logs, chat, audio/transcript, audit, failed jobs, or terminal AI operations. Owners must decide policy; DB-01 does not invent it.
2. **`purgeUserData()` coverage is incomplete.** It deletes 31 Prisma-managed tables plus the stale-client `daily_credit_grants`, but omits `skill_proficiency`, `placement_attempts`, `content_submissions`, `outbox_events`, and `roles` (reference). The external avatar file is unlinked. Export similarly omits `skill_proficiency`, `placement_attempts`, `content_submissions`, `outbox_events`, password history, MFA secrets and verification tokens.
3. **Scheduler coverage differs from purge.** `scheduled-delete.service.ts` anonymizes auth tables but leaves learning, token, chat and notification rows attached to the anonymized `users` row; `purgeUserData()` is the broader path and must be called by whoever finalizes deletion.
4. **Index candidates are unproven.** `(user_id, next_review_date)` on `user_card_progress`, `(conversation_id, created_at, id)` on `chat_messages`, and `(user_id, created_at)` on `chat_conversations` / `ai_operations` match observed `WHERE` + `ORDER BY` shapes but have no `EXPLAIN (ANALYZE, BUFFERS)` evidence. DB-04 should benchmark before any migration is added.
5. **Invariants not expressed in DDL.** `user_token_balance.balance >= 0` and ledger immutability are application-only. Enum-like columns on raw-SQL tables (`content_submissions.status`, `outbox_events.status`) are plain `VARCHAR` with application-owned vocabularies. SQL CHECK constraints are intentionally absent per migration comments.
6. **Schema/migration/client drift needs an owner.** `learning_completions.duration_seconds` default mismatch, `onUpdate` FK differences, the four model-less tables, and generated client comments vs actual delegates should be reconciled in dedicated schema/client slices, not in DB-01.

## 4. Open decisions for other owners

- Retention windows for chat messages, speaking transcripts/audio, audit and login logs, failed outbox rows, and terminal AI operations (chat, speaking, security, queue, billing owners).
- Whether `purgeUserData()` and the privacy export must include the four raw-SQL tables; if yes, which module owns the raw SQL and how the export schema represents it (users/privacy owner).
- Where `outbox_events` DDL lives and who owns its indexes/cleanup (queue/reliability owner).
- Whether to regenerate the Prisma client once and remove narrow-delegate fallbacks, or keep them deliberately (billing/API owner).
- Benchmark results needed before adding composite indexes (DB-04).
