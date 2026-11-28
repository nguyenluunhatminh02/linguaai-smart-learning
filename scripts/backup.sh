#!/usr/bin/env bash
# ops-19: encrypted PostgreSQL logical backup skeleton (roadmap DB-05).
#
# Subcommands:
#   backup                  dump -> encrypt -> verify -> publish -> upload -> prune
#   verify <artifact>       checksum + GPG decrypt round-trip (+ signature)
#   restore-check <artifact> verify + guarded restore drill into an isolated DB
#   prune [--dry-run]       retention sweep over complete, verified artifacts
#
# Exit codes: 0 ok, 2 usage, 3 config, 4 tool, 5 dump, 6 encrypt/sign,
# 7 checksum, 8 verify, 9 publish, 10 upload, 11 restore guard,
# 12 restore/check failure, 13 prune failure.
#
# This script never reads .env and never accepts passwords/DSNs as arguments.
# Credentials come from the process environment (PG* / .pgpass, e.g. via
# docker compose exec -T). Only the GPG public key is needed on the backup host;
# the private key belongs off-host and is used only for verify/drill.
# Stubs in tests/scripts/backup_test.sh replace all external commands; the
# shell logic below is exercised in CI without a database, network or real keys.

set -Eeuo pipefail
umask 077

readonly EXIT_USAGE=2 EXIT_CONFIG=3 EXIT_TOOL=4 EXIT_DUMP=5 EXIT_CRYPTO=6
readonly EXIT_CHECKSUM=7 EXIT_VERIFY=8 EXIT_PUBLISH=9 EXIT_UPLOAD=10
readonly EXIT_GUARD=11 EXIT_RESTORE=12 EXIT_PRUNE=13
readonly SCHEMA_VERSION=1
readonly SCRIPT_NAME="${0##*/}"

emit() { printf '%s [%s] %s\n' "$SCRIPT_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { local code=$1; shift; emit "ERROR: $*"; exit "$code"; }

# Configuration and artifacts (defaults are safe, non-secret values).
STAGE_DIR="${BACKUP_STAGE_DIR:-backups}"
SOURCE_ALIAS="${BACKUP_SOURCE_ALIAS:-}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
SIGNING_KEY="${BACKUP_SIGNING_KEY:-}"
RET_DAILY="${BACKUP_RETENTION_DAILY:-14}"
RET_WEEKLY="${BACKUP_RETENTION_WEEKLY:-8}"
RET_MONTHLY="${BACKUP_RETENTION_MONTHLY:-6}"
MIN_KEEP="${BACKUP_MIN_KEEP:-1}"
DRY_RUN="${BACKUP_DRY_RUN:-0}"
ALLOW_RESTORE="${ALLOW_RESTORE:-0}"
RESTORE_URL="${RESTORE_TARGET_URL:-}"
RUN_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

work_dir=""
temp_plain=""
lock_fd=""
lock_held=0
failed_run=0
publish_ok=0
current_command=""

cleanup() {
  local rc=$?
  [[ -n "$lock_fd" ]] && exec {lock_fd}>&-
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
  if [[ -n "$temp_plain" ]]; then
    rm -f -- "$temp_plain"
  fi
  if (( rc != 0 )); then
    # A failed run is a signal to the alerting layer and blocks all pruning,
    # including later standalone prune invocations (persisted marker).
    emit "run failed with exit code $rc; pruning disabled for this run"
    if [[ "$current_command" = backup && $lock_held -eq 1 ]]; then
      printf 'failed\n' >"$STAGE_DIR/.last_run_failed" 2>/dev/null || true
    fi
  fi
  return 0
}
trap cleanup EXIT

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "$EXIT_TOOL" "missing required tool: $1"; }

