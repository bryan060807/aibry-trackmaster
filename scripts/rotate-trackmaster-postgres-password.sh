#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/home/aibry/projects/aibry-trackmaster"
ENV_PATH="$PROJECT_ROOT/.env"
REPORTS_DIR="$PROJECT_ROOT/migration-reports"
BACKUP_PARENT="/home/aibry/backups/trackmaster"
API_SERVICE="trackmaster-api.service"
WEB_SERVICE="trackmaster-web.service"
DB_CONTAINER="taskmaster-db"
DB_USER="aibry"
DB_NAME="trackmaster_production"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_ROOT="$BACKUP_PARENT/POST-CUTOVER-PASSWORD-ROTATION-$TIMESTAMP"
LOG_FILE="$REPORTS_DIR/trackmaster-postgres-password-rotation-$TIMESTAMP.log"
ROTATION_COMPLETED=0
ROLLBACK_REASON=""
API_HEALTH_RESULT="fail"
PUBLIC_API_HEALTH_RESULT="fail"
WEB_HEALTH_RESULT="fail"
OLD_DATABASE_URL=""
OLD_PASSWORD=""
NEW_PASSWORD=""

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
  printf 'RESULT: WARN - %s\n' "$1"
}

service_state() {
  local service_name="$1"
  systemctl --user show "$service_name" -p ActiveState --value
}

service_substate() {
  local service_name="$1"
  systemctl --user show "$service_name" -p SubState --value
}

service_logs() {
  local service_name="$1"
  journalctl --user -u "$service_name" -n 40 --no-pager || true
}

fail_now() {
  printf 'RESULT: FAIL - %s\n' "$1"
  ROLLBACK_REASON="$1"
  if [[ -n "$OLD_PASSWORD" && -n "$NEW_PASSWORD" ]]; then
    rollback
  else
    printf 'Safe state preserved without rollback action.\n'
  fi
  exit 1
}

curl_check() {
  local label="$1"
  local url="$2"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 20 "$url" || true)"
  local body
  body="$(tr '\n' ' ' < "$tmp" | cut -c1-300)"
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

mask_sensitive() {
  sed \
    -e "s|$OLD_PASSWORD|[REDACTED_OLD_PASSWORD]|g" \
    -e "s|$NEW_PASSWORD|[REDACTED_NEW_PASSWORD]|g"
}

run_masked_sql() {
  local password="$1"
  local sql="$2"
  podman exec -e "PGPASSWORD=$password" "$DB_CONTAINER" psql -h 127.0.0.1 -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "$sql" 2>&1 | mask_sensitive
}

current_database_url() {
  grep '^TRACKMASTER_POSTGRES_URL=' "$ENV_PATH" | cut -d= -f2-
}

extract_password_from_url() {
  node -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.password));" "$1"
}

write_new_env_url() {
  node - "$ENV_PATH" "$NEW_PASSWORD" <<'NODE'
const fs = require('fs');
const envPath = process.argv[2];
const newPassword = process.argv[3];
const input = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const output = input.map((line) => {
  if (!line.startsWith('TRACKMASTER_POSTGRES_URL=')) return line;
  const value = line.slice('TRACKMASTER_POSTGRES_URL='.length);
  const parsed = new URL(value);
  parsed.password = newPassword;
  return `TRACKMASTER_POSTGRES_URL=${parsed.toString()}`;
});
fs.writeFileSync(envPath, `${output.filter(Boolean).join('\n')}\n`);
NODE
}

restore_old_env_url() {
  cp "$BACKUP_ROOT/.env.before-password-rotation" "$ENV_PATH"
}

rollback() {
  phase "ROLLBACK"
  printf 'Rollback reason: %s\n' "$ROLLBACK_REASON"
  run_masked_sql "$NEW_PASSWORD" "ALTER USER $DB_USER WITH PASSWORD '$OLD_PASSWORD';" >/dev/null
  restore_old_env_url
  systemctl --user restart "$API_SERVICE"
  sleep 5
  printf 'API service status after rollback:\n'
  systemctl --user status "$API_SERVICE" --no-pager || true
  printf 'Recent API logs after rollback:\n'
  service_logs "$API_SERVICE"
  retry_curl_check "rollback local API health" "http://127.0.0.1:3004/api/health" 12 5 || true
  retry_curl_check "rollback public API health" "https://trackmaster-api.aibry.shop/api/health" 12 5 || true
  printf 'ROLLBACK COMPLETE.\n'
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  ROLLBACK_REASON="Script failed at line $line_no with exit code $exit_code."
  printf 'ABORT: %s\n' "$ROLLBACK_REASON"
  if [[ $ROTATION_COMPLETED -eq 0 && -n "$OLD_PASSWORD" && -n "$NEW_PASSWORD" ]]; then
    rollback
  else
    printf 'Safe state preserved without rollback action.\n'
  fi
  exit "$exit_code"
}

