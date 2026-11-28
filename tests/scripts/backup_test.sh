#!/usr/bin/env bash
# Self-contained harness for scripts/backup.sh. Stubs every external tool with
# PATH shims: no DB, network, real keys, package manager or .env reads.
# Run: bash tests/scripts/backup_test.sh
set -Eeuo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$SRC/scripts/backup.sh"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/backup-test.XXXXXX")"
trap 'rm -rf -- "$ROOT"' EXIT
BIN="$ROOT/bin"
STAGE="$ROOT/stage"
SWEEP="$ROOT/sweep"
mkdir -p "$BIN" "$STAGE" "$SWEEP"
export PATH="$BIN:$PATH"

PASS=0
FAIL=0
LAST_RC=0
ok()   { PASS=$((PASS + 1)); printf 'PASS %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$*" >&2; }
check() { local desc=$1; shift; if "$@"; then ok "$desc"; else fail "$desc"; fi; return 0; }
call() {
  set +e
  "$@"
  LAST_RC=$?
  set -e
  return 0
}
call_out() {
  local var=$1; shift
  local output
  set +e
  output=$("$@" 2>&1)
  LAST_RC=$?
  set -e
  printf -v "$var" '%s' "$output"
  return 0
}

cat >"$BIN/pg_dump" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" = "--version" ]]; then
  printf 'pg_dump (PostgreSQL) 16.4\n'
  exit 0
fi
printf 'FAKE-PG-DUMP-CUSTOM-FORMAT\n'
STUB

cat >"$BIN/pg_restore" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${PG_URL:-}" >> "$PG_DUMP_LOG_FILE"
exit "${PG_RESTORE_RC:-0}"
STUB

cat >"$BIN/psql" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${PG_URL:-}" >> "$PG_DUMP_LOG_FILE"
exit "${PSQL_RC:-0}"
STUB

cat >"$BIN/gpg" <<'STUB'
#!/usr/bin/env bash
args=("$@")
mode=""
out=""
pos=()
skip_next=0
for ((i = 0; i < ${#args[@]}; i++)); do
  if (( skip_next == 1 )); then
    skip_next=0
    continue
  fi
  case "${args[$i]}" in
    --encrypt) mode=enc ;;
    --decrypt) mode=dec ;;
    --detach-sign) mode=sign ;;
    --verify) mode=verify ;;
    --list-keys)
      printf 'fpr:::::::::FAKEFAKEFAKE1234:\n'
      exit 0
      ;;
    --output)
      out="${args[$((i + 1))]}"
      skip_next=1
      ;;
    --local-user|--recipient)
      skip_next=1
      ;;
    *)
      if [[ "${args[$i]}" != -* ]]; then
        pos+=("${args[$i]}")
      fi
      ;;
  esac
done
input="${pos[1]:-${pos[0]:-}}"
case "$mode" in
  enc)
    [[ "${GPG_ENCRYPT_RC:-0}" = 0 ]] || exit "${GPG_ENCRYPT_RC}"
    printf 'FAKEGPG:' > "$out"
    base64 < "$input" >> "$out"
    ;;
  dec)
    [[ "${GPG_DECRYPT_RC:-0}" = 0 ]] || exit "${GPG_DECRYPT_RC}"
    sed -n 's/^FAKEGPG://p' "$input" | base64 -d > "$out"
    ;;
  sign)
    sigval=$(sha256sum "$input" | cut -d' ' -f1)
    printf 'FAKESIG:%s\n' "$sigval" > "$out"
    ;;
  verify)
    [[ "${GPG_SIGNATURE_BAD:-0}" != 1 ]] || exit 1
    sigfile="${pos[0]}"
    datafile="${pos[1]}"
    [[ -f "$datafile" && -f "$sigfile" ]] || exit 1
    sigval=$(sha256sum "$datafile" | cut -d' ' -f1)
    [[ "$(cat "$sigfile")" = "FAKESIG:$sigval" ]]
    ;;
  *) exit 2 ;;
esac
STUB

cat >"$BIN/backup_upload" <<'STUB'
#!/usr/bin/env bash
printf '%s %s\n' "$1" "$2" >> "${UPLOAD_LOG:-/dev/null}"
[[ "${UPLOAD_RC:-0}" = 0 ]] || exit "${UPLOAD_RC}"
cat "$1" > "${UPLOAD_DIR:-/dev/null}/$(basename "$1")"
STUB

