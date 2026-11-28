# Data retention and deletion policy (DB-25 / SEC-11)

Status: **documented policy, not fully implemented**. This file records the intended retention rules for profile PII, learner-authored text, audio, transcripts, logs and caches, and the gap between those rules and the code in this repository as of 2026-11-28. It does not change schema, migrations, configuration or runtime behaviour. Every "must" below is a target for a follow-up implementation slice, not a claim that the current code already complies.

Evidence was read from `apps/api/src/common/services/scheduled-delete.service.ts`, `apps/api/src/users/users.service.ts`, `apps/api/src/files/files.service.ts`, `apps/api/src/files/file-validation.ts`, `apps/api/src/files/storage.adapter.ts`, `apps/api/src/auth/services/session.service.ts`, `apps/api/src/ai-operations/ai-operations.service.ts`, `apps/web/src/app/api/listening/upload-user/route.ts`, `apps/web/src/lib/cms-storage.ts`, `apps/api/prisma/schema.prisma` and `docs/database-inventory.md`. No `.env` values or API keys were read.

## 1. Scope, roles and principles

Data classes in scope:

- **Profile PII** — `users` identity/contact fields (`email`, `first_name`, `last_name`, `phone`, `avatar_url`, `date_of_birth`, `fcm_token`, IP/last-login metadata) plus auth rows (`oauth_accounts`, `refresh_tokens`, `mfa_secrets`, `user_devices`, `password_history`, `security_questions`, `verification_tokens`, `login_attempts`, `login_history`).
- **Learner content / PII** — chat messages, writing submissions, speaking transcripts and optional `audio_url`, generated reading passages, quiz answers, SRS/progress rows, notifications, and user-uploaded listening lessons (transcript + audio object) held by the web CMS store.
- **Audio/files** — user audio sent for STT, avatar images, owner-scoped objects under the API upload directory, and lesson audio referenced by URLs.
- **Financial and operational records** — `token_transactions`, `user_token_balance`, `daily_credit_grants`, `ai_operations`, `audit_logs`, `outbox_events`.
- **Ephemeral state** — Redis user caches, rate-limit counters, MFA throttles, short-lived signed read URLs.

Principles:

1. Collect the minimum needed for the learning operation. Do not persist raw audio by default; `speaking_submissions.audio_url` is optional and must stay so (data minimisation; roadmap item 5.3).
2. Raw transcript/audio and free-form user text belong only in the owning content tables or owner-scoped object storage. They must never be written to audit logs, AI-operation records, queue payloads, metrics or ordinary application logs.
3. A user's content is retained while the account is active, so they can review progress. No independent age-based expiry of learning content is proposed here; deletion is event-driven (user request or final purge), not silent background retention.
4. Deleting an account must remove content and files, not just anonymise identity columns. Orphan files must be sweepable.
5. Financial records are retained for audit and dispute handling after profile deletion, in a de-identified form. The exact statutory window is a legal decision, not a code default (section 7).
6. Redis is a cache, never the authority for "data deleted"; deletion must be verifiable in Postgres/object storage.

## 2. Data inventory and concrete policy

Windows are policy targets, not implemented defaults. "Account purge" means the successful finalisation step at the end of the 30-day grace period.