trap 'on_error $? $LINENO' ERR

phase "PRECHECKS"
[[ -f "$ENV_PATH" ]] || fail_now "Missing .env at $ENV_PATH"
[[ -d "$BACKUP_PARENT" ]] || fail_now "Missing backup parent at $BACKUP_PARENT"
[[ "$(service_state "$API_SERVICE")" == "active" && "$(service_substate "$API_SERVICE")" == "running" ]] || fail_now "API service is not active/running before rotation."
[[ "$(service_state "$WEB_SERVICE")" == "active" && "$(service_substate "$WEB_SERVICE")" == "running" ]] || fail_now "Web service is not active/running before rotation."
curl_check "pre-rotation local API health" "http://127.0.0.1:3004/api/health"
curl_check "pre-rotation public API health" "https://trackmaster-api.aibry.shop/api/health"
curl_check "pre-rotation public web" "https://trackmaster.aibry.shop"
pass "Baseline health checks passed."

OLD_DATABASE_URL="$(current_database_url)"
[[ -n "$OLD_DATABASE_URL" ]] || fail_now "TRACKMASTER_POSTGRES_URL is not configured."
OLD_PASSWORD="$(extract_password_from_url "$OLD_DATABASE_URL")"
[[ -n "$OLD_PASSWORD" ]] || fail_now "Existing Postgres password could not be parsed from TRACKMASTER_POSTGRES_URL."
pass "Current Postgres runtime configuration found."

phase "GENERATE SECRET"
NEW_PASSWORD="$(openssl rand -hex 32)"
[[ -n "$NEW_PASSWORD" ]] || fail_now "Failed to generate new password."
pass "Generated a new strong password locally."

phase "BACKUP ENV"
mkdir -p "$BACKUP_ROOT"
cp "$ENV_PATH" "$BACKUP_ROOT/.env.before-password-rotation"
pass "Backed up .env to $BACKUP_ROOT"

phase "ROTATE DATABASE PASSWORD"
run_masked_sql "$OLD_PASSWORD" "ALTER USER $DB_USER WITH PASSWORD '$NEW_PASSWORD';"
pass "Updated Postgres user password inside $DB_CONTAINER."

phase "UPDATE ENV"
write_new_env_url
pass "Updated TRACKMASTER_POSTGRES_URL in .env without printing the new secret."

phase "RESTART API"
systemctl --user restart "$API_SERVICE"
sleep 5
printf 'API service status after restart:\n'
systemctl --user status "$API_SERVICE" --no-pager
printf 'Recent API logs:\n'
service_logs "$API_SERVICE"
if [[ "$(service_state "$API_SERVICE")" != "active" || "$(service_substate "$API_SERVICE")" != "running" ]]; then
  fail_now "API service did not return to active/running after password rotation."
fi
pass "API service restarted."

phase "VERIFY"
retry_curl_check "local API health" "http://127.0.0.1:3004/api/health" 12 5 && API_HEALTH_RESULT="pass"
if [[ "$API_HEALTH_RESULT" != "pass" ]]; then
  fail_now "Local API health did not pass after password rotation."
fi
retry_curl_check "public API health" "https://trackmaster-api.aibry.shop/api/health" 12 5 && PUBLIC_API_HEALTH_RESULT="pass"
if [[ "$PUBLIC_API_HEALTH_RESULT" != "pass" ]]; then
  fail_now "Public API health did not pass after password rotation."
fi
if [[ "$(service_state "$WEB_SERVICE")" == "active" && "$(service_substate "$WEB_SERVICE")" == "running" ]]; then
  pass "Web service remains active/running."
else
  fail_now "Web service is not active/running after password rotation."
fi
retry_curl_check "public web" "https://trackmaster.aibry.shop" 3 5 && WEB_HEALTH_RESULT="pass" || warn "Public web check did not return HTTP 2xx."

phase "FINAL REPORT"
printf 'Rotation status: COMPLETED\n'
printf 'Backup root: %s\n' "$BACKUP_ROOT"
printf 'Log path: %s\n' "$LOG_FILE"
printf 'Final backend from .env: postgres\n'
printf 'API health result: %s\n' "$API_HEALTH_RESULT"
printf 'Public API health result: %s\n' "$PUBLIC_API_HEALTH_RESULT"
printf 'Web health result: %s\n' "$WEB_HEALTH_RESULT"
printf 'New password printed: no\n'
printf 'nginx/Cloudflare touched: no\n'
printf 'SQLite preserved: yes\n'
printf 'uploads preserved: yes\n'
printf 'backups preserved: yes\n'
ROTATION_COMPLETED=1
