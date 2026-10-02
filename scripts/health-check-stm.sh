#!/usr/bin/env bash
# ============================================================
# STM — Health Check watchdog (elke 5 minuten)
#
# Controleert:
#   1) /api/health endpoint HTTP 200
#   2) Postgres container healthy
#   3) Next.js container healthy
#   4) Schijfruimte > 10% vrij
# Bij falen: schrijft expliciet naar syslog + exit != 0
# (cron/systemd kan hierop mailen via OnFailure/MAILTO)
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/health-check-stm.sh
# ============================================================
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

APP_URL="http://127.0.0.1:3000"
MIN_FREE_PCT=10
if [ -f "${ENV_FILE}" ]; then
  APP_URL_ENV="$(grep -E '^NEXT_PUBLIC_APP_URL=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || true)"
  [ -n "${APP_URL_ENV}" ] && APP_URL="${APP_URL_ENV}"
fi

APP_URL_HEALTH="${APP_URL%/}/api/health"

FAILED=0
log_fail() { FAILED=1; echo "[FAIL] $*" >&2; logger -t stm-healthcheck -p user.err "FAIL: $*"; }
log_ok()   { echo "[ OK ] $*"; logger -t stm-healthcheck -p user.info "OK: $*"; }

echo "==== STM Health Check $(date '+%Y-%m-%d %H:%M:%S') ===="

# 1) /api/health
HTTP=000
if command -v curl >/dev/null 2>&1; then
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --connect-timeout 5 --retry 1 --insecure "${APP_URL_HEALTH}" 2>/dev/null || echo 000)
fi
if [ "${HTTP}" = "200" ]; then
  log_ok "/api/health = HTTP 200 (${APP_URL_HEALTH})"
else
  log_fail "/api/health = HTTP ${HTTP} (${APP_URL_HEALTH})"
fi

# 2) Containers
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for CONTAINER in stm-db stm-app; do
    if docker ps --format '{{.Names}}' -f "name=^${CONTAINER}$" 2>/dev/null | grep -q "${CONTAINER}"; then
      H=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo unknown)
      if [ "${H}" = "healthy" ] || [ "${H}" = "unknown" ]; then
        log_ok "Container ${CONTAINER} running (health=${H})"
      else
        log_fail "Container ${CONTAINER} health=${H}"
      fi
    else
      log_fail "Container ${CONTAINER} NIET draaiend!"
    fi
  done
else
  log_fail "Docker daemon NIET bereikbaar"
fi

# 3) Schijfruimte INSTALL_DIR
FREE_PCT=$(df -Pk "${WORKDIR}" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); printf "%d", 100-$5}' || echo 0)
if [ "${FREE_PCT}" -ge "${MIN_FREE_PCT}" ]; then
  log_ok "Schijfruimte ${WORKDIR}: ${FREE_PCT}% vrij (min ${MIN_FREE_PCT}%)"
else
  log_fail "Schijfruimte ${WORKDIR}: TE WEINIG (${FREE_PCT}% vrij, min ${MIN_FREE_PCT}%)"
fi

# 4) Geheugen
if command -v free >/dev/null 2>&1; then
  RAM_INFO="$(free -h | awk '/^Mem:/ {print "free="$4" / total="$2}')"
  log_ok "RAM: ${RAM_INFO}"
fi

# 5) Swap
if command -v free >/dev/null 2>&1; then
  SWAP_INFO="$(free -h | awk '/^Swap:/ {print "free="$4" / total="$2}')"
  log_ok "Swap: ${SWAP_INFO}"
fi

echo "==== Einde health check — rc=${FAILED} ===="
exit "${FAILED}"