| Data | Where it lives | Purpose | Retention target | Deletion trigger / owner |
| --- | --- | --- | --- | --- |
| `users` profile PII | `users` (Postgres) | Identity, preferences, learning settings | Until account purge; then anonymised in place (`deleted_<id>@deleted.local`, name `Deleted User`, no phone/avatar/password/FCM token, `is_deleted=true`, status `PERMANENTLY_DELETED`) | Final purge job; no hard DELETE of root row today |
| Auth secrets and devices | `oauth_accounts`, `refresh_tokens`, `mfa_secrets`, `password_history`, `verification_tokens`, `user_devices`, `login_attempts`, `security_questions` | Login, recovery, session/device trust | Until purge; refresh/verification rows also expire per their own `expires_at` and are revoked at deletion request | `SessionService.deleteAccount()` revokes sessions at request; final purge deletes rows |
| Chat conversations/messages | `chat_conversations`, `chat_messages` | Learning history, context for AI chat | Until user deletes the conversation or account purge | DB cascade on conversation delete; `purgeUserData()` deletes conversations |
| Writing text, AI feedback | `writing_submissions` | Writing practice history | Until account purge | `purgeUserData()` |
| Speaking transcript + feedback + optional `audio_url` | `speaking_submissions` | Speaking practice history | Until account purge; do not attach new audio files by default | `purgeUserData()` removes row; **object referenced by `audio_url` needs separate object cleanup** |
| Generated reading passages, quiz answers | `reading_passages`, `quizzes`, `quiz_questions`, `quiz_attempts` | Learning history and analytics | Until account purge | `purgeUserData()` / FK cascade |
| SRS and progress rows | `user_card_progress`, `srs_review_events`, `review_sessions`, `learning_completions`, `user_streaks`, `user_badges`, `skill_proficiency`, `placement_attempts` | Spaced repetition scheduling and progress | Until account purge | `purgeUserData()` covers Prisma models; **raw-SQL `skill_proficiency` / `placement_attempts` are not in it and need an explicit raw-SQL purge** |
| Notifications | `notifications` | In-app inbox | Until user clears them or account purge; no time-based policy today | `purgeUserData()` |
| Avatar image | Local file under `uploads/`, URL in `users.avatar_url` | Profile picture | Until purge or replacement | `purgeUserData()` unlinks it after path validation |
| User listening lesson | `cms-data/lessons.json` (`isUserUploaded=true`, `userId`, transcript, `audioUrl`) + API-owned audio object | Listening practice generated from user audio/YouTube transcript | Until account purge | **No owner-scoped deletion helper exists today**; needs server-only `deleteUserLessons(userId)` returning audio URLs for object cleanup |
| Uploaded audio/images | `uploads/<userId>/<uuid>.<ext>` via `StorageAdapter` / `LocalStorageAdapter`; object metadata is tracked defensively via `fileObjectsDelegate` | Private user files used in learning flows | Until user deletes object or account purge; then orphan sweep | `FilesService.deleteFile()` is owner-scoped; **no bulk owner-prefix or orphan sweep exists today** |
| Token balance/ledger | `user_token_balance`, `token_transactions`, `daily_credit_grants` | Purchases, bonus grants, consumption, dispute audit | **Financial audit retention after purge; exact duration pending legal review.** Balance row may be cleared at purge, but the ledger must not be silently erased | Policy decision via `ConfigService`; never a hardcoded "delete all tokens on request" |
| AI operation records | `ai_operations` | Idempotency, charging reconciliation, failure diagnosis | Terminal rows: financial/operational audit retention pending legal review; only hashes/IDs/status, no raw payload | Current `purgeUserData()` deletes them; policy must define audit-safe handling instead of silent loss |
| Security/audit events | `audit_logs`, `login_history`, `login_attempts`, `outbox_events` | Security investigation, delivery/retry state | Fixed bounded window after legal review (proposal: 90 days for security events; 30 days for terminal outbox rows); store only IDs, action, outcome, timestamp, coarse IP/UA where lawful | Rolling cleanup job **not implemented**; `audit_logs` deletion on purge must be reconciled with audit retention |
| Redis keys | `cache:user:*`, rate limits, MFA throttle, recommendation/learning caches, token caches | Short-lived authorisation/performance state | TTL-driven (JWT user cache is 60s); never authoritative | `SessionService.invalidateUserCache()` best-effort on delete/cancel; full deletion does not depend on Redis |
| Provider-side copies | STT/LLM providers (audio bytes, transcript text in prompt) | One-off transcription and lesson/feedback generation | **Not yet verified** — see section 5 | Provider contracts/DPAs and retention settings must be confirmed before production |

## 3. Deletion lifecycle (intended)

1. **Request** — authenticated `DELETE /users` → `SessionService.deleteAccount()`: revoke all sessions, blacklist the presented token, set `users.delete_status=DELETE_REQUESTED` and `delete_requested_at=now()`, invalidate Redis user keys, write an audit event with user ID/action/IP only. The account is disabled immediately; no new content should be created.
2. **Grace period** — 30 days (`DELETE_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000`). During this window `POST /users/cancel-delete` restores `ACTIVE`, clears `delete_requested_at`, reactivates the account and invalidates caches. No content is destroyed during the grace period.
3. **Final purge** — daily cron at 02:00 (`ScheduledDeleteService.permanentlyDeleteExpiredAccounts()`) selects users with `delete_requested_at < now() - 30d`. The intended single purge action must, in one bounded job:
   - anonymise the `users` row as today;
   - delete every owned content/auth row via `UsersService.purgeUserData()`;
   - delete owned object keys under the validated owner prefix (avatar, uploaded audio/images) and web-owned listening lesson audio URLs;
   - remove raw-SQL owned rows (`skill_proficiency`, `placement_attempts`, `content_submissions` where author is the user, `outbox_events` where retention allows);
   - preserve or de-identify financial/audit records per section 2, never copy content into them;
   - emit an audit event with only user ID, action and timestamp (no transcript, text, audio URL or file contents).
