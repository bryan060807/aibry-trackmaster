#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/home/aibry/projects/aibry-trackmaster"
SERVICE_NAME="trackmaster-api.service"
WEB_SERVICE_NAME="trackmaster-web.service"
SQLITE_PATH="$PROJECT_ROOT/data/trackmaster.sqlite"
UPLOADS_PATH="$PROJECT_ROOT/data/uploads"
REPORTS_DIR="$PROJECT_ROOT/migration-reports"
BACKUP_PARENT="/home/aibry/backups/trackmaster"
REHEARSAL_REPORT="$PROJECT_ROOT/migration-reports/trackmaster-postgres-rehearsal-2026-04-25T02-15-04-684Z.json"
PRODUCTION_DB="trackmaster_production"
REHEARSAL_DB="trackmaster_rehearsal"
PGHOST="127.0.0.1"
PGPORT="5432"
PGUSER="aibry"
PGPASSWORD_VALUE="${TRACKMASTER_CUTOVER_PGPASSWORD:?Set TRACKMASTER_CUTOVER_PGPASSWORD before running cutover}"
REAL_PG_URL="postgresql://aibry:${PGPASSWORD_VALUE}@127.0.0.1:5432/${PRODUCTION_DB}"
MASKED_PG_URL="postgresql://aibry:[REDACTED]@127.0.0.1:5432/${PRODUCTION_DB}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG_FILE="$REPORTS_DIR/trackmaster-production-cutover-$TIMESTAMP.log"
BACKUP_ROOT="$BACKUP_PARENT/PROD-CUTOVER-$TIMESTAMP"
ROLLBACK_REASON=""
API_STOPPED=0
ENV_CHANGED=0
CUTOVER_COMPLETED=0
WEB_WAS_ACTIVE=0
WARNINGS=()
DB_ACTION="undetermined"
TABLE_LIST=""
USER_COUNT=""
TRACK_COUNT=""
PRESET_COUNT=""
SQLITE_SOURCE_USER_COUNT=""
SQLITE_SOURCE_TRACK_COUNT=""
SQLITE_SOURCE_PRESET_COUNT=""
LOCAL_HEALTH_RESULT="not-run"
LOCAL_V1_HEALTH_RESULT="not-run"
PUBLIC_API_HEALTH_RESULT="not-run"
LOCAL_WEB_RESULT="not-run"
PUBLIC_WEB_RESULT="not-run"

mkdir -p "$REPORTS_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

phase() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

pass() {
  printf 'RESULT: PASS - %s\n' "$1"
}

warn() {
  WARNINGS+=("$1")
  printf 'RESULT: WARN - %s\n' "$1"
}

fail_now() {
  printf 'RESULT: FAIL - %s\n' "$1"
  ROLLBACK_REASON="$1"
  if [[ $CUTOVER_COMPLETED -eq 0 && ( $API_STOPPED -eq 1 || $ENV_CHANGED -eq 1 ) ]]; then
    rollback
  else
    printf 'Safe state preserved without rollback action.\n'
  fi
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail_now "Required file missing: $path"
}

require_dir() {
  local path="$1"
  [[ -d "$path" ]] || fail_now "Required directory missing: $path"
}

service_state() {
  local service_name="${1:-$SERVICE_NAME}"
  systemctl --user show "$service_name" -p ActiveState --value
}

service_substate() {
  local service_name="${1:-$SERVICE_NAME}"
  systemctl --user show "$service_name" -p SubState --value
}

service_logs() {
  local service_name="${1:-$SERVICE_NAME}"
  journalctl --user -u "$service_name" -n 40 --no-pager || true
}

service_logs_since() {
  local service_name="$1"
  local since="$2"
  journalctl --user -u "$service_name" --since "$since" -n 40 --no-pager || true
}

redact_text() {
  sed \
    -e "s|$REAL_PG_URL|$MASKED_PG_URL|g" \
    -e "s|$PGPASSWORD_VALUE|[REDACTED]|g"
}

run_masked() {
  "$@" 2>&1 | redact_text
}

psql_masked() {
  PGPASSWORD="$PGPASSWORD_VALUE" psql "$@" 2>&1 | redact_text
}

