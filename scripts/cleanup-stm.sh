#!/usr/bin/env bash
# ============================================================
# STM — Periodieke cleanup (wekelijks: zondag 04:00)
#
# Doet:
#   1) Opschonen audit logs ouder dan 90 dagen (optioneel)
#   2) Roteren/compressie van logbestanden in /var/log/stm-install
#   3) Opruimen Docker ongebruikte images/volumes > 7d
#   4) Opruimen temp bestanden in INSTALL_DIR/tmp ouder dan 1d
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/cleanup-stm.sh
# ============================================================
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

AUDIT_LOG_RETENTION_DAYS=90
INSTALL_LOG_RETENTION_DAYS=30
DOCKER_PRUNE=1

if [ -f "${ENV_FILE}" ]; then
  while IFS='= ' read -r key value; do
    [[ -z "${key}" || "${key}" == \#* ]] && continue
    value="${value%\"}"
    value="${value#\"}"
    case "${key}" in
      STM_AUDIT_LOG_RETENTION_DAYS) AUDIT_LOG_RETENTION_DAYS="${value}" ;;
      STM_INSTALL_LOG_RETENTION_DAYS) INSTALL_LOG_RETENTION_DAYS="${value}" ;;
      STM_DOCKER_PRUNE) DOCKER_PRUNE="${value}" ;;
    esac
  done < "${ENV_FILE}"
fi

log() { printf '[%s] [%5s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$1" "$2"; }

log "INFO" "=== Start STM cleanup ==="
log "INFO" "Werkdir: ${WORKDIR}"
log "INFO" "Audit retention: ${AUDIT_LOG_RETENTION_DAYS}d; Install log retention: ${INSTALL_LOG_RETENTION_DAYS}d; Docker prune: ${DOCKER_PRUNE}"

# 1) Audit logs cleanups (via DB in stm-app container)
if docker ps --format '{{.Names}}' -f name='^stm-app$' 2>/dev/null | grep -q 'stm-app'; then
  log "INFO" "Audit logs: opschonen > ${AUDIT_LOG_RETENTION_DAYS} dagen in DB"
  AUDIT_SQL="DELETE FROM \"AuditLog\" WHERE \"createdAt\" < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days';"
  if docker ps --format '{{.Names}}' -f name='^stm-db$' 2>/dev/null | grep -q 'stm-db'; then
    DB_USER="$(grep -E '^POSTGRES_USER=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || echo stm)"
    DB_NAME="$(grep -E '^POSTGRES_DB=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || echo stm)"
    COUNT_BEFORE=$(docker exec -i stm-db psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT count(*) FROM \"AuditLog\" WHERE \"createdAt\" < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days';" 2>/dev/null | tr -d ' \n' || echo "?")
    log "INFO" "  Te verwijderen audit rijen (schatting): ${COUNT_BEFORE}"
    docker exec -i stm-db psql -U "${DB_USER}" -d "${DB_NAME}" -c "${AUDIT_SQL}" 2>&1 | tee >(while read -r line; do log "SQL" "$line"; done) || true
  fi
else
  log "WARN" "stm-app container niet draaiend; audit-log cleanup overgeslagen."
fi

# 2) Install logs
if [ -d "/var/log/stm-install" ]; then
  log "INFO" "/var/log/stm-install: bestanden > ${INSTALL_LOG_RETENTION_DAYS}d opruimen"
  find /var/log/stm-install -type f -mtime +"${INSTALL_LOG_RETENTION_DAYS}" -print -delete 2>&1 | while read -r f; do log "CLEAN" "${f}"; done || true
else
  log "WARN" "/var/log/stm-install bestaat niet; overgeslagen."
fi

# 3) Docker prune (alleen ongebruikte images > 7d, GEEN volumes weggooien!)
if [ "${DOCKER_PRUNE}" = "1" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "INFO" "Docker: niet-gebruikte images > 7d opruimen (image prune -af --filter until=168h)"
  docker image prune -af --filter "until=168h" 2>&1 | tail -3 | while read -r line; do log "DKR" "$line"; done || true
  log "INFO" "Docker: dangling build cache opruimen"
  docker builder prune -f 2>&1 | tail -2 | while read -r line; do log "DKR" "$line"; done || true
fi

# 4) Temp bestanden in werkdir
if [ -d "${WORKDIR}/tmp" ]; then
  log "INFO" "${WORKDIR}/tmp: bestanden > 1d opruimen"
  find "${WORKDIR}/tmp" -type f -mtime +1 -print -delete 2>&1 | while read -r f; do log "CLEAN" "${f}"; done || true
fi

log "INFO" "=== Einde STM cleanup OK ==="
exit 0
