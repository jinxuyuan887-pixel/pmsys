#!/usr/bin/env bash
set -Eeuo pipefail

# This script runs on the ECS host. Application images are replaceable; the
# SQLite database and uploaded files always remain in the host data directory.

release_sha="${RELEASE_SHA:?RELEASE_SHA is required}"
image_archive="${IMAGE_ARCHIVE:?IMAGE_ARCHIVE is required}"
migrations_dir="${MIGRATIONS_DIR:?MIGRATIONS_DIR is required}"

app_root="${APP_ROOT:-/opt/pmsys}"
app_name="${APP_NAME:-pmsys-app}"
data_dir="${DATA_DIR:-${app_root}/data}"
backup_root="${BACKUP_ROOT:-${app_root}/backups}"
database_path="${DATABASE_PATH:-${data_dir}/pmsys.sqlite}"
files_dir="${FILES_DIR:-${data_dir}/files}"
gateway_network="${GATEWAY_NETWORK:-ydl-gateway-net}"
host_port="${HOST_PORT:-127.0.0.1:18081}"
health_port="${host_port##*:}"
base_path="${BASE_PATH:-/pmsys}"
baseline_migration="0012_acceptance_payment_closure.sql"

release_id="${release_sha:0:12}"
image="pmsys:${release_sha}"
timestamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="${backup_root}/${release_id}-${timestamp}"
rollback_name="${app_name}-rollback-${release_id}-${timestamp}"
smoke_name="${app_name}-smoke-${release_id}"
smoke_dir="${app_root}/releases/${release_id}/smoke"
lock_file="${app_root}/deploy.lock"

cutover_started=0
old_container_preserved=0
deployment_succeeded=0

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

sql_quote() {
  printf '%s' "${1//\'/\'\'}"
}

database_integrity() {
  local db="$1"
  local result
  result="$(sqlite3 "$db" 'PRAGMA integrity_check;')"
  [[ "$result" == "ok" ]] || fail "database integrity check failed: ${result}"
}

core_counts() {
  local db="$1"
  sqlite3 "$db" \
    "SELECT 'projects', COUNT(*) FROM projects
     UNION ALL SELECT 'service_records', COUNT(*) FROM service_records
     UNION ALL SELECT 'file_attachments', COUNT(*) FROM file_attachments
     UNION ALL SELECT 'delivery_tasks', COUNT(*) FROM delivery_tasks
     UNION ALL SELECT 'users', COUNT(*) FROM users;"
}

initialize_migration_ledger() {
  local db="$1"
  local ledger_count

  sqlite3 "$db" \
    "CREATE TABLE IF NOT EXISTS _pmsys_schema_migrations (
       name TEXT PRIMARY KEY NOT NULL,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     );"
  ledger_count="$(sqlite3 "$db" 'SELECT COUNT(*) FROM _pmsys_schema_migrations;')"
  [[ "$ledger_count" == "0" ]] || return 0

  # The production database predates the ledger. Only adopt it when the known
  # 0012 schema is present; otherwise stop instead of guessing or replaying SQL.
  local baseline_markers
  baseline_markers="$(sqlite3 "$db" \
    "SELECT
       EXISTS(SELECT 1 FROM pragma_table_info('projects') WHERE name='closed_at') +
       EXISTS(SELECT 1 FROM pragma_table_info('service_records') WHERE name='payment_status') +
       EXISTS(SELECT 1 FROM pragma_table_info('file_attachments') WHERE name='project_id') +
       EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_task_records');")"
  [[ "$baseline_markers" == "4" ]] || fail \
    "migration ledger is empty and the database does not match the verified 0012 baseline"

  local migration_file migration_name escaped_name
  while IFS= read -r migration_file; do
    migration_name="$(basename "$migration_file")"
    [[ "$migration_name" > "$baseline_migration" ]] && continue
    escaped_name="$(sql_quote "$migration_name")"
    sqlite3 "$db" \
      "INSERT OR IGNORE INTO _pmsys_schema_migrations(name) VALUES('${escaped_name}');"
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' | sort)
}