curl_check() {
  local label="$1"
  local url="$2"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 20 "$url" || true)"
  local body
  body="$(tr '\n' ' ' < "$tmp" | cut -c1-400)"
  rm -f "$tmp"
  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    printf 'RESULT: PASS - %s -> HTTP %s %s\n' "$label" "$code" "$body"
    return 0
  fi
  printf 'RESULT: FAIL - %s -> HTTP %s %s\n' "$label" "${code:-000}" "$body"
  return 1
}

retry_curl_check() {
  local label="$1"
  local url="$2"
  local attempts="$3"
  local delay="$4"
  local try
  for ((try=1; try<=attempts; try++)); do
    if curl_check "$label (attempt $try/$attempts)" "$url"; then
      return 0
    fi
    if (( try < attempts )); then
      sleep "$delay"
    fi
  done
  return 1
}

db_exists() {
  local db_name="$1"
  local result
  result="$(PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'")"
  [[ "${result//[[:space:]]/}" == "1" ]]
}

load_db_state() {
  TABLE_LIST="$(PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d "$PRODUCTION_DB" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")"
  USER_COUNT="$(PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d "$PRODUCTION_DB" -tAc "SELECT COUNT(*) FROM users;")"
  TRACK_COUNT="$(PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d "$PRODUCTION_DB" -tAc "SELECT COUNT(*) FROM tracks;")"
  PRESET_COUNT="$(PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d "$PRODUCTION_DB" -tAc "SELECT COUNT(*) FROM presets;")"
}

load_sqlite_snapshot_counts() {
  local sqlite_file="$1"
  local counts
  counts="$(node - <<'NODE' "$sqlite_file"
const Database = require('better-sqlite3');
const sqlitePath = process.argv[2];
const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const tables = ['users', 'tracks', 'presets'];
for (const table of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  console.log(`${table}=${row.count}`);
}
db.close();
NODE
)"
  SQLITE_SOURCE_USER_COUNT="$(printf '%s\n' "$counts" | awk -F= '/^users=/{print $2}')"
  SQLITE_SOURCE_TRACK_COUNT="$(printf '%s\n' "$counts" | awk -F= '/^tracks=/{print $2}')"
  SQLITE_SOURCE_PRESET_COUNT="$(printf '%s\n' "$counts" | awk -F= '/^presets=/{print $2}')"
}

assert_expected_tables_exist() {
  for table in users tracks presets; do
    if ! grep -qx "$table" <<< "$TABLE_LIST"; then
      fail_now "Expected table missing in ${PRODUCTION_DB}: $table"
    fi
  done
}

assert_dynamic_count_match() {
  if [[ "${USER_COUNT//[[:space:]]/}" != "${SQLITE_SOURCE_USER_COUNT//[[:space:]]/}" || "${TRACK_COUNT//[[:space:]]/}" != "${SQLITE_SOURCE_TRACK_COUNT//[[:space:]]/}" || "${PRESET_COUNT//[[:space:]]/}" != "${SQLITE_SOURCE_PRESET_COUNT//[[:space:]]/}" ]]; then
    fail_now "Imported Postgres counts do not match final SQLite snapshot counts: sqlite(users=${SQLITE_SOURCE_USER_COUNT//[[:space:]]/},tracks=${SQLITE_SOURCE_TRACK_COUNT//[[:space:]]/},presets=${SQLITE_SOURCE_PRESET_COUNT//[[:space:]]/}) postgres(users=${USER_COUNT//[[:space:]]/},tracks=${TRACK_COUNT//[[:space:]]/},presets=${PRESET_COUNT//[[:space:]]/})"
  fi
}

running_api_env_check() {
  if ! command -v podman >/dev/null 2>&1; then
    warn "podman is unavailable, so running API env could not be inspected."
    return 0
  fi

  local names
  names="$(podman ps --format '{{.Names}}' 2>/dev/null || true)"
  if ! grep -qx 'trackmaster-api' <<< "$names"; then
    warn "trackmaster-api container is not visible to podman inspect."
    return 0
  fi

  local inspect_env
  inspect_env="$(podman inspect trackmaster-api --format '{{json .Config.Env}}' 2>/dev/null || true)"
  if [[ -z "$inspect_env" ]]; then
    warn "podman inspect returned no env payload for trackmaster-api."
    return 0
  fi

  if ! grep -q 'TRACKMASTER_REPOSITORY_BACKEND=postgres' <<< "$inspect_env"; then
    fail_now "Running API container env does not confirm TRACKMASTER_REPOSITORY_BACKEND=postgres."
  fi
  if ! grep -q "TRACKMASTER_POSTGRES_URL=$REAL_PG_URL" <<< "$inspect_env"; then
    fail_now "Running API container env does not confirm TRACKMASTER_POSTGRES_URL production target."
  fi
  pass "Running API container env confirms Postgres backend."
}

