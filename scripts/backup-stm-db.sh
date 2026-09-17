#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================================
# STM PostgreSQL Backup Script
# Doel: Maak een gecomprimeerd (custom-format) back-up van
# de STM-database, bewaar rotatieregels dag/week/maand,
# log met timestamps en faal expliciet.
#
# Gebruik (optioneel met params, valt terug op defaults van
# docker-compose.prod.yml of .env.production):
#   ./scripts/backup-stm-db.sh
#   BACKUP_DIR=/backup/stm BACKUP_KEEP_DAILY=10 ./scripts/backup-stm-db.sh
#
# Running binnen VPS (na deploy):
#   /opt/stm/scripts/backup-stm-db.sh (zie deploy-stm.sh installatie)
#
# Running via systemd timer:
#   systemctl enable --now stm-db-backup.timer
#
# Running in Docker-host modus (geen lokale Postgres client):
#   BACKUP_MODE=docker ./scripts/backup-stm-db.sh
#   (draait pg_dump d.m.v. docker exec naar stm-db container)
# ============================================================

log() {
  local level="$1"
  shift
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf '[%s] [%5s] %s\n' "$ts" "$level" "$*" >&2
}
trap 'log "ERROR" "backup-stm-db.sh gefaald op regel ${LINENO} (exit $?)"' ERR

# --- Configuratie (omgevingsvariabelen of defaults) ---
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"

# Resolve .env.production indien aanwezig (deployed VPS) of .env.local/.env
for f in \
  "${PROJECT_DIR}/.env.production" \
  "${PROJECT_DIR}/.env.local" \
  "${PROJECT_DIR}/.env"; do
  if [ -f "$f" ]; then
    # shellcheck disable=SC1090
    set -a; . "$f"; set +a
  fi
done

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"   # laatste X dagelijkse backups
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}" # laatste X weekelijkse (maandag)
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-3}" # laatste X maandelijkse (1e dag)

# DB instellingen — volg docker-compose.prod.yml defaults
DB_USER="${POSTGRES_USER:-${DB_USER:-stm}}"
DB_NAME="${POSTGRES_DB:-${DB_NAME:-stm}}"
DB_PORT="${DB_PORT:-5432}"
DB_HOST="${DB_HOST:-127.0.0.1}"

# BACKUP_MODE: local | docker. Default local → probeer docker als
# pg_dump niet gevonden en docker aanwezig + container stm-db running.
BACKUP_MODE="${BACKUP_MODE:-auto}"

DOCKER_DB_CONTAINER="${DOCKER_DB_CONTAINER:-stm-db}"

# ============================================================
# Pre-flight checks
# ============================================================
log "INFO" "Project: ${PROJECT_DIR}"
log "INFO" "Backup directory: ${BACKUP_DIR}"
log "INFO" "DB: postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