apply_pending_migrations() {
  local db="$1"
  local work_dir="$2"
  local migration_file migration_name escaped_name already_applied sql_batch

  initialize_migration_ledger "$db"
  while IFS= read -r migration_file; do
    migration_name="$(basename "$migration_file")"
    escaped_name="$(sql_quote "$migration_name")"
    already_applied="$(sqlite3 "$db" \
      "SELECT COUNT(*) FROM _pmsys_schema_migrations WHERE name='${escaped_name}';")"
    [[ "$already_applied" == "1" ]] && continue

    log "applying migration ${migration_name}"
    sql_batch="${work_dir}/apply-${migration_name}"
    {
      printf '.bail on\n'
      printf 'BEGIN IMMEDIATE;\n'
      printf '.read %s\n' "$migration_file"
      printf "INSERT INTO _pmsys_schema_migrations(name) VALUES('%s');\n" "$escaped_name"
      printf 'COMMIT;\n'
    } > "$sql_batch"
    sqlite3 "$db" < "$sql_batch"
    rm -f "$sql_batch"
    database_integrity "$db"
  done < <(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' | sort)
}

wait_for_health() {
  local url="$1"
  local attempts="${2:-30}"
  local i status
  for ((i = 1; i <= attempts; i += 1)); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$url" || true)"
    [[ "$status" == "200" ]] && return 0
    sleep 2
  done
  return 1
}

network_attached() {
  local container="$1"
  docker inspect --format '{{json .NetworkSettings.Networks}}' "$container" | grep -q "\"${gateway_network}\""
}

rollback() {
  local reason="$1"
  set +e
  trap - ERR
  log "deployment failed (${reason}); starting automatic rollback"

  docker rm -f "$smoke_name" >/dev/null 2>&1

  # If stopping succeeded but renaming did not, the original container still
  # owns the production name. Start it again; never mistake it for a new image.
  if [[ "$old_container_preserved" != "1" ]]; then
    if docker container inspect "$app_name" >/dev/null 2>&1; then
      docker start "$app_name" >/dev/null
    fi
    log "rollback finished before container replacement"
    return
  fi

  if docker container inspect "$app_name" >/dev/null 2>&1; then
    docker stop --time 20 "$app_name" >/dev/null 2>&1
    docker rm "$app_name" >/dev/null 2>&1
  fi

  if [[ -f "${backup_dir}/pmsys.sqlite" ]]; then
    rm -f "${database_path}-wal" "${database_path}-shm"
    cp -p "${backup_dir}/pmsys.sqlite" "$database_path"
  fi

  if [[ "$old_container_preserved" == "1" ]] \
    && docker container inspect "$rollback_name" >/dev/null 2>&1; then
    docker rename "$rollback_name" "$app_name"
    if ! network_attached "$app_name"; then
      docker network connect "$gateway_network" "$app_name"
    fi
    docker start "$app_name" >/dev/null
  fi

  log "rollback finished; preserved backup: ${backup_dir}"
}

on_error() {
  local exit_code=$?
  local line_number="$1"
  if [[ "$cutover_started" == "1" && "$deployment_succeeded" != "1" ]]; then
    rollback "line ${line_number}, exit ${exit_code}"
  fi
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

require_command docker
require_command sqlite3
require_command curl
require_command tar
require_command sha256sum
require_command flock

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "RELEASE_SHA must be a full Git commit SHA"
[[ -f "$image_archive" ]] || fail "image archive not found: ${image_archive}"
[[ -d "$migrations_dir" ]] || fail "migrations directory not found: ${migrations_dir}"
[[ -f "$database_path" ]] || fail "production database not found: ${database_path}"
[[ -d "$files_dir" ]] || fail "file storage directory not found: ${files_dir}"

mkdir -p "$app_root" "$backup_root" "$(dirname "$smoke_dir")"
exec 9>"$lock_file"
flock -n 9 || fail "another deployment is already running"

log "loading immutable image ${image}"
docker load --input "$image_archive" >/dev/null
docker image inspect "$image" >/dev/null
docker network inspect "$gateway_network" >/dev/null
docker container inspect "$app_name" >/dev/null 2>&1 || fail \
  "running application container not found: ${app_name}"

log "preflight database integrity and counts"
database_integrity "$database_path"
preflight_counts="$(core_counts "$database_path")"
printf '%s\n' "$preflight_counts"

cutover_started=1
log "stopping writes and preserving the current container"
docker stop --time 30 "$app_name" >/dev/null
docker rename "$app_name" "$rollback_name"
old_container_preserved=1
if network_attached "$rollback_name"; then
  docker network disconnect "$gateway_network" "$rollback_name"
fi

log "creating a consistent database and attachment backup"
mkdir -p "$backup_dir"
sqlite3 "$database_path" ".timeout 30000" ".backup '${backup_dir}/pmsys.sqlite'"
tar -C "$data_dir" -czf "${backup_dir}/files.tar.gz" "$(basename "$files_dir")"
database_integrity "${backup_dir}/pmsys.sqlite"
core_counts "${backup_dir}/pmsys.sqlite" > "${backup_dir}/core-counts.txt"
sha256sum "${backup_dir}/pmsys.sqlite" "${backup_dir}/files.tar.gz" > "${backup_dir}/SHA256SUMS"
printf 'release=%s\ncreated_at=%s\nold_container=%s\n' \
  "$release_sha" "$(date --iso-8601=seconds)" "$rollback_name" > "${backup_dir}/manifest.txt"

log "testing migrations and the new image against a database copy"
rm -rf "$smoke_dir"
mkdir -p "${smoke_dir}/files"
sqlite3 "${backup_dir}/pmsys.sqlite" ".backup '${smoke_dir}/pmsys.sqlite'"
apply_pending_migrations "${smoke_dir}/pmsys.sqlite" "$smoke_dir"
docker rm -f "$smoke_name" >/dev/null 2>&1 || true
docker run --detach --rm \
  --name "$smoke_name" \
  --publish 127.0.0.1:18082:3000 \
  --env NODE_DATABASE_PATH=/app/data/pmsys.sqlite \
  --env NODE_FILE_STORAGE_PATH=/app/data/files \
  --env NEXT_PUBLIC_BASE_PATH="$base_path" \
  --volume "${smoke_dir}:/app/data" \
  "$image" >/dev/null
wait_for_health "http://127.0.0.1:18082${base_path}/login" 30
docker stop --time 10 "$smoke_name" >/dev/null

log "applying verified migrations to production data"
apply_pending_migrations "$database_path" "$backup_dir"
database_integrity "$database_path"
post_migration_counts="$(core_counts "$database_path")"
printf '%s\n' "$post_migration_counts" > "${backup_dir}/post-migration-core-counts.txt"
[[ "$post_migration_counts" == "$preflight_counts" ]] || fail \
  "core record counts changed during migration; refusing production cutover"

log "starting the new production container"
docker run --detach \
  --name "$app_name" \
  --restart unless-stopped \
  --network "$gateway_network" \
  --publish "${host_port}:3000" \
  --env NODE_DATABASE_PATH=/app/data/pmsys.sqlite \
  --env NODE_FILE_STORAGE_PATH=/app/data/files \
  --env NEXT_PUBLIC_BASE_PATH="$base_path" \
  --volume "${data_dir}:/app/data" \
  "$image" >/dev/null

wait_for_health "http://127.0.0.1:${health_port}${base_path}/login" 30
wait_for_health "http://127.0.0.1${base_path}/login" 15
database_integrity "$database_path"

deployment_succeeded=1
trap - ERR
rm -f "$image_archive"
log "deployment succeeded: ${release_sha}"
log "backup: ${backup_dir}"
log "rollback container retained: ${rollback_name}"