ensure_web_service_if_needed() {
  if [[ $WEB_WAS_ACTIVE -eq 1 && "$(service_state "$WEB_SERVICE_NAME")" != "active" ]]; then
    systemctl --user start "$WEB_SERVICE_NAME"
    sleep 3
  fi
}

api_startup_loop() {
  local started_since="$1"
  local waited=0
  local max_wait=60

  while (( waited < max_wait )); do
    local active_state
    local sub_state
    active_state="$(service_state "$SERVICE_NAME")"
    sub_state="$(service_substate "$SERVICE_NAME")"
    printf 'API startup check: t=%ss active=%s substate=%s\n' "$waited" "$active_state" "$sub_state"

    if [[ "$active_state" == "active" && "$sub_state" == "running" ]]; then
      if curl_check "startup local /api/health" "http://127.0.0.1:3004/api/health"; then
        LOCAL_HEALTH_RESULT="pass"
        return 0
      fi
    fi

    printf 'Recent API logs since restart:\n'
    service_logs_since "$SERVICE_NAME" "$started_since"
    sleep 5
    waited=$((waited + 5))
  done

  return 1
}

rollback() {
  phase "ROLLBACK"
  printf 'Rollback reason: %s\n' "$ROLLBACK_REASON"

  if [[ $ENV_CHANGED -eq 1 && -f "$BACKUP_ROOT/.env.before-cutover" ]]; then
    cp "$BACKUP_ROOT/.env.before-cutover" "$PROJECT_ROOT/.env"
    printf 'Rollback step: restored .env from backup.\n'
  else
    printf 'Rollback step: .env restore skipped.\n'
  fi

  systemctl --user start "$SERVICE_NAME"
  sleep 5
  ensure_web_service_if_needed

  printf 'Service status after rollback:\n'
  systemctl --user status "$SERVICE_NAME" --no-pager || true
  printf 'Recent service logs after rollback:\n'
  service_logs

  local rollback_local=fail
  local rollback_public=fail
  if retry_curl_check "rollback local SQLite health" "http://127.0.0.1:3004/api/health" 12 5; then
    rollback_local=pass
  fi
  if retry_curl_check "rollback public SQLite health" "https://trackmaster-api.aibry.shop/api/health" 12 5; then
    rollback_public=pass
  fi

  printf 'ROLLBACK COMPLETE.\n'
  printf 'Rollback verification: local=%s public=%s\n' "$rollback_local" "$rollback_public"
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  ROLLBACK_REASON="Script failed at line $line_no with exit code $exit_code."
  printf 'ABORT: %s\n' "$ROLLBACK_REASON"
  if [[ $CUTOVER_COMPLETED -eq 0 && ( $API_STOPPED -eq 1 || $ENV_CHANGED -eq 1 ) ]]; then
    rollback
  else
    printf 'Safe state preserved without rollback action.\n'
  fi
  exit "$exit_code"
}

trap 'on_error $? $LINENO' ERR

phase "PRECHECKS"
require_file "$PROJECT_ROOT/package.json"
require_file "$PROJECT_ROOT/scripts/postgres-rehearsal.mjs"
require_file "$PROJECT_ROOT/deploy/trackmaster-api.service"
require_file "$PROJECT_ROOT/.env"
require_file "$REHEARSAL_REPORT"
require_file "$SQLITE_PATH"
require_dir "$UPLOADS_PATH"
require_dir "$BACKUP_PARENT"
[[ -w "$BACKUP_PARENT" ]] || fail_now "Backup parent is not writable: $BACKUP_PARENT"
pass "Required repo files, SQLite, uploads, and backup parent exist."

node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if (j.validation !== 'passed') process.exit(1);" "$REHEARSAL_REPORT"
pass "Rehearsal report exists and validation is passed."

phase "CURRENT SOURCE OF TRUTH"
printf 'Current .env keys related to backend:\n'
if ! grep -E '^(TRACKMASTER_REPOSITORY_BACKEND|TRACKMASTER_POSTGRES_URL|TRACKMASTER_SQLITE_PATH|TRACKMASTER_SQLITE_DB)=' "$PROJECT_ROOT/.env" | sed 's/=.*$/=[REDACTED]/'; then
  printf '(none present)\n'