read_manifest_field() {
  local file=$1 key=$2
  sed -n "s/^[[:space:]]*\"${key}\":[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

read_manifest_num() {
  local file=$1 key=$2
  sed -n "s/^[[:space:]]*\"${key}\":[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$file" | head -n 1
}

manifest_ok() {
  local file=$1 schema status checksum allowed=${2:-complete}
  [[ -f "$file" ]] || return 1
  schema=$(read_manifest_num "$file" schema_version)
  status=$(read_manifest_field "$file" status)
  checksum=$(read_manifest_field "$file" artifact_sha256)
  [[ "$schema" = "$SCHEMA_VERSION" && "$status" = "$allowed" && "$checksum" =~ ^[0-9a-f]{64}$ ]]
}

artifact_paths() {
  local artifact=$1
  ARTIFACT_PATH="$artifact"
  MANIFEST_PATH="${artifact%.gpg}.manifest.json"
  CHECKSUM_PATH="${artifact%.gpg}.sha256"
}

require_config() {
  [[ -n "$SOURCE_ALIAS" ]] || die "$EXIT_CONFIG" "BACKUP_SOURCE_ALIAS is required"
  [[ -n "$GPG_RECIPIENT" ]] || die "$EXIT_CONFIG" "BACKUP_GPG_RECIPIENT is required"
  [[ "$RET_DAILY" =~ ^[0-9]+$ ]] || die "$EXIT_CONFIG" "BACKUP_RETENTION_DAILY must be an integer"
  [[ "$RET_WEEKLY" =~ ^[0-9]+$ ]] || die "$EXIT_CONFIG" "BACKUP_RETENTION_WEEKLY must be an integer"
  [[ "$RET_MONTHLY" =~ ^[0-9]+$ ]] || die "$EXIT_CONFIG" "BACKUP_RETENTION_MONTHLY must be an integer"
  [[ "$MIN_KEEP" =~ ^[0-9]+$ ]] || die "$EXIT_CONFIG" "BACKUP_MIN_KEEP must be an integer"
  (( MIN_KEEP >= 1 )) || die "$EXIT_CONFIG" "BACKUP_MIN_KEEP must be at least 1"
}

# Single writer per stage dir; flock is released by cleanup on every exit path.
acquire_lock() {
  need_cmd flock
  mkdir -p -- "$STAGE_DIR" || die "$EXIT_CONFIG" "cannot create stage directory"
  exec {lock_fd}>"$STAGE_DIR/.backup.lock" || die "$EXIT_CONFIG" "cannot open backup lock"
  flock -n "$lock_fd" || die "$EXIT_CONFIG" "another backup run holds the lock"
  lock_held=1
}

require_tools() {
  local tool
  for tool in pg_dump pg_restore psql gpg sha256sum; do
    need_cmd "$tool"
  done
}

write_manifest() {
  local path=$1 status=$2 artifact=$3 checksum=$4 pgmajor=$5 fingerprint=$6
  cat >"$path" <<EOF
{
  "schema_version": $SCHEMA_VERSION,
  "created_at_utc": "$RUN_TIME",
  "database_alias": "$SOURCE_ALIAS",
  "pg_major": "$pgmajor",
  "artifact": "${artifact##*/}",
  "artifact_sha256": "$checksum",
  "key_fingerprint": "$fingerprint",
  "status": "$status"
}
EOF
}

publish_failure() {
  local code=$1 message=$2
  failed_run=1
  if [[ -n "$work_dir" && "$publish_ok" -eq 0 ]]; then
    write_manifest "$work_dir/failed.manifest.json" failed \
      "${work_dir}/failed.dump.gpg" "" "" "" || true
    mv -f -- "$work_dir/failed.manifest.json" "$STAGE_DIR/failed.$(date -u +%Y%m%dT%H%M%SZ).$$json" 2>/dev/null || true
  fi
  die "$code" "$message"
}

upload_hook() {
  command -v backup_upload >/dev/null 2>&1 || die "$EXIT_UPLOAD" "backup_upload hook is required"
  backup_upload "$1" "${1##*/}"
}

delete_hook() {
  command -v backup_delete >/dev/null 2>&1 || die "$EXIT_PRUNE" "backup_delete hook is required"
  backup_delete "$1"
}

utc_day() { date -u -d "@$1" +%Y-%m-%d 2>/dev/null || date -u -r "$1" +%Y-%m-%d; }
iso_week() { date -u -d "@$1" +%G-W%V 2>/dev/null || date -u -r "$1" +%G-W%V; }
utc_month() { date -u -d "@$1" +%Y-%m 2>/dev/null || date -u -r "$1" +%Y-%m; }

cmd_backup() {
  require_config
  acquire_lock
  require_tools

  work_dir="$(mktemp -d "$STAGE_DIR/.work.XXXXXX")" || die "$EXIT_PUBLISH" "cannot create private work directory"
  local raw="$work_dir/dump.dump" enc="$work_dir/dump.dump.gpg"
  local checksum_file="$work_dir/dump.dump.sha256" fingerprint="unavailable" pgmajor="unknown"

  emit "starting logical dump for alias ${SOURCE_ALIAS}"
  pg_dump -Fc --no-owner --no-privileges >"$raw" || publish_failure "$EXIT_DUMP" "pg_dump failed"
  [[ -s "$raw" ]] || publish_failure "$EXIT_DUMP" "pg_dump produced an empty artifact"

  pgmajor="$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | cut -d. -f1 | head -n 1 || true)"
  [[ "$pgmajor" =~ ^[0-9]+$ ]] || pgmajor="unknown"

  fingerprint="$(gpg --with-colons --list-keys "$GPG_RECIPIENT" 2>/dev/null | sed -n 's/^fpr:*:\([0-9A-Fa-f]*\):.*/\1/p' | head -n 1 || true)"
  [[ -n "$fingerprint" ]] || fingerprint="unavailable"

  # Passphrase-free public-key encryption; no key material on the command line.
  gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" \
    --output "$enc" "$raw" || publish_failure "$EXIT_CRYPTO" "gpg encryption failed"
  if [[ -n "$SIGNING_KEY" ]]; then
    gpg --batch --yes --local-user "$SIGNING_KEY" --detach-sign --output "${enc}.sig" "$enc" \
      || publish_failure "$EXIT_CRYPTO" "gpg signing failed"
    [[ -s "${enc}.sig" ]] || publish_failure "$EXIT_CRYPTO" "empty signature"
  fi
  shred -u -- "$raw" 2>/dev/null || rm -f -- "$raw"

  local checksum
  checksum="$(sha256sum "$enc" | cut -d' ' -f1)" || publish_failure "$EXIT_CHECKSUM" "checksum failed"
  [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || publish_failure "$EXIT_CHECKSUM" "invalid checksum"
  printf '%s  %s\n' "$checksum" "${enc##*/}" >"$checksum_file"

  # Round-trip before publishing: a corrupt ciphertext must never become visible.
  local decrypted="$work_dir/roundtrip.dump"
  gpg --batch --yes --decrypt --output "$decrypted" "$enc" 2>/dev/null \
    || publish_failure "$EXIT_VERIFY" "encrypt/decrypt round-trip failed"
  [[ -s "$decrypted" ]] || publish_failure "$EXIT_VERIFY" "round-trip produced empty data"
  shred -u -- "$decrypted" 2>/dev/null || rm -f -- "$decrypted"

  local stamp manifest staging_artifact staging_manifest staging_checksum
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  staging_artifact="$STAGE_DIR/${stamp}.dump.gpg"
  staging_checksum="${staging_artifact%.gpg}.sha256"
  staging_manifest="${staging_artifact%.gpg}.manifest.json"
  mv -f -- "$enc" "$staging_artifact" || publish_failure "$EXIT_PUBLISH" "cannot stage artifact"
  if [[ -f "${enc}.sig" ]]; then
    mv -f -- "${enc}.sig" "${staging_artifact}.sig" || publish_failure "$EXIT_PUBLISH" "cannot stage signature"
  fi
  mv -f -- "$checksum_file" "$staging_checksum" || publish_failure "$EXIT_PUBLISH" "cannot stage checksum"
  write_manifest "$work_dir/pending.manifest.json" pending "$staging_artifact" \
    "$checksum" "$pgmajor" "$fingerprint"
  mv -f -- "$work_dir/pending.manifest.json" "$staging_manifest" \
    || publish_failure "$EXIT_PUBLISH" "cannot stage manifest"
  publish_ok=1

  artifact_paths "$staging_artifact"
  verify_artifact "$ARTIFACT_PATH" pending || publish_failure "$EXIT_VERIFY" "published artifact failed verification"
  write_manifest "$work_dir/complete.manifest.json" complete "$staging_artifact" \
    "$checksum" "$pgmajor" "$fingerprint"
  mv -f -- "$work_dir/complete.manifest.json" "$MANIFEST_PATH" \
    || publish_failure "$EXIT_PUBLISH" "cannot finalize manifest"
  emit "published verified artifact ${staging_artifact##*/} sha256=${checksum}"

  upload_hook "$staging_artifact" || die "$EXIT_UPLOAD" "off-host upload hook failed"
  emit "off-host upload complete: ${staging_artifact##*/}"

  # Prune only after a fully successful run; --dry-run remains available.
  cmd_prune "${BACKUP_DRY_RUN:-0}"
  rm -f -- "$STAGE_DIR/.last_run_failed" 2>/dev/null || true
  emit "backup run complete"
}

verify_artifact() {
  local artifact=$1 allowed_status=${2:-complete}
  artifact_paths "$artifact"
  [[ -f "$ARTIFACT_PATH" ]] || die "$EXIT_VERIFY" "artifact not found"
  manifest_ok "$MANIFEST_PATH" "$allowed_status" || die "$EXIT_VERIFY" "missing or invalid manifest"

  local expected actual
  expected="$(read_manifest_field "$MANIFEST_PATH" artifact_sha256)"
  actual="$(sha256sum "$ARTIFACT_PATH" | cut -d' ' -f1)"
  [[ "$actual" = "$expected" ]] || die "$EXIT_VERIFY" "checksum mismatch"

  [[ -f "$CHECKSUM_PATH" ]] || die "$EXIT_VERIFY" "checksum sidecar missing"
  grep -q "^${expected}[[:space:]]" "$CHECKSUM_PATH" || die "$EXIT_VERIFY" "checksum sidecar mismatch"

  need_cmd gpg
  temp_plain="$STAGE_DIR/.verify.$$.dump"
  mkdir -p -- "$STAGE_DIR"
  if ! gpg --batch --yes --decrypt --output "$temp_plain" "$ARTIFACT_PATH" 2>/dev/null; then
    die "$EXIT_VERIFY" "decrypt round-trip failed"
  fi
  [[ -s "$temp_plain" ]] || die "$EXIT_VERIFY" "decrypted artifact is empty"
  if [[ -f "${ARTIFACT_PATH}.sig" ]]; then
    if ! gpg --batch --verify "${ARTIFACT_PATH}.sig" "$ARTIFACT_PATH" >/dev/null 2>&1; then
      die "$EXIT_VERIFY" "signature verification failed"
    fi
  elif [[ -n "${BACKUP_SIGNING_KEY:-}" ]]; then
    die "$EXIT_VERIFY" "signature required but missing"
  fi
  rm -f -- "$temp_plain"
  temp_plain=""
  emit "verified artifact ${ARTIFACT_PATH##*/}"
}

cmd_verify() {
  [[ $# -eq 1 ]] || die "$EXIT_USAGE" "usage: $SCRIPT_NAME verify <artifact>"
  acquire_lock
  verify_artifact "$1"
}

guard_restore_target() {
  [[ "$ALLOW_RESTORE" = "1" ]] || die "$EXIT_GUARD" "ALLOW_RESTORE=1 is required for a restore drill"
  [[ -n "$RESTORE_URL" ]] || die "$EXIT_GUARD" "RESTORE_TARGET_URL is required"
  # Redacted: never echo the URL (it may contain a password).
  local url tail db
  tail="${RESTORE_URL##*/}"
  db="${tail%%\?*}"
  [[ -n "$db" ]] || die "$EXIT_GUARD" "RESTORE_TARGET_URL must name a database"
  [[ "$db" != "$SOURCE_ALIAS" ]] || die "$EXIT_GUARD" "restore target equals the source alias"
  case "${db,,}" in
    production|prod|live|primary|main|linguaai|postgres)
      die "$EXIT_GUARD" "restore target name is reserved for production" ;;
  esac
  # A source host/port in the target URL would mean restoring onto the source.
  url="${RESTORE_URL%%/*}"
  if [[ -n "${BACKUP_SOURCE_HOST:-}" ]]; then
    [[ "$url" != *"$BACKUP_SOURCE_HOST"* ]] || die "$EXIT_GUARD" "restore target host equals the source host"
  fi
}

cmd_restore_check() {
  [[ $# -eq 1 ]] || die "$EXIT_USAGE" "usage: $SCRIPT_NAME restore-check <artifact>"
  acquire_lock
  require_tools
  guard_restore_target
  verify_artifact "$1"

  work_dir="$(mktemp -d "$STAGE_DIR/.restore.XXXXXX")" || die "$EXIT_RESTORE" "cannot create restore work directory"
  emit "restore target guard passed; target name withheld from logs"
  local plain="$work_dir/restore.dump"
  gpg --batch --yes --decrypt --output "$plain" "$1" 2>/dev/null \
    || die "$EXIT_RESTORE" "decrypt for restore failed"

  # The dump is imported only into the isolated target URL. No real credentials
  # are printed; pg_restore/psql read them from the environment / .pgpass.
  # Pass the target through the environment so credentials never appear in argv.
  PG_URL="$RESTORE_URL" pg_restore --no-owner --no-privileges --exit-on-error \
    "$plain" || die "$EXIT_RESTORE" "pg_restore into isolated target failed"

  # Prisma migration metadata + constraints + sample counts/business checks.
  local sql="$work_dir/checks.sql"
  cat >"$sql" <<'SQL'
\set ON_ERROR_STOP on
SELECT count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back_migrations,
       count(*) FILTER (WHERE finished_at IS NULL) AS unfinished_migrations
FROM _prisma_migrations;
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'srs_review_events', count(*) FROM srs_review_events
UNION ALL SELECT 'user_card_progress', count(*) FROM user_card_progress
UNION ALL SELECT 'token_transactions', count(*) FROM token_transactions
UNION ALL SELECT 'quiz_attempts', count(*) FROM quiz_attempts
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
SELECT
  (SELECT count(*) FROM chat_messages m LEFT JOIN chat_conversations c
     ON c.id = m.conversation_id WHERE c.id IS NULL) AS orphan_chat_messages,
  (SELECT count(*) FROM srs_review_events e LEFT JOIN users u
     ON u.id = e.user_id WHERE u.id IS NULL) AS orphan_srs_users,
  (SELECT count(*) FROM (
      SELECT user_id, card_id FROM user_card_progress
      GROUP BY user_id, card_id HAVING count(*) > 1) d) AS duplicate_progress,
  (SELECT count(*) FROM (
      SELECT idempotency_key FROM token_transactions WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key HAVING count(*) > 1) d) AS duplicate_ledger_keys,
  (SELECT count(*) FROM user_token_balance WHERE balance < 0) AS negative_balances,
  (SELECT count(*) FROM audit_logs WHERE created_at >= now() - interval '1 day') AS recent_audit;
SQL
  psql -v ON_ERROR_STOP=1 -f "$sql" >/dev/null \
    || die "$EXIT_RESTORE" "restore checks failed on isolated target"
  emit "restore check passed for ${1##*/}"
}

cmd_prune() {
  local dry=${1:-0}
  [[ "$dry" = "0" || "$dry" = "1" ]] || die "$EXIT_USAGE" "prune [--dry-run] expects no value"
  (( failed_run == 0 )) || die "$EXIT_PRUNE" "previous run failed; refusing to prune"
  [[ -f "$STAGE_DIR/.last_run_failed" ]] && die "$EXIT_PRUNE" "last backup failed; refusing to prune"
  [[ -n "$lock_fd" ]] || acquire_lock

  local -a candidates=()
  local f backup_upload
  backup_upload=$(command -v backup_upload 2>/dev/null || true)
  [[ -n "$backup_upload" ]] || { emit "prune: upload hook missing; off-host copy unproven"; return 0; }
  for f in "$STAGE_DIR"/*.manifest.json; do
    [[ -e "$f" ]] || continue
    manifest_ok "$f" || continue
    local artifact created status
    artifact=$(read_manifest_field "$f" artifact)
    created=$(read_manifest_field "$f" created_at_utc)
    status=$(read_manifest_field "$f" status)
    [[ "$status" = complete && -n "$artifact" ]] || continue
    [[ -f "$STAGE_DIR/$artifact" ]] || continue
    # Off-host presence is required before local deletion is allowed.
    candidates+=("$f")
  done

  ((${#candidates[@]} > 0)) || { emit "prune: no eligible artifacts"; return 0; }

  local -a keep=() drop=()
  local -A seen_day=() seen_week=() seen_month=()
  local days=0 weeks=0 months=0 i ts day week month file created
  for ((i = ${#candidates[@]} - 1; i >= 0; i--)); do
    file=${candidates[$i]}
    created=$(read_manifest_field "$file" created_at_utc)
    ts=$(date -u -d "$created" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$created" +%s 2>/dev/null || printf 0)
    day=$(utc_day "$ts"); week=$(iso_week "$ts"); month=$(utc_month "$ts")
    if (( ${#keep[@]} < MIN_KEEP )); then
      keep+=("$file")
    elif [[ -z "${seen_day[$day]:-}" ]]; then
      seen_day[$day]=1
      if (( days < RET_DAILY )); then keep+=("$file"); else drop+=("$file"); fi
      ((days+=1))
    elif [[ -z "${seen_week[$week]:-}" ]]; then
      seen_week[$week]=1
      if (( weeks < RET_WEEKLY )); then keep+=("$file"); else drop+=("$file"); fi
      ((weeks+=1))
    elif [[ -z "${seen_month[$month]:-}" ]]; then
      seen_month[$month]=1
      if (( months < RET_MONTHLY )); then keep+=("$file"); else drop+=("$file"); fi
      ((months+=1))
    else
      drop+=("$file")
    fi
  done

  emit "prune dry_run=$dry keep=${#keep[@]} delete=${#drop[@]}"
  for file in "${drop[@]}"; do
    local artifact checksum_path sig_path
    artifact=$(read_manifest_field "$file" artifact)
    checksum_path="$STAGE_DIR/${artifact%.gpg}.sha256"
    sig_path="$STAGE_DIR/${artifact}.sig"
    if [[ "$dry" = "1" ]]; then
      emit "would delete $artifact"
      continue
    fi
    delete_hook "$artifact" || die "$EXIT_PRUNE" "remote delete hook failed for $artifact"
    rm -f -- "$STAGE_DIR/$artifact" "$checksum_path" "$sig_path" "$file" \
      || die "$EXIT_PRUNE" "local delete failed for $artifact"
    emit "pruned $artifact"
  done
}

cmd_help() {
  cat <<EOF
$SCRIPT_NAME — encrypted backup / verify / restore drill / retention (DB-05, ops-19)
Usage:
  $SCRIPT_NAME backup
  $SCRIPT_NAME verify <artifact>
  $SCRIPT_NAME restore-check <artifact>
  $SCRIPT_NAME prune [--dry-run]
Configuration: BACKUP_SOURCE_ALIAS, BACKUP_STAGE_DIR, BACKUP_GPG_RECIPIENT,
BACKUP_SIGNING_KEY (optional), BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY,
BACKUP_MIN_KEEP, BACKUP_DRY_RUN, RESTORE_TARGET_URL, ALLOW_RESTORE.
No .env is sourced; no passwords or DSNs are accepted as arguments.
EOF
}

main() {
  local cmd=${1:-help}
  current_command="$cmd"
  shift || true
  case "$cmd" in
    backup)        cmd_backup "$@" ;;
    verify)        cmd_verify "$@" ;;
    restore-check) cmd_restore_check "$@" ;;
    prune)
      case "${1:-}" in
        "")           cmd_prune 0 ;;
        --dry-run)    cmd_prune 1 ;;
        *)            die "$EXIT_USAGE" "prune [--dry-run] expects no value" ;;
      esac
      ;;
    help|-h|--help) cmd_help ;;
    *) die "$EXIT_USAGE" "unknown subcommand: $cmd (try help)" ;;
  esac
}

main "$@"
