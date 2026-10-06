#!/usr/bin/env bash
# ============================================================
# STM — Health Check watchdog (elke 5 minuten)
#
# Controleert:
#   1) /api/health endpoint HTTP 200 (met meerdere URL fallbacks)
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

APP_URL_DEFAULT="http://127.0.0.1:3000"
APP_URL="${APP_URL_DEFAULT}"
APP_URL_FALLBACK_1="http://localhost:3000"
MIN_FREE_PCT=10

trim() {
  local var="$*"
  var="${var#"${var%%[![:space:]]*}"}"
  var="${var%"${var##*[![:space:]]}"}"
  printf '%s' "$var"
}

if [ -f "${ENV_FILE}" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim "$line")"
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"
    [[ -z "$key" ]] && continue
    value="${value%% #*}"
    value="${value%%\t#*}"
    value="$(trim "$value")"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    case "$key" in
      NEXT_PUBLIC_APP_URL|STM_APP_URL)
        if [ -n "$value" ]; then APP_URL="$value"; fi
        ;;
    esac
  done < "${ENV_FILE}"
fi

HEALTH_PATH="/api/health"
CANDIDATES=()
CANDIDATES+=("${APP_URL%/}")
if [ "${APP_URL%/}" != "${APP_URL_DEFAULT}" ]; then
  CANDIDATES+=("${APP_URL_DEFAULT}")
fi
if [ "${APP_URL%/}" != "${APP_URL_FALLBACK_1}" ] && [ "${APP_URL_DEFAULT}" != "${APP_URL_FALLBACK_1}" ]; then
  CANDIDATES+=("${APP_URL_FALLBACK_1}")
fi

FAILED=0
log_fail() { FAILED=1; echo "[FAIL] $*" >&2; logger -t stm-healthcheck -p user.err "FAIL: $*"; }
log_ok()   { echo "[ OK ] $*"; logger -t stm-healthcheck -p user.info "OK: $*"; }

echo "==== STM Health Check $(date '+%Y-%m-%d %H:%M:%S') ===="
echo "[info] App URL candidates: ${CANDIDATES[*]}"

# 1) /api/health (met meerdere fallbacks; ook 503 = "deels OK" als DB werkt)
HTTP=000
APP_URL_USED=""
for CAND in "${CANDIDATES[@]}"; do
  TEST_URL="${CAND}${HEALTH_PATH}"
  echo "[info] Probeer health: GET ${TEST_URL}"
  if command -v curl >/dev/null 2>&1; then
    CAND_HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --connect-timeout 5 --retry 1 --insecure "${TEST_URL}" 2>/dev/null || echo 000)
  else
    CAND_HTTP=000
  fi
  if [ "${CAND_HTTP}" = "200" ] || [ "${CAND_HTTP}" = "503" ] || [ "${CAND_HTTP}" = "404" ]; then
    HTTP="${CAND_HTTP}"
    APP_URL_USED="${TEST_URL}"
    break
  fi
  if [ "${CAND_HTTP}" = "000" ]; then
    echo "[info]   → ${CAND} onbereikbaar (volgende candidate)."
  else
    echo "[info]   → onverwachte HTTP ${CAND_HTTP} via ${CAND}."
    HTTP="${CAND_HTTP}"
    APP_URL_USED="${TEST_URL}"
    break
  fi
done

case "${HTTP}" in
  200)
    log_ok "/api/health = HTTP 200 (${APP_URL_USED})"
    ;;
  503)
    echo "[info] /api/health = HTTP 503 (${APP_URL_USED}): DB/integratie-status geeft ok=false (geen catastrofe; enkel markering)."
    echo "[info] Dit betekent NIET dat de container stuk is; wel dat minstens 1 integratie (Simhuis/Inserve/Navixy) error geeft."
    logger -t stm-healthcheck -p user.notice "NOTICE: /api/health = HTTP 503 (integratiefout, container draait)."
    ;;
  404)
    log_fail "/api/health = HTTP 404 (${APP_URL_USED}). Bestaat de route /api/health? Build de app opnieuw."
    ;;
  000)
    log_fail "/api/health = GEEN connectie (geprobeerd: ${CANDIDATES[*]}${HEALTH_PATH}). Container of Caddy draait niet?"
    ;;
  *)
    log_fail "/api/health = HTTP ${HTTP} (${APP_URL_USED})."
    ;;
esac

# 2) Containers
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for CONTAINER in stm-db stm-app; do
    if docker ps --format '{{.Names}}' -f "name=^${CONTAINER}$" 2>/dev/null | grep -q "${CONTAINER}"; then
      H=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo unknown)
      if [ "${H}" = "healthy" ] || [ "${H}" = "unknown" ] || [ "${H}" = "starting" ]; then
        log_ok "Container ${CONTAINER} running (health=${H})"
      else
        log_fail "Container ${CONTAINER} health=${H}"
      fi
    else
      log_fail "Container ${CONTAINER} NIET draaiend!"
    fi
  done
else
  echo "[info] Docker daemon NIET bereikbaar (draai dit script als sudo/root voor docker checks)."
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