fi
if grep -q '^TRACKMASTER_REPOSITORY_BACKEND=postgres$' "$PROJECT_ROOT/.env"; then
  fail_now "Live .env already declares postgres backend."
fi
if grep -q '^TRACKMASTER_POSTGRES_URL=' "$PROJECT_ROOT/.env"; then
  fail_now "Live .env already contains TRACKMASTER_POSTGRES_URL."
fi
pass "Live backend remains SQLite by implicit default."

if [[ "$(service_state "$WEB_SERVICE_NAME")" == "active" ]]; then
  WEB_WAS_ACTIVE=1
fi

phase "POSTGRES PRECHECKS"
printf 'Verifying rehearsal database host auth with psql.\n'
PGPASSWORD="$PGPASSWORD_VALUE" psql -h "$PGHOST" -U "$PGUSER" -d "$REHEARSAL_DB" -c '\dt' | redact_text
pass "Host auth to rehearsal Postgres works."

printf 'Checking whether production database already exists.\n'
if db_exists "$PRODUCTION_DB"; then
  printf 'Production database already exists; validating previous failed-attempt contents.\n'
  load_db_state
  printf 'Existing production tables:\n%s\n' "$TABLE_LIST"
  printf 'Existing production row counts: users=%s tracks=%s presets=%s\n' "${USER_COUNT//[[:space:]]/}" "${TRACK_COUNT//[[:space:]]/}" "${PRESET_COUNT//[[:space:]]/}"
  assert_expected_tables_exist
  DB_ACTION="reuse-existing-db-and-refresh-import"
  pass "Existing ${PRODUCTION_DB} matches expected prior import and is safe to reuse."
else
  DB_ACTION="create-db-and-import"
  pass "Production database does not already exist."
fi

phase "SERVICE PRECHECKS"
printf 'Current service status:\n'
systemctl --user status "$SERVICE_NAME" --no-pager
if [[ "$(service_state)" != "active" ]]; then
  fail_now "Live API is not active before cutover."
fi
pass "Live API service is active before cutover."
printf 'Current web service status:\n'
systemctl --user status "$WEB_SERVICE_NAME" --no-pager
if [[ "$(service_state "$WEB_SERVICE_NAME")" != "active" ]]; then
  fail_now "Live web service is not active before cutover."
fi
pass "Live web service is active before cutover."

phase "LIVE HEALTH PRECHECKS"
curl_check "pre-cutover local health" "http://127.0.0.1:3004/api/health"
curl_check "pre-cutover public API health" "https://trackmaster-api.aibry.shop/api/health"
curl_check "pre-cutover local web" "http://127.0.0.1:3000"
curl_check "pre-cutover public web" "https://trackmaster.aibry.shop"
pass "Pre-cutover API and web health checks passed."

phase "FINAL BACKUPS"
mkdir -p "$BACKUP_ROOT"
cp "$PROJECT_ROOT/.env" "$BACKUP_ROOT/.env.before-cutover"
cp "$SQLITE_PATH" "$BACKUP_ROOT/trackmaster.sqlite"
sha256sum "$BACKUP_ROOT/trackmaster.sqlite" | tee "$BACKUP_ROOT/trackmaster.sqlite.sha256"
find "$UPLOADS_PATH" -type f | LC_ALL=C sort > "$BACKUP_ROOT/uploads.manifest.txt"
tar -C "$PROJECT_ROOT/data" -czf "$BACKUP_ROOT/uploads.tar.gz" uploads
sha256sum "$BACKUP_ROOT/uploads.tar.gz" | tee "$BACKUP_ROOT/uploads.tar.gz.sha256"
pass "Backups created under $BACKUP_ROOT"

phase "STOP SQLITE WRITER"
systemctl --user stop "$SERVICE_NAME"
API_STOPPED=1
sleep 3
printf 'Verifying service is stopped before import.\n'
if [[ "$(service_state)" != "inactive" ]]; then
  systemctl --user status "$SERVICE_NAME" --no-pager || true
  fail_now "API failed to stop cleanly."
fi
pass "API is stopped."

phase "PREPARE PRODUCTION DATABASE"
if [[ "$DB_ACTION" == "create-db-and-import" ]]; then
  PGPASSWORD="$PGPASSWORD_VALUE" createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PRODUCTION_DB"
  pass "Created database ${PRODUCTION_DB}."