cat >"$BIN/backup_delete" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "${DELETE_LOG:-/dev/null}"
STUB
chmod +x "$BIN"/*

export UPLOAD_LOG="$ROOT/upload.log" UPLOAD_DIR="$ROOT/uploaded" DELETE_LOG="$ROOT/delete.log"
export PG_DUMP_LOG_FILE="$ROOT/pg.log" PG_DUMP_LOG=""
: >"$UPLOAD_LOG"; : >"$DELETE_LOG"; : >"$PG_DUMP_LOG_FILE"; mkdir -p "$UPLOAD_DIR"

base_env() {
  local -a overrides=()
  while [[ $# -gt 0 && "$1" = *=* ]]; do
    overrides+=("$1")
    shift
  done
  local -a vars=(
    BACKUP_SOURCE_ALIAS=linguaai_drill
    BACKUP_STAGE_DIR="$STAGE"
    BACKUP_GPG_RECIPIENT=ci-fake-recipient
    BACKUP_SIGNING_KEY=ci-fake-signing-key
    BACKUP_RETENTION_DAILY=14
    BACKUP_RETENTION_WEEKLY=8
    BACKUP_RETENTION_MONTHLY=6
    BACKUP_MIN_KEEP=1
    ALLOW_RESTORE=0
    BACKUP_DRY_RUN=0
    RESTORE_TARGET_URL=postgresql://ci:ci@127.0.0.1:55432/restore_drill
  )
  vars+=("${overrides[@]}")
  env "${vars[@]}" "$@"
}
run() { base_env bash "$SCRIPT" "$@"; }
run_in() { local dir=$1; shift; base_env BACKUP_STAGE_DIR="$dir" bash "$SCRIPT" "$@"; }

make_artifact() {
  local dir=$1 name=$2 ts=$3 status=${4:-complete} checksum
  printf 'FAKEGPG:%s\n' "$(printf 'row-%s' "$name" | base64)" >"$dir/$name"
  checksum="$(sha256sum "$dir/$name" | cut -d' ' -f1)"
  printf '%s  %s\n' "$checksum" "$name" >"${dir}/${name%.gpg}.sha256"
  cat >"${dir}/${name%.gpg}.manifest.json" <<EOF
{
  "schema_version": 1,
  "created_at_utc": "$ts",
  "database_alias": "linguaai_drill",
  "pg_major": "16",
  "artifact": "$name",
  "artifact_sha256": "$checksum",
  "key_fingerprint": "FAKEFAKEFAKE1234",
  "status": "$status"
}
EOF
}

# 1. Missing configuration fails with no artifacts.
call_out out base_env BACKUP_SOURCE_ALIAS= bash "$SCRIPT" backup; rc=$LAST_RC
check 'missing config exits 3' test "$rc" -eq 3
check 'missing config has no artifacts' test -z "$(ls -A "$STAGE")"
check 'missing config error is generic' bash -c '[[ "$1" != *ci:ci* ]]' _ "$out"

# 2. Happy path.
call_out out run backup; rc=$LAST_RC
if [[ $rc -ne 0 ]]; then printf '%s\n' "$out" >&2; fi
check 'happy path exits 0' test "$rc" -eq 0
art=$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' -print -quit)
check 'happy path publishes one artifact' test "$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')" = 1
check 'manifest is complete' test "$(grep -c '"status": "complete"' "$STAGE"/*.manifest.json)" = 1
expected_checksum=$(sed -n 's/.*"artifact_sha256": "\([^"]*\)".*/\1/p' "$STAGE"/*.manifest.json)
actual_checksum=$(sha256sum "$art" | cut -d' ' -f1)
check 'manifest checksum matches artifact' test "$expected_checksum" = "$actual_checksum"
check 'manifest has no DSN' bash -c '! grep -q "postgresql://" "$1"' _ "$STAGE"/*.manifest.json
check 'signature is published' test -f "${art}.sig"
check 'upload hook called once' test "$(wc -l <"$UPLOAD_LOG" | tr -d ' ')" = 1
check 'no pruned artifacts on first run' test ! -s "$DELETE_LOG"
check 'no work directory left behind' test -z "$(find "$STAGE" -maxdepth 1 \( -name '.work*' -o -name '.verify*' \) -print)"

# 3. verify: good, checksum mismatch, bad signature.
call run verify "$art"; rc=$LAST_RC
check 'verify accepts good artifact' test "$rc" -eq 0
cp "$art" "$ROOT/tampered.gpg"; printf 'X' >>"$ROOT/tampered.gpg"
call run verify "$ROOT/tampered.gpg"; rc=$LAST_RC
check 'verify rejects checksum mismatch' test "$rc" -eq 8
GPG_SIGNATURE_BAD=1 call base_env bash "$SCRIPT" verify "$art"; rc=$LAST_RC
check 'verify rejects bad signature' test "$rc" -eq 8

# 4. Failure classes.
before_delete=$(wc -l <"$DELETE_LOG" | tr -d ' ')
GPG_ENCRYPT_RC=1 call run backup; rc=$LAST_RC
check 'encrypt failure exits 6' test "$rc" -eq 6
check 'encrypt failure adds no visible artifact' test "$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')" = 1
UPLOAD_RC=1 call run backup; rc=$LAST_RC
check 'upload failure exits 10' test "$rc" -eq 10
check 'upload failure leaves no new artifact' test "$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')" = 1
after_delete=$(wc -l <"$DELETE_LOG" | tr -d ' ')
check 'failed runs trigger no prune' test "$after_delete" = "$before_delete"

# 5. Restore guard and isolated checks.
call base_env RESTORE_TARGET_URL=postgresql://ci:ci@127.0.0.1:55432/linguaai_drill bash "$SCRIPT" restore-check "$art"; rc=$LAST_RC
check 'restore-check refuses source alias' test "$rc" -eq 11
call base_env RESTORE_TARGET_URL=postgresql://ci:ci@127.0.0.1:55432/production bash "$SCRIPT" restore-check "$art"; rc=$LAST_RC
check 'restore-check refuses production alias' test "$rc" -eq 11
call base_env bash "$SCRIPT" restore-check "$art"; rc=$LAST_RC
check 'restore-check requires ALLOW_RESTORE' test "$rc" -eq 11
export PG_DUMP_LOG='postgresql://ci:ci@127.0.0.1:55432/restore_drill'
call_out out base_env ALLOW_RESTORE=1 bash "$SCRIPT" restore-check "$art"; rc=$LAST_RC
if [[ $rc -ne 0 ]]; then printf '%s\n' "$out" >&2; fi
check 'restore-check passes on isolated target' test "$rc" -eq 0
check 'restore logs never print target URL' bash -c '[[ "$1" != *postgresql://* ]]' _ "$out"
check 'restore commands used isolated URL' grep -q 'postgresql://ci:ci@127.0.0.1:55432/restore_drill' "$PG_DUMP_LOG_FILE"

# 6. Lock.
(
  exec 9>"$STAGE/.backup.lock"
  flock -n 9 || exit 1
  sleep 2
) &
locker=$!
sleep 0.2
call run backup; rc=$LAST_RC
wait "$locker" || true
check 'concurrent run blocked by lock' test "$rc" -eq 3

# 7. Retention boundaries and dry-run.
: >"$DELETE_LOG"
make_artifact "$SWEEP" a1.dump.gpg 2026-01-01T01:00:00Z
make_artifact "$SWEEP" a2.dump.gpg 2026-01-02T01:00:00Z
make_artifact "$SWEEP" a3.dump.gpg 2026-02-01T01:00:00Z
make_artifact "$SWEEP" a4.dump.gpg 2026-03-01T01:00:00Z
make_artifact "$SWEEP" a5.dump.gpg 2026-04-01T01:00:00Z
make_artifact "$SWEEP" bad.dump.gpg 2025-01-01T01:00:00Z failed
before=$(find "$SWEEP" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')
call run_in "$SWEEP" prune --dry-run; rc=$LAST_RC
check 'dry-run exits 0' test "$rc" -eq 0
check 'dry-run deletes nothing' test "$(find "$SWEEP" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')" = "$before"
check 'dry-run invokes no delete hook' test ! -s "$DELETE_LOG"
call base_env BACKUP_STAGE_DIR="$SWEEP" BACKUP_RETENTION_DAILY=2 BACKUP_RETENTION_WEEKLY=2 BACKUP_RETENTION_MONTHLY=2 bash "$SCRIPT" prune; rc=$LAST_RC
if [[ $rc -ne 0 ]]; then printf 'prune rc=%s\n' "$rc" >&2; fi
check 'prune exits 0' test "$rc" -eq 0
check 'monthly boundary kept' test -f "$SWEEP/a5.dump.gpg" -a -f "$SWEEP/a4.dump.gpg"
check 'weekly boundary kept' test -f "$SWEEP/a3.dump.gpg"
check 'oldest daily pruned' test ! -f "$SWEEP/a1.dump.gpg"
check 'failed artifact never pruned' test -f "$SWEEP/bad.dump.gpg"
check 'delete hook called for pruned artifact' grep -q 'a1.dump.gpg' "$DELETE_LOG"

# 8. Failed run blocks later prune.
count=$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')
GPG_ENCRYPT_RC=1 call run backup
call run prune; rc=$LAST_RC
check 'prune after failed run is refused' test "$rc" -eq 13
check 'refused prune deleted nothing' test "$(find "$STAGE" -maxdepth 1 -name '*.dump.gpg' | wc -l | tr -d ' ')" = "$count"

# 9. Redaction.
check 'logs contain no fake secret value' bash -c '! grep -Rq "ci-only-secret-DO-NOT-LOG" "$1"' _ "$ROOT"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