4. **Retry semantics** — per-user failure isolation: a failure for one user must not abort the batch. A failed purge leaves `DELETE_REQUESTED` unchanged so the next cron retries. Deletion must be idempotent: re-running on an already-purged user is a no-op for missing rows/files.
5. **Observability** — log counts (candidates, succeeded, failed, files removed) and error class, never payloads. A storage cleanup audit record must be separate from content audit records.

### Current implementation gaps (must be fixed before claiming compliance)

- `ScheduledDeleteService` does **not** call `UsersService.purgeUserData()`. It only deletes selected auth rows and anonymises `users`; chat, writing, speaking transcript, reading passages, quiz answers, SRS/progress rows, notifications, token rows and audio URLs survive attached to the anonymised row.
- `UsersService.purgeUserData()` deletes Prisma-owned rows and the avatar file, but omits raw-SQL tables and all uploaded audio objects; it also deletes `audit_logs`, `token_transactions`, `ai_operations` and `daily_credit_grants` without the financial/audit carve-out described here.
- `cms-data/lessons.json` user lessons and their transcripts/audio URLs are written by `apps/web/src/app/api/listening/upload-user/route.ts` via `createLesson()`; `apps/web/src/lib/cms-storage.ts` has no owner-scoped deletion function. There is no unauthenticated delete endpoint today and none should be added; deletion must be server-internal.
- `StorageAdapter.delete()` / `FilesService.deleteFile()` are single-key, owner-checked operations; there is no `deleteMany`, `deleteUserPrefix`, `listUserKeys` or orphan sweep.
- No rolling retention job exists for audit/security logs, terminal `ai_operations`, `outbox_events` or stale object metadata.
- `purgeUserData()` validates the avatar path against `uploads/`, but a generic bulk file delete must reuse the same owner-key validation (`assertKey` / `assertOwner`) to prevent path traversal or cross-user deletion.

## 4. Audio and transcript handling

- **Purposes** — (a) speaking practice: audio bytes are decoded, signature-checked and sent to STT to produce a transcript; the transcript is sent to the LLM for feedback and stored in `speaking_submissions` for review. (b) listening upload: user audio or a transcript is sent to STT (when audio) and to the LLM to generate a lesson; the transcript is stored in `cms-data/lessons.json`, and the audio is uploaded through the authenticated API and stored under an owner-scoped key.
- **Minimisation** — no raw audio is stored by the speaking REST/WS path; `speaking_submissions.audio_url` remains optional. Listening uploads intentionally store the user's audio because it is the lesson source; this must be disclosed to the user at upload time. Never infer that anonymising `users` removes that audio.
- **Logs** — the speaking gateway logs session IDs and transcript prefixes for local debugging, and the web route logs provider errors. These must be bounded and must not become a durable transcript store; production logging must not include raw audio, full transcripts or signed URLs. `ai_operations` stores only `request_hash` (SHA-256 of a canonical validated payload) plus IDs/status/error codes — never the payload itself.
- **Deletion** — deleting a conversation/submission removes its text/transcript row; deleting the account must additionally remove the audio object and the web-owned lesson record. A failed object delete must be retried, not treated as success merely because the DB row is gone.
- **Public access caveat** — `app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' })` still serves upload URLs publicly. Until private read routes are mounted, treat any stored audio as exposed to anyone with the URL; do not store sensitive recordings there and do not rely on URL obscurity.

## 5. Processors, providers and third parties

| Processor | Data sent | Purpose | Retention status |
| --- | --- | --- | --- |
| Groq Whisper STT (API `speaking.service.ts`, `speaking.gateway.ts`, web listening route) | Decoded audio bytes for the current request, bounded by the shared decoded-byte budget | Produce transcript for the current operation | **Not yet verified**: provider-side retention, abuse monitoring and deletion rights must be confirmed from the current contract/DPA and settings before production. |
| Groq LLM / AI service (NestJS → FastAPI → model provider) | Validated transcript/user text in the prompt, bounded context and max tokens | Feedback, explanations, lesson generation | **Not yet verified**: provider retention and whether prompts are used for training must be confirmed; prefer no-training/zero-retention terms where available. |
| Google Translate TTS (`FilesService.generateTTS`) | Short text string | Pronunciation audio | **Not yet verified**; do not send user-authored content without review. |
| YouTube oEmbed | Public video URL | Lesson title lookup | URL only; verify provider terms before adding user-private inputs. |
| Redis (self-hosted) | Cached user flags, rates, throttles | Authorisation/performance | TTL-based; never authoritative for deletion. |