if [ ! -d "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  log "INFO" "Aangemaakt: ${BACKUP_DIR}"
fi

# Autodetect BACKUP_MODE
if [ "$BACKUP_MODE" = "auto" ]; then
  if command -v pg_dump >/dev/null 2>&1; then
    BACKUP_MODE="local"
  elif command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | grep -qx "$DOCKER_DB_CONTAINER"; then
      BACKUP_MODE="docker"
      log "INFO" "pg_dump niet gevonden; gekozen BACKUP_MODE=docker (container ${DOCKER_DB_CONTAINER})"
    else
      log "WARN" "pg_dump niet gevonden, en container ${DOCKER_DB_CONTAINER} niet running."
      log "ERROR" "Kan backup niet starten. Zorg voor lokale pg_dump of start Docker stack."
      exit 2
    fi
  else
    log "ERROR" "Geen pg_dump en geen docker. Installeer postgresql-client of Docker."
    exit 2
  fi
fi

# ============================================================
# Variabelen
# ============================================================
DATE="$(date '+%Y-%m-%d_%H%M%S')"
DAY_OF_WEEK="$(date '+%u')"  # 1=maandag … 7=zondag
DAY_OF_MONTH="$(date '+%d')"
BASE_FILE="stm_${DB_NAME}_${DATE}.pgdump"
DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
MONTHLY_DIR="${BACKUP_DIR}/monthly"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"
touch "$LOG_FILE"

# Zorg dat log ook naar logfile gaat
exec 3>&1 4>&2
exec >> >(tee -a "$LOG_FILE") 2>&1

run_pg_dump() {
  local outfile="$1"
  if [ "$BACKUP_MODE" = "local" ]; then
    # Locale pg_dump — PGPASSWORD wordt niet required als peer of .pgpass,
    # maar we proberen POSTGRES_PASSWORD/DB_PASSWORD als fallback
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
      PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
        -U "$DB_USER" \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -d "$DB_NAME" \
        --format=custom \
        --compress=zstd:6 \
        --no-owner \
        --no-privileges \
        --file "$outfile"
    else
      pg_dump \
        -U "$DB_USER" \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -d "$DB_NAME" \
        --format=custom \
        --compress=zstd:6 \
        --no-owner \
        --no-privileges \
        --file "$outfile"
    fi
  else
    # Docker mode: stuur pg_dump commando naar container, stream output lokaal
    docker exec \
      -e PGPASSWORD="${POSTGRES_PASSWORD:-}" \
      "$DOCKER_DB_CONTAINER" \
      pg_dump \
        -U "$DB_USER" \
        -h 127.0.0.1 \
        -p 5432 \
        -d "$DB_NAME" \
        --format=custom \
        --compress=zstd:6 \
        --no-owner \
        --no-privileges \
        --file "/tmp/${BASE_FILE}"
    docker cp "${DOCKER_DB_CONTAINER}:/tmp/${BASE_FILE}" "$outfile"
    # Tijdelijk bestand in container opruimen (best-effort)
    docker exec "$DOCKER_DB_CONTAINER" rm -f "/tmp/${BASE_FILE}" 2>/dev/null || true
  fi
}

# ============================================================
# Uitvoer
# ============================================================
log "INFO" "=== Start backup ${DATE} (mode=${BACKUP_MODE}) ==="
DAILY_FILE="${DAILY_DIR}/${BASE_FILE}"

START_TS=$(date +%s)
run_pg_dump "$DAILY_FILE"
END_TS=$(date +%s)

SIZE_BYTES=$(wc -c <"$DAILY_FILE")
SIZE_HUMAN=$(du -h "$DAILY_FILE" | awk '{print $1}')
log "INFO" "Dagelijkse backup geschreven: ${DAILY_FILE} (${SIZE_HUMAN}, ${END_TS}-${START_TS}s)"

# Schrijf metadata manifest zodat restoren eenvoudig is
MANIFEST="${DAILY_FILE}.manifest.txt"
{
  echo "date=${DATE}"
  echo "project_dir=${PROJECT_DIR}"
  echo "db_user=${DB_USER}"
  echo "db_name=${DB_NAME}"
  echo "db_host=${DB_HOST}"
  echo "backup_mode=${BACKUP_MODE}"
  echo "format=custom (pg_restore)"
  echo "file_size_bytes=${SIZE_BYTES}"
  echo "file_size_human=${SIZE_HUMAN}"
  echo "duration_sec=$((END_TS - START_TS))"
  echo "sha256=$(sha256sum "$DAILY_FILE" | awk '{print $1}')"
} > "$MANIFEST"
log "INFO" "Manifest: ${MANIFEST}"

# Copy naar weekly op MAANDAG (dayofweek=1)
if [ "$DAY_OF_WEEK" = "1" ]; then
  WEEKLY_FILE="${WEEKLY_DIR}/stm_${DB_NAME}_week_$(date '+%G%V').pgdump"
  cp -f "$DAILY_FILE" "$WEEKLY_FILE"
  cp -f "$MANIFEST" "${WEEKLY_FILE}.manifest.txt"
  log "INFO" "Weekelijkse backup geschreven: ${WEEKLY_FILE}"
fi

# Copy naar monthly op 1e dag van de maand
if [ "$DAY_OF_MONTH" = "01" ]; then
  MONTHLY_FILE="${MONTHLY_DIR}/stm_${DB_NAME}_month_$(date '+%Y-%m').pgdump"
  cp -f "$DAILY_FILE" "$MONTHLY_FILE"
  cp -f "$MANIFEST" "${MONTHLY_FILE}.manifest.txt"
  log "INFO" "Maandelijkse backup geschreven: ${MONTHLY_FILE}"
fi

# ============================================================
# Rotatie (laatste N houden, op datum gesorteerd — glob NIEUW → OUD)
# ============================================================
rotate() {
  local dir="$1"
  local keep="$2"
  local prefix="$3"
  local files
  # Map naar array
  mapfile -t files < <(find "$dir" -maxdepth 1 -name "${prefix}*.pgdump" -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk '{print $2}')
  local total="${#files[@]}"
  if [ "$total" -le "$keep" ]; then
    log "INFO" "Rotatie ${dir}: ${total}/${keep} backups — geen opschoning."
    return 0
  fi
  local i=0
  for f in "${files[@]}"; do
    i=$((i+1))
    if [ "$i" -gt "$keep" ]; then
      rm -f "$f"
      rm -f "${f}.manifest.txt"
      log "INFO" "Opgeruimd: ${f}"
    fi
  done
}

rotate "$DAILY_DIR"    "$BACKUP_KEEP_DAILY"   "stm_"
rotate "$WEEKLY_DIR"   "$BACKUP_KEEP_WEEKLY"  "stm_"
rotate "$MONTHLY_DIR"  "$BACKUP_KEEP_MONTHLY" "stm_"

# Optioneel offsite rsync (indien STM_BACKUP_RSYNC_TARGET is gezet)
if [ -n "${STM_BACKUP_RSYNC_TARGET:-}" ]; then
  log "INFO" "Offsite rsync naar ${STM_BACKUP_RSYNC_TARGET} …"
  if command -v rsync >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    rsync -a ${STM_BACKUP_RSYNC_OPTS:-} \
      "${BACKUP_DIR}/" \
      "${STM_BACKUP_RSYNC_TARGET%/}/"
    log "INFO" "Offsite rsync voltooid."
  else
    log "WARN" "STM_BACKUP_RSYNC_TARGET ingesteld maar rsync niet geïnstalleerd. Skip offsite."
  fi
fi

# Restore-tip printen in log (1x per run, bovenaan te zien via lastlog)
log "INFO" "Restore-tip: pg_restore -U ${DB_USER} -d <lege_db> --format=custom ${DAILY_FILE}"
log "INFO" "=== Einde backup ${DATE} (duur $((END_TS - START_TS))s, ${SIZE_HUMAN}) OK ==="

exec 1>&3 2>&4 3>&- 4>&-
exit 0