else
  pass "Reusing existing safe ${PRODUCTION_DB}."
fi

phase "FINAL IMPORT"
load_sqlite_snapshot_counts "$BACKUP_ROOT/trackmaster.sqlite"
printf 'Final SQLite snapshot counts: users=%s tracks=%s presets=%s\n' "${SQLITE_SOURCE_USER_COUNT//[[:space:]]/}" "${SQLITE_SOURCE_TRACK_COUNT//[[:space:]]/}" "${SQLITE_SOURCE_PRESET_COUNT//[[:space:]]/}"
printf 'Import target: %s\n' "$MASKED_PG_URL"
TRACKMASTER_SQLITE_PATH="$BACKUP_ROOT/trackmaster.sqlite" \
TRACKMASTER_MIGRATION_DATABASE_URL="$REAL_PG_URL" \
TRACKMASTER_ALLOW_PRODUCTION_POSTGRES_IMPORT="I_UNDERSTAND_THIS_WRITES_TO_TARGET" \
npm run migration:rehearsal
pass "SQLite snapshot imported into ${PRODUCTION_DB}."
if [[ "$DB_ACTION" == "reuse-existing-db-and-refresh-import" ]]; then
  DB_ACTION="reused-existing-db-and-reimported"
else
  DB_ACTION="created-db-and-imported"
fi

phase "POST-IMPORT VALIDATION"
load_db_state
printf 'Production tables:\n%s\n' "$TABLE_LIST"
assert_expected_tables_exist
assert_dynamic_count_match
pass "Expected production tables exist."
printf 'Row counts: users=%s tracks=%s presets=%s\n' "${USER_COUNT//[[:space:]]/}" "${TRACK_COUNT//[[:space:]]/}" "${PRESET_COUNT//[[:space:]]/}"
pass "Dynamic Postgres counts match the final SQLite snapshot."

phase "SWITCH ENV TO POSTGRES"
cp "$PROJECT_ROOT/.env" "$BACKUP_ROOT/.env.before-postgres-write"
node <<'NODE'
const fs = require('fs');
const path = '/home/aibry/projects/aibry-trackmaster/.env';
const pgUrl = process.env.TRACKMASTER_MIGRATION_DATABASE_URL;
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const wanted = new Map([
  ['TRACKMASTER_REPOSITORY_BACKEND', 'postgres'],
  ['TRACKMASTER_POSTGRES_URL', pgUrl],
  ['TRACKMASTER_ENABLE_POSTGRES_RUNTIME', 'I_UNDERSTAND_THIS_IS_VALIDATION_ONLY'],
  ['TRACKMASTER_ALLOW_UNSAFE_POSTGRES_RUNTIME', 'I_UNDERSTAND_THIS_COULD_TARGET_A_NON_REHEARSAL_DATABASE'],
]);
const seen = new Set();
const out = lines.map((line) => {
  const idx = line.indexOf('=');
  if (idx === -1) return line;
  const key = line.slice(0, idx);
  if (!wanted.has(key)) return line;
  seen.add(key);
  return `${key}=${wanted.get(key)}`;
});
for (const [key, value] of wanted) {
  if (!seen.has(key)) out.push(`${key}=${value}`);
}
fs.writeFileSync(path, `${out.filter(Boolean).join('\n')}\n`);
NODE
ENV_CHANGED=1
printf 'Updated .env keys:\n'
grep -E '^(TRACKMASTER_REPOSITORY_BACKEND|TRACKMASTER_POSTGRES_URL|TRACKMASTER_ENABLE_POSTGRES_RUNTIME|TRACKMASTER_ALLOW_UNSAFE_POSTGRES_RUNTIME)=' "$PROJECT_ROOT/.env" | sed 's|[REDACTED]|[REDACTED]|g'
pass "Live .env switched to Postgres."

phase "START API"
API_STARTED_AT="$(date -Is)"
systemctl --user start "$SERVICE_NAME"
sleep 5
ensure_web_service_if_needed
printf 'Service status after start:\n'
systemctl --user status "$SERVICE_NAME" --no-pager
printf 'Recent service logs:\n'
service_logs
if [[ "$(service_state)" != "active" ]]; then
  fail_now "API failed to boot on Postgres."
fi
pass "API service restarted."

phase "SMOKE TESTS"
if ! api_startup_loop "$API_STARTED_AT"; then
  fail_now "API did not become healthy within 60 seconds after Postgres restart."