No raw audio, transcript or learner text is written to `ai_operations`, `outbox_events` (IDs only by design), `audit_logs` or `login_history` by the current code paths reviewed. Do not introduce such fields. Provider-side deletion requests and retention settings remain an open legal/ops task; do not assert compliance until documented evidence exists.

## 6. User rights and endpoints

| Right | Current surface | Required behaviour |
| --- | --- | --- |
| Access/export | Authenticated `GET /users/export` returns a JSON export of profile, learning history, tokens and operations | Export must include all user-owned content (including raw-SQL and user listening lessons) and must never include password hashes/MFA secrets/verification tokens or other users' data. Current export omits some raw-SQL tables. |
| Erasure / deletion request | Authenticated `DELETE /users` | Starts the 30-day grace period; sessions revoked immediately; documented in-product before confirmation. Final purge must follow section 3. |
| Cancel deletion | Authenticated `POST /users/cancel-delete` | Only while status is `DELETE_REQUESTED`; restores account and clears the request timestamp. No content was destroyed, so cancellation is lossless. |
| Object deletion | Authenticated `DELETE /files/:key` (owner-scoped) | Only the owner's ready/deleting object may be deleted; metadata transitions `READY → DELETING → DELETED`. Bulk deletion from the purge path must use the same key validation. |
| Conversation deletion | Owner-scoped chat routes | Removes messages by cascade. |
| Complaint / provider erasure | Operations/legal contact | Upon verified request, locate content by owner ID and run the same owner-scoped deletion; record only an audit ID/action/timestamp. |

No unauthenticated deletion route may be exposed for web-owned lessons or files. The web route that creates listening lessons already authenticates the caller; any owner-scoped cleanup helper must remain server-only.

## 7. Legal review and open decisions

The following are policy inputs that engineering must not guess. Record the decision, owner and effective date here before enabling a production purge job:

1. Statutory retention for `token_transactions`, `daily_credit_grants`, purchases/refunds and tax records; define which fields may be de-identified versus kept with a pseudonymous user ID.
2. Retention for `audit_logs`, `login_history` and `login_attempts` (proposal: 90 days for security events), and whether IP/UA storage is lawful under the applicable privacy regime.
3. Retention for terminal `ai_operations`, failed `outbox_events` and short-lived signed URLs (proposal: 30 days for dead/terminal job rows), with ID/hash-only payloads.
4. Whether user listening lessons (transcript + audio) must be erased on purge even when they were shared/published, and how to handle references in analytics.
5. Provider DPAs: Groq and other model/STT/TTS vendors — retention period, no-training terms, deletion request mechanism; update section 5 from **not yet verified** to verified with dates.
6. Backup retention: this document covers primary Postgres/object storage only. Backups and log archives are out of scope until an owner documents their expiry and restore/erasure procedure.
7. Minor consent: roadmap item 5.3 requires a legal review before collecting audio from minors. Until then, do not onboard under-18 users for audio features.

## 8. Verification checklist for the implementing slice

- [ ] Final purge calls the full owner purge (DB + raw SQL + files + web lessons) and anonymises `users` in the same bounded job.
- [ ] A user with chat/writing/speaking/reading/quiz/SRS rows and an uploaded audio file has zero owned rows/objects after purge; re-running is a no-op.
- [ ] A failed object/DB step leaves the user in `DELETE_REQUESTED` and is retried next cron; other users in the batch are unaffected.
- [ ] `cms-data/lessons.json` contains no `isUserUploaded=true` lesson for the purged user, and its audio object is removed.
- [ ] No transcript, free text, audio bytes, audio URL, token or password appears in audit records, logs, `ai_operations` or `outbox_events`; audit events carry user ID/action/timestamp only.
- [ ] Financial/audit rows that policy says to keep are pseudonymised, not silently deleted or joined back to live profile PII.
- [ ] Redis keys expire by TTL and a Redis outage does not block or falsify deletion.
- [ ] Provider retention status in section 5 is updated from verified contracts before production launch.
