#!/usr/bin/env bash
# ============================================================
# STM — Inserve Subscriptions + Invoices Sync trigger (every 5 min via systemd)
#
# Roept de Next.js API route /api/integrations/inserve/sync
# aan met Bearer auth + X-Sync-Triggered-By header.
# Ververkt Schedule Guard (skipped=true => exit 0, geen fout).
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/sync-inserve-invoices.sh
# ============================================================
set -Eeuo pipefail

trap 'TS="$(date "+%Y-%m-%dT%H:%M:%S%z")"; echo "[${TS}] [fout] Script $0 faalde op regel $LINENO: exit code $?" >&2' ERR

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

APP_URL_DEFAULT="http://127.0.0.1:3000"
APP_URL="${APP_URL_DEFAULT}"
APP_URL_FALLBACK_1="http://localhost:3000"
API_TOKEN=""

log() {
  local ts
  ts="$(date "+%Y-%m-%dT%H:%M:%S%z")"
  echo "[${ts}] $*"
}

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
      SIMHUIS_SYNC_API_TOKEN)
        API_TOKEN="$value"
        ;;
    esac
  done < "${ENV_FILE}"
else
  log "[warn] Geen .env bestand gevonden in ${WORKDIR}. STM_APP_URL en SIMHUIS_SYNC_API_TOKEN worden uit environment gehaald."
  APP_URL="${STM_APP_URL:-${APP_URL}}"
  API_TOKEN="${SIMHUIS_SYNC_API_TOKEN:-}"
fi

if [ -z "${API_TOKEN}" ]; then
  log "[fout] SIMHUIS_SYNC_API_TOKEN is niet gezet in .env of environment. Kan Inserve-sync niet uitvoeren."
  log "[hint] Voeg toe aan ${ENV_FILE}: SIMHUIS_SYNC_API_TOKEN=$(openssl rand -hex 24 2>/dev/null || echo '<genereer-een-random-token>')"
  exit 2
fi

TOKEN_LEN="${#API_TOKEN}"
log "[info] API token geladen (lengte=${TOKEN_LEN}). App URL (via .env/env): ${APP_URL}"

SYNC_PATH="/api/integrations/inserve/sync"
CANDIDATES=()
CANDIDATES+=("${APP_URL%/}")
if [ "${APP_URL%/}" != "${APP_URL_DEFAULT}" ]; then
  CANDIDATES+=("${APP_URL_DEFAULT}")
fi
if [ "${APP_URL%/}" != "${APP_URL_FALLBACK_1}" ] && [ "${APP_URL_DEFAULT}" != "${APP_URL_FALLBACK_1}" ]; then
  CANDIDATES+=("${APP_URL_FALLBACK_1}")
fi

HTTP_CODE=000
BODY=""
USED_URL=""
RESPONSE_FILE="$(mktemp)"

for CAND in "${CANDIDATES[@]}"; do
  TEST_URL="${CAND}${SYNC_PATH}"
  log "[info] Probeer endpoint: POST ${TEST_URL}"
  CAND_HTTP=$(curl -sS -o "${RESPONSE_FILE}" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "X-Sync-Triggered-By: systemd-timer" \
    -H "Content-Type: application/json" \
    --max-time 1800 \
    --connect-timeout 10 \
    "${TEST_URL}" 2>/dev/null || true)
  CAND_BODY="$(cat "${RESPONSE_FILE}" 2>/dev/null || echo "")"
  if [ "${CAND_HTTP}" = "200" ] || [ "${CAND_HTTP}" = "403" ] || [ "${CAND_HTTP}" = "500" ] || [ "${CAND_HTTP}" = "503" ]; then
    HTTP_CODE="${CAND_HTTP}"
    BODY="${CAND_BODY}"
    USED_URL="${TEST_URL}"
    break
  fi
  if [ "${CAND_HTTP}" = "000" ]; then
    log "[info]   → connectie naar ${CAND} mislukt (geen antwoord; volgende candidate)."
  else
    log "[info]   → onverwachte HTTP ${CAND_HTTP} via ${CAND} (volgende candidate)."
  fi
done

if [ -z "${USED_URL}" ]; then
  HTTP_CODE=000
  BODY=""
fi
rm -f "${RESPONSE_FILE}"

log "[info] Uiteindelijke call: ${USED_URL:-<geen endpoint bereikbaar>} → HTTP ${HTTP_CODE}"
if [ -n "${BODY}" ]; then
  log "[info] Response body:"
  echo "${BODY}"
fi

if [ "${HTTP_CODE}" = "000" ]; then
  log "[fout] Inserve-sync kon GEEN ENKEL endpoint bereiken."
  log "[hint] Geprobeerde URL's:"
  for CAND in "${CANDIDATES[@]}"; do echo "       - ${CAND}${SYNC_PATH}"; done
  log "[hint] Controleer: 'docker ps | grep stm-app', of Caddy reverse proxy draait."
  exit 1
fi

if [ "${HTTP_CODE}" = "403" ]; then
  log "[fout] Inserve-sync: 403 Forbidden. Host-token SIMHUIS_SYNC_API_TOKEN ≠ container token."
  log "[hint] Host: grep SIMHUIS_SYNC_API_TOKEN ${ENV_FILE}  |  Container: docker exec stm-app printenv SIMHUIS_SYNC_API_TOKEN"
  exit 1
fi

if [ "${HTTP_CODE}" != "200" ]; then
  log "[fout] Inserve-sync mislukt (HTTP ${HTTP_CODE})."
  exit 1
fi

if echo "${BODY}" | grep -q '"ok"\s*:\s*true'; then
  if echo "${BODY}" | grep -q '"skipped"\s*:\s*true'; then
    REASON="$(echo "${BODY}" | grep -o '"reason"\s*:\s*"[^"]*"' | head -n1 || true)"
    log "[skip] Inserve-sync overgeslagen door Schedule Guard: ${REASON}"
  else
    log "[ok] Inserve-sync voltooid."
  fi
  exit 0
else
  log "[fout] Inserve-sync retourneerde ok=false."
  exit 1
fi
