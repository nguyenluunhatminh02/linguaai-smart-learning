# Backup/restore policy and restore drill runbook (DB-05)

Status labels, consistent with `docs/reliability.md`:

- **CURRENT** — observed in the checked-in code/config on this branch.
- **TARGET** — policy or tooling required by `LinguaAI_Engineering_Roadmap.md` DB-05 (lines 650–658) and OPS-03 (line 934). TARGET is not a claim that the code exists.

This slice is documentation only. It creates the policy and the runbook; the CLI, workflow, env-var additions and drill evidence log named below are **TARGET** deliverables for other slices and must not be treated as already implemented.

## 1. Scope, objectives and limits

### 1.1 In scope

PostgreSQL **logical** backups of the application database, their encryption, retention, access control, off-host storage, and a repeatable restore drill into an isolated database. The source of truth for this scope is `apps/api/prisma/schema.prisma` plus the raw-SQL tables named in `docs/database-inventory.md`.

### 1.2 Explicitly out of scope

| Excluded data | Reason | Owner / reference |
|---|---|---|
| Redis cache, rate-limit counters and job transport | Derived state; losing it must not change money, operation terminal state or ownership facts | `docs/reliability.md` §1; roadmap REL-03 |
| Local upload bytes under `CWD/uploads` (avatar, audio, images) | Not a shared durable store; object metadata is not fully backed by a checked-in model/migration | roadmap REL-04; `docs/reliability.md` §4 |
| Application-level encryption keys (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`, provider keys) | Secrets delivered by the secret store, not backup material. A dump contains `mfa_secrets.secret_encrypted`, which stays encrypted with `MFA_ENCRYPTION_KEY` after restore. | `docs/provider-setup.md` |
| Deployment configuration and `.env` files | Restore of configuration is a separate deployment concern; this document never records real values | `docs/provider-setup.md` |

**Limitation statement:** a successful restore of the PostgreSQL dump alone does **not** reconstruct Redis state or local upload files. A full-service recovery must re-seed/rebuild derived state and must recover upload bytes under REL-04. Any drill claiming "full platform recovered" from this dump is invalid.

### 1.3 Proposed targets (to be confirmed by the service owner)

| Target | Value | Basis / acceptance |
|---|---|---|
| RPO | ≤ 24 h | One daily logical dump plus a mandatory pre-destructive-migration dump; measured as age of newest verified manifest at incident time |
| RTO | ≤ 2 h | Measured from incident declaration to `verify` pass on the isolated target, including fetch, decrypt and import; drill must record actual timings |
| Backup success rate | 100% of scheduled runs produce a verified manifest, or a `backup failed` alert fires | OPS-03 alert contract (§7) |
| Restore drill cadence | At least monthly, and before every destructive migration; weekly scheduled drill is TARGET via `.github/workflows/backup-drill.yml` | DB-05 sprint gate: "restore drill thành công" |
| Recovery point for a destructive migration | The pre-migration dump, retained for the full window even if normal pruning would remove it | Roadmap line 656 |

These are proposals, not measurements. Until the first drill is recorded, RTO/RPO are unproven.

## 2. Data inventory to protect and verify

The dump is a full logical dump (`pg_dump -Fc`), so all tables are included. The following are the tables with explicit recovery value and their drill checks; see `docs/database-inventory.md` for the full inventory and PII classification.

| Table | Why it is in the drill | Sensitivity / special handling |
|---|---|---|
| `users` | Identity root; FK parent for nearly every table | PII (email, name, phone, DOB); `password` hash, reset/verification tokens |
| `mfa_secrets` | MFA state; one row per user (`user_id` unique) | `secret_encrypted` and `backup_codes` remain encrypted with `MFA_ENCRYPTION_KEY`; do not decrypt in the drill and do not print those columns |
| `chat_conversations`, `chat_messages` | User learning history; cascade relationship must survive | Free-text content (PII/Q); verify no orphan messages |
| `user_card_progress` | SRS scheduling state; unique `(user_id, card_id)` | Learning history; verify uniqueness and non-negative counters |
| `srs_review_events` | Append-only review event log; `id` has no DB default and is app-generated | Verify IDs survive restore and events point at existing users/cards |
| `token_transactions` | Append-only credit ledger; corrections are compensating rows, never row mutation | Financial; verify `idempotency_key` uniqueness and absence of duplicate keys |
| `user_token_balance` | Server-authoritative balance | Financial; `balance >= 0` is application-only, not a DB CHECK — verify explicitly (§6.3) |
| `ai_operations` | Durable idempotency/lease state (`RESERVED → RUNNING → SUCCEEDED/FAILED/UNKNOWN/CANCELLED`) | Verify unique `(user_id, feature, client_operation_id)` and that `charged_credits <= reserved_credits` where status is terminal |
| `daily_credit_grants` | Once-per-UTC-day grant marker; rows with `amount = 0` are meaningful | Verify unique `(user_id, grant_type, day)` |
| `audit_logs` | Append-only security audit trail | Free-text `details` may contain identifiers; verify count and that restore did not drop rows |
| `outbox_events` | Durable queue rows created by raw SQL | No DDL/migration in the repo (`docs/database-inventory.md`); verify only if the table exists in the source |

## 3. Backup policy

### 3.1 Schedule (TARGET)

| Job | Timing | Trigger / note |
|---|---|---|
| Daily full logical dump | Cron `BACKUP_SCHEDULE_CRON`; default proposal `17 2 * * *` UTC | Off-peak; one successful verified object per day |
| Pre-destructive-migration dump | Immediately before any migration that drops/renames a column, truncates a table or backfills destructively | Mandatory gate; tag manifest `reason=pre-migration`, include release/commit SHA |
| Post-migration sanity dump | After `prisma migrate deploy` and before the app is switched to the new schema | Optional but recommended for a fast rollback point |
| Retention sweep | Daily, after the backup job | Must support `--dry-run` before applying deletion |

Do not let each replica run migrations or backups independently: roadmap DB-05 requires one migration job per release.

### 3.2 Backup procedure

CURRENT: the compose service is named `postgres` (image `postgres:16-alpine`, container `linguaai-postgres`) in `docker/docker-compose.yml`; the repo's prod migration command is `prisma migrate deploy` (`apps/api/package.json` `db:migrate:prod`).

TARGET: use the backup CLI (planned as `scripts/backup-cli.mjs`, zero new dependencies, Node 22 `node:crypto` + `child_process` + AWS CLI) rather than ad-hoc shell:

```sh
BACKUP_S3_BUCKET=<bucket-name> \
BACKUP_S3_REGION=<region> \
BACKUP_KEY_PUBLIC_KEY_PEM_PATH=<path-to-public-pem> \
node scripts/backup-cli.mjs backup --reason scheduled
```

For a destructive migration:

```sh
node scripts/backup-cli.mjs backup --reason pre-migration --release <commit-sha>
# Only after the manifest is verified:
pnpm --filter api db:migrate:prod
```

The underlying dump command is a custom-format, role-portable dump:

```sh
docker compose -f docker/docker-compose.yml exec -T postgres \
  pg_dump -Fc --no-owner --no-privileges "$POSTGRES_DB"
```

Rationale: `-Fc` preserves all objects and restores with `pg_restore`; `--no-owner --no-privileges` prevents source roles/ACLs from leaking into the isolated restore target. Never pass passwords on a command line and never read or print `.env` values when running these jobs — supply credentials from the secret store/role environment. Do not hand-roll envelope encryption with `openssl enc`: it does not provide AES-256-GCM; use the CLI implementation.

### 3.3 Object, bucket and KMS settings (TARGET)

- Destination: `s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/yyyy/mm/dd/<manifest-id>/` with SSE-KMS (`aws s3api put-object --server-side-encryption aws:kms --ssekms-key-id <backup-KMS-key-arn>`).
- Bucket: versioning enabled, Object Lock enabled, default retention in **governance** mode at least until the 14-day daily window ends; compliance mode if the owner requires deletion-proof retention. A retention policy that deletes an object must still leave it recoverable within Object Lock.
- Store two objects per backup: `<manifest-id>.dumps` (ciphertext) and `<manifest-id>.manifest.json` (plaintext metadata only).
- 3-2-1: three copies (primary bucket, versioned historical copies, off-host replicated copy), two media (primary object storage and a separate off-host/account replica), one off-host. The off-host copy must not depend on the application host or its credentials.
- `BACKUP_OBJECT_LOCK_MODE` records the chosen mode; it is a configuration name, not a secret.

## 4. Encryption and manifest contract (TARGET)

Envelope encryption, so the private key never has to sit on the DB host:

1. Generate a fresh 32-byte data key with `crypto.randomBytes(32)` for every backup.
2. Encrypt the `pg_dump` stream with AES-256-GCM (12-byte IV, auth tag verified on read).
3. Wrap the data key with RSA-OAEP using the backup **public** key referenced by `BACKUP_KEY_PUBLIC_KEY_PEM_PATH`. The public key is not a secret; the private key is held only in the secret store at `BACKUP_KEY_PRIVATE_KEY_PATH` and is never placed on the backup host or in CI logs.
4. SHA-256 the ciphertext and record its size and digest in the manifest. Fetch must verify the manifest digest **and** the GCM tag before any plaintext is written.
5. Write the manifest only after the ciphertext upload succeeds; treat a manifest without a matching object (or vice versa) as a failed backup and alert.

Manifest schema (v1) — placeholders only, no real values:

```json
{
  "schemaVersion": 1,
  "manifestId": "<uuid>",
  "createdAt": "<UTC ISO-8601>",
  "database": {
    "name": "<database-name>",
    "serverVersion": "<PostgreSQL version from pg_dump/pg_stat_version()>",
    "reason": "scheduled | pre-migration | post-migration | drill",
    "release": "<optional commit sha>"
  },
  "key": {
    "keyId": "<backup wrap-key id / fingerprint>",
    "algorithm": "RSA-OAEP",
    "wrappedDataKey": "<base64>",
    "dataKeyAlgorithm": "AES-256-GCM",
    "iv": "<base64, 12 bytes>",
    "tag": "<base64, 16 bytes>"
  },
  "ciphertext": {
    "object": "<bucket/prefix/manifest-id.dumps>",
    "sizeBytes": <integer>,
    "sha256": "<hex>"
  },
  "storage": { "sse": "aws:kms", "objectLockUntil": "<optional ISO-8601>" }
}
```

Manifest validation on read: required fields present, `schemaVersion` supported, `sizeBytes`/`sha256` match the fetched object, IV and tag lengths valid. The digest is over **ciphertext**, not plaintext. Reject on any mismatch; do not fall back to an older object without an explicit operator decision recorded in the drill log.

Key rotation (TARGET; see also `docs/provider-setup.md`): publish a new public key with a new `keyId`, use it for new backups, rewrap old data keys only if policy requires, and retain the old private key in the secret store for at least the full retention window (6 monthly backups) plus margin. Never delete the old private key to "clean up" while any manifest still references its `keyId`.

## 5. Retention and access control

### 5.1 Retention (TARGET)

| Class | Count | Selection rule |
|---|---|---|
| Daily | 14 | Newest verified manifest per UTC day |
| Weekly | 8 | Newest per ISO week, kept beyond daily window |
| Monthly | 6 | Newest per UTC month, kept beyond weekly window |
| Pre-migration | Keep all within daily/weekly/monthly rules and never prune the last pre-migration dump before a destructive migration has been verified on a restored DB | `reason=pre-migration` |

Pruning uses the manifest's `createdAt` date, not object `LastModified` (versioning/replication can change the latter). `node scripts/backup-cli.mjs retention --dry-run` prints the keep/delete set and must be run before the real sweep. Object Lock and versioning can make "delete" create a delete marker or be denied; the sweep must record the outcome and alert on denial rather than silently assuming the object is gone. Never prune a manifest that has no verified counterpart in the off-host copy.

### 5.2 Least-privilege access matrix (TARGET)

| Principal | Object storage | KMS | Wrap key | Approval / audit |
|---|---|---|---|---|
| Backup job role (`backup-writer`) | `s3:PutObject` to backup prefix only; no `GetObject`, no `DeleteObject` | `GenerateDataKey`/`Encrypt` on the backup KMS key only | Public key only (read path) | Scheduled job identity; log manifest id + size only |
| Restore operator | `s3:GetObject`, `ListBucket` on backup prefix; no delete/overwrite | `Decrypt` on backup KMS key | Private key path from secret store, fetched at restore time only | Requires incident/change ticket and second-person approval recorded in drill log; no production target names |
| Retention job role | `ListBucket`, limited `DeleteObject`/`DeleteObjectVersion` on backup prefix | None | None | Runs only with `--dry-run` output attached to the ticket |
| Application runtime role | None | None | None | App must have no path to backups |
| Security/key owner | No object access needed | KMS admin, scoped | Holds/rotates private key | Rotation and any key use audited |

`AWS_ROLE_ARN` names the assumed role; it is an identifier, not a secret. Production credentials must never be copied into `apps/api`, the AI service, or the browser. Restore operators use a dedicated role, not the backup writer role.

## 6. Restore drill runbook

### 6.1 Preconditions (fail closed)

1. An approved ticket names the manifest id and the isolated target DB.
2. `RESTORE_TARGET_DB` is set to the isolated database name and `CONFIRM_RESTORE` is explicitly set; the CLI must refuse if either is missing.
3. The target name must not match production names (`production`, `prod`, `live`, `primary`, `main`, `linguaai`, the production `POSTGRES_DB` name) and must not be the host the manifest came from.
4. The private key is provided by the secret store at `BACKUP_KEY_PRIVATE_KEY_PATH` for the duration of the restore. No real `.env` values are copied into logs or evidence.
5. The drill uses a disposable compose project with fake keys, a non-default port and an empty database. Never restore production data into a shared or developer DB.

### 6.2 Steps

| Step | Command / action | Pass condition |
|---|---|---|
| 1. Select | `node scripts/backup-cli.mjs verify --manifest-id <id>` | Manifest schema valid, ciphertext digest and GCM tag verified |
| 2. Fetch + decrypt | `node scripts/backup-cli.mjs restore --manifest-id <id>` with `RESTORE_TARGET_DB` and `CONFIRM_RESTORE` | Data key unwrapped with correct private key; plaintext written only to a private temporary directory (tmpfs), removed afterwards |
| 3. Prepare target | Create isolated DB; apply repo migrations with `pnpm --filter api db:migrate:prod` against the **isolated** DB URL | `prisma migrate deploy` reports all migrations applied; no `rolled_back_at` |
| 4. Import | `pg_restore --no-owner --no-privileges --exit-on-error` into the isolated DB | Exit code 0; no unhandled errors |
| 5. Structural checks | §6.3 SQL with `psql -v ON_ERROR_STOP=1` | Every violation column returns `0`; migration status matches the repo |
| 6. Business samples | §6.4 SQL | Counts match the source snapshot recorded at backup time; sampled rows are readable |
| 7. App smoke | Point a disposable API instance at the isolated DB (fake keys), start with the real migration set | Health check OK; one representative read per domain (auth/learning/chat/tokens/admin audit) succeeds |
| 8. Teardown | Delete the isolated DB and temporary plaintext, revoke short-lived role grants | No plaintext dump remains on disk; evidence saved before teardown |

If step 3/4 fails, do not "patch forward" in the drill log: record the failure, keep the manifest id, and repeat from a fresh target. If any check in §6.3 fails, the backup is not restorable and the sprint gate is not met.

### 6.3 Structural and invariant checks

Run on the **restored isolated DB** with `psql -v ON_ERROR_STOP=1`. The counts are taken from the source DB at backup time and recorded in the evidence template; equality is the acceptance rule.

```sql
-- Migration state: exactly the migrations checked into apps/api/prisma/migrations
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
ORDER BY finished_at;
SELECT count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back_migrations
FROM _prisma_migrations;
SELECT count(*) FILTER (WHERE finished_at IS NULL) AS unfinished_migrations
FROM _prisma_migrations;

-- Row counts for the recovery-critical tables
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'mfa_secrets', count(*) FROM mfa_secrets
UNION ALL SELECT 'chat_conversations', count(*) FROM chat_conversations
UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages
UNION ALL SELECT 'srs_review_events', count(*) FROM srs_review_events
UNION ALL SELECT 'user_card_progress', count(*) FROM user_card_progress
UNION ALL SELECT 'token_transactions', count(*) FROM token_transactions
UNION ALL SELECT 'user_token_balance', count(*) FROM user_token_balance
UNION ALL SELECT 'ai_operations', count(*) FROM ai_operations
UNION ALL SELECT 'daily_credit_grants', count(*) FROM daily_credit_grants
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;

-- Violations: every column must be 0
SELECT
  (SELECT count(*) FROM chat_messages m
     LEFT JOIN chat_conversations c ON c.id = m.conversation_id
    WHERE c.id IS NULL) AS orphan_chat_messages,
  (SELECT count(*) FROM srs_review_events e
     LEFT JOIN users u ON u.id = e.user_id
    WHERE u.id IS NULL) AS orphan_srs_users,
  (SELECT count(*) FROM (
      SELECT user_id, card_id FROM user_card_progress
      GROUP BY user_id, card_id HAVING count(*) > 1
   ) d) AS duplicate_progress,
  (SELECT count(*) FROM (
      SELECT id FROM srs_review_events GROUP BY id HAVING count(*) > 1
   ) d) AS duplicate_srs_ids,
  (SELECT count(*) FROM user_token_balance WHERE balance < 0) AS negative_balances,
  (SELECT count(*) FROM (
      SELECT idempotency_key FROM token_transactions
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key HAVING count(*) > 1
   ) d) AS duplicate_ledger_keys,
  (SELECT count(*) FROM (
      SELECT user_id, feature, client_operation_id FROM ai_operations
      GROUP BY user_id, feature, client_operation_id HAVING count(*) > 1
   ) d) AS duplicate_operations,
  (SELECT count(*) FROM ai_operations
    WHERE status IN ('SUCCEEDED','FAILED','UNKNOWN','CANCELLED')
      AND charged_credits > reserved_credits) AS overcharged_operations,
  (SELECT count(*) FROM (
      SELECT user_id, grant_type, day FROM daily_credit_grants
      GROUP BY user_id, grant_type, day HAVING count(*) > 1
   ) d) AS duplicate_grants,
  (SELECT count(*) FROM (
      SELECT user_id FROM mfa_secrets GROUP BY user_id HAVING count(*) > 1
   ) d) AS duplicate_mfa_secrets;
```

Notes: `user_token_balance.balance >= 0`, ledger immutability and enum vocabularies are application-only invariants (no DB CHECK/trigger in the repo per `docs/database-inventory.md`); the query above is the drill's substitute. `outbox_events` has no checked-in DDL, so only run its count when `to_regclass('public.outbox_events') IS NOT NULL`; record "table absent" instead of skipping silently.

### 6.4 Business samples

Record actual values (no PII) in the evidence log:

- `SELECT count(*) FROM users WHERE is_active;` — active accounts.
- `SELECT count(*) FROM chat_conversations WHERE created_at >= now() - interval '1 day';` — recent conversations.
- `SELECT count(*) FROM srs_review_events WHERE created_at >= now() - interval '1 day';` — recent reviews.
- `SELECT count(*) FROM token_transactions WHERE created_at >= now() - interval '1 day';` — recent ledger writes.
- `SELECT count(*) FROM daily_credit_grants WHERE day = current_date;` — today's grants (zero-amount rows included).
- `SELECT count(*) FROM ai_operations WHERE status IN ('RESERVED','RUNNING');` — non-terminal operations (leases restored, not lost).
- `SELECT count(*) FROM audit_logs WHERE created_at >= now() - interval '1 day';` — recent audit trail.
- Verify one known `(user_id, feature, client_operation_id)` operation returns its original `request_hash`, `pricing_version`, `reserved_credits` and terminal status from the fixture, not from a live provider.

## 7. Alert contract: `backup failed` (OPS-03)

| Field | Value |
|---|---|
| Name | `backup failed` |
| Severity | Critical (RPO is at risk) |
| Fires when | Scheduled job exits non-zero; manifest missing/malformed; digest or GCM tag mismatch; S3/KMS upload error; off-host replica missing; retention sweep denied by Object Lock; no successful manifest for > 24 h |
| Symptoms | Alert from scheduler or CLI; no new object under today's prefix; `verify` rejects newest manifest |
| Checks | Scheduler run history; newest manifest id and `createdAt`; `verify --manifest-id <id>`; bucket object/version list; KMS/role errors in job logs (metadata only, no secrets); off-host replica presence |
| Mitigation | Run one manual backup immediately; if upload fails, switch to the secondary bucket/role per incident procedure; if key mismatch, use the correct `keyId` from the secret store — never disable verification |
| Recovery | Confirm a verified manifest exists, clear the alert with manifest id and timestamp, and update the evidence log; if a restore was needed, complete §6 and sign off |
| Owner | Platform/on-call owner; security owner for wrap-key/KMS failures |
| Runbook | This document (§3, §6); OPS-03 requires a runbook with symptoms, checks, mitigation, recovery and owner for each alert |

Additional TARGET alerts: `restore drill failed` (drill step/check fails) and `retention sweep denied` (delete blocked or off-host copy missing). Do not auto-restart or auto-delete on these alerts; require operator review.

## 8. Restore drill evidence template

Copy this block into `docs/restore-drill-log.md` (TARGET; not created by this slice) for every drill. Fill every field; write `N/A` with a reason rather than leaving blanks. Do not paste secret values, emails, real `.env` contents, provider keys or raw user content.

```markdown
## Drill <YYYY-MM-DD> — <scheduled | pre-migration | ad-hoc>

- Operator: <name>  Approver: <name>  Ticket: <id>
- Source manifest id: <uuid>  Key id: <keyId>  Reason: <scheduled/pre-migration/...>
- Object version id: <version>  Off-host replica verified: <yes/no>
- Target DB name: <isolated-name>  Compose project: <name>  Port: <non-default port>
- Timings (UTC): declared <T0> / fetch+verify <T1> / decrypt <T2> / restore <T3> / verify <T4> / teardown <T5>
- Measured RPO: <age of manifest at incident declaration>  Measured RTO: <T4 - T0>
- Migration status: <expected count> expected / <observed count> applied / <rolled back> rolled back / <unfinished> unfinished
- Source row counts: users <n>, mfa_secrets <n>, chat_conversations <n>, chat_messages <n>, srs_review_events <n>, user_card_progress <n>, token_transactions <n>, user_token_balance <n>, ai_operations <n>, daily_credit_grants <n>, audit_logs <n>, outbox_events <n or absent>
- Restored row counts: users <n>, mfa_secrets <n>, chat_conversations <n>, chat_messages <n>, srs_review_events <n>, user_card_progress <n>, token_transactions <n>, user_token_balance <n>, ai_operations <n>, daily_credit_grants <n>, audit_logs <n>, outbox_events <n or absent>
- Invariants: orphan_chat_messages <n>, orphan_srs_users <n>, duplicate_progress <n>, duplicate_srs_ids <n>, negative_balances <n>, duplicate_ledger_keys <n>, duplicate_operations <n>, overcharged_operations <n>, duplicate_grants <n>, duplicate_mfa_secrets <n>  (all must be 0)
- Business samples: active_users <n>, recent_chat <n>, recent_reviews <n>, recent_ledger <n>, today_grants <n>, nonterminal_ops <n>, recent_audit <n>, sampled_operation_hash_matches <yes/no>
- Constraints checked (FK/PK/unique) with psql ON_ERROR_STOP: <yes/no>
- Failures and deviations: <none or itemized; include manifest id and error code>
- Plaintext dump removed / target DB dropped: <yes/no>  Alert state after drill: <clear/incident>
- Sign-off: operator <name/date>, approver <name/date>
```

## 9. Open decisions and blockers for other slices

The following are required to make this policy operational but are outside the file scope of this slice; they are recorded here rather than edited:

1. `scripts/backup-cli.mjs` and `scripts/backup-cli.test.mjs` (TARGET): implement/encrypt/verify/restore/retention/drill subcommands with injectable command runner; add tests for roundtrip, tampering, wrong key, retention boundaries, production-target refusal and manifest validation.
2. `apps/api/test/backup-restore.e2e-spec.ts` (TARGET): drill harness gated by `RUN_BACKUP_DRILL=1`, disposable compose project, non-default port, fake keys, no real `.env` reads, deterministic teardown.
3. `docs/restore-drill-log.md` (TARGET): dated evidence using §8.
4. `.github/workflows/backup-drill.yml` (TARGET): scheduled/manual weekly drill on ephemeral Postgres with fake keys, uploads evidence; deliberately not a PR gate.
5. `.env.example` (TARGET): add variable **names only** — `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PREFIX`, `BACKUP_KEY_PUBLIC_KEY_PEM_PATH`, `BACKUP_KEY_PRIVATE_KEY_PATH` (operator/drill only), `BACKUP_RETENTION_DAILY`, `BACKUP_RETENTION_WEEKLY`, `BACKUP_RETENTION_MONTHLY`, `BACKUP_SCHEDULE_CRON`, `BACKUP_OBJECT_LOCK_MODE`, `AWS_ROLE_ARN`.
6. `docs/provider-setup.md` (TARGET): document wrap-key ownership and rotation (new public key + rewrap; retain old private key through the retention window).
7. Root `package.json` (TARGET): `backup:run`, `backup:restore`, `backup:verify`, `backup:retention`, `backup:drill` scripts.
8. Confirm the proposed RPO/RTO, Object Lock mode and replica location with the service owner; until then the targets in §1.3 are unapproved.