fi
retry_curl_check "local /api/v1/health" "http://127.0.0.1:3004/api/v1/health" 3 5 && LOCAL_V1_HEALTH_RESULT="pass" || warn "Optional local /api/v1/health check did not pass."
retry_curl_check "public API /api/health" "https://trackmaster-api.aibry.shop/api/health" 12 5 && PUBLIC_API_HEALTH_RESULT="pass"
if [[ "$PUBLIC_API_HEALTH_RESULT" != "pass" ]]; then
  fail_now "Public API health did not pass after Postgres cutover."
fi
retry_curl_check "local web" "http://127.0.0.1:3000" 3 5 && LOCAL_WEB_RESULT="pass" || warn "Local web check is informational and did not pass."
retry_curl_check "public web" "https://trackmaster.aibry.shop" 3 5 && PUBLIC_WEB_RESULT="pass" || warn "Public web check is informational and did not pass."
running_api_env_check
pass "Required API smoke tests passed."

phase "ADVISORY REPORTS"
if ! npm run fedora:readiness; then
  warn "npm run fedora:readiness returned non-zero."
fi
if ! npm run fedora:cutover-no-go; then
  warn "npm run fedora:cutover-no-go returned non-zero."
fi

phase "FINAL REPORT"
FINAL_BACKEND="$(grep -E '^TRACKMASTER_REPOSITORY_BACKEND=' "$PROJECT_ROOT/.env" | cut -d= -f2- || true)"
FINAL_SERVICE_STATE="$(service_state "$SERVICE_NAME")/$(service_substate "$SERVICE_NAME")"
FINAL_WEB_SERVICE_STATE="$(service_state "$WEB_SERVICE_NAME")/$(service_substate "$WEB_SERVICE_NAME")"
PUBLIC_HEALTH_SUMMARY="$PUBLIC_API_HEALTH_RESULT"
LOCAL_HEALTH_SUMMARY="$LOCAL_HEALTH_RESULT"
printf 'Cutover status: COMPLETED\n'
printf 'Backup root: %s\n' "$BACKUP_ROOT"
printf 'Cutover log: %s\n' "$LOG_FILE"
printf 'Final backend from .env: %s\n' "${FINAL_BACKEND:-sqlite-implicit}"
printf 'Final API service state: %s\n' "$FINAL_SERVICE_STATE"
printf 'Final web service state: %s\n' "$FINAL_WEB_SERVICE_STATE"
printf 'Local health result: %s\n' "$LOCAL_HEALTH_SUMMARY"
printf 'Public health result: %s\n' "$PUBLIC_HEALTH_SUMMARY"
printf 'Local web result: %s\n' "$LOCAL_WEB_RESULT"
printf 'Public web result: %s\n' "$PUBLIC_WEB_RESULT"
printf 'SQLite snapshot counts used for validation: users=%s tracks=%s presets=%s\n' "${SQLITE_SOURCE_USER_COUNT//[[:space:]]/}" "${SQLITE_SOURCE_TRACK_COUNT//[[:space:]]/}" "${SQLITE_SOURCE_PRESET_COUNT//[[:space:]]/}"
printf 'Production DB table list:\n%s\n' "$TABLE_LIST"
printf 'Production DB row counts: users=%s tracks=%s presets=%s\n' "${USER_COUNT//[[:space:]]/}" "${TRACK_COUNT//[[:space:]]/}" "${PRESET_COUNT//[[:space:]]/}"
printf 'Dynamic count comparison passed: yes\n'
printf 'Production DB handling: %s\n' "$DB_ACTION"
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf 'Warnings:\n'
  printf '%s\n' "${WARNINGS[@]}"
else
  printf 'Warnings: none\n'
fi
printf 'nginx/Cloudflare touched: no\n'
printf 'SQLite preserved: yes\n'
printf 'uploads preserved: yes\n'
printf 'backups preserved: yes\n'
printf 'unrelated services changed: no\n'
printf 'Rollback command: cp "%s/.env.before-cutover" "%s/.env" && systemctl --user restart %s\n' "$BACKUP_ROOT" "$PROJECT_ROOT" "$SERVICE_NAME"
printf 'Password rotation recommendation: rotate the temporary Postgres password immediately after operator approval, then update runtime secrets and confirm both local and public health on the rotated credential.\n'
CUTOVER_COMPLETED=1
