#!/usr/bin/env bash
# ============================================================
# STM — Simhuis SIM-voorraad Sync trigger (every 15 min via systemd)
#
# Roept de Next.js API route /api/integrations/simhuis/sync-sims
# aan met Bearer auth + X-Sync-Triggered-By header.
# Ververkt Schedule Guard (skipped=true => exit 0, geen fout).
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/sync-simhuis-sims.sh
# ============================================================
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

APP_URL_DEFAULT="http://127.0.0.1:3000"
APP_URL="${APP_URL_DEFAULT}"
APP_URL_FALLBACK_1="http://localhost:3000"
API_TOKEN=""

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
  echo "[warn] Geen .env bestand gevonden in ${WORKDIR}. STM_APP_URL en SIMHUIS_SYNC_API_TOKEN worden uit environment gehaald."
  APP_URL="${STM_APP_URL:-${APP_URL}}"
  API_TOKEN="${SIMHUIS_SYNC_API_TOKEN:-}"
fi

if [ -z "${API_TOKEN}" ]; then
  echo "[fout] SIMHUIS_SYNC_API_TOKEN is niet gezet in .env of environment. Kan sims-sync niet uitvoeren."
  echo "[hint] Voeg toe aan ${ENV_FILE}: SIMHUIS_SYNC_API_TOKEN=$(openssl rand -hex 24 2>/dev/null || echo '<genereer-een-random-token>')"
  exit 2
fi

TOKEN_LEN="${#API_TOKEN}"
echo "[info] API token geladen (lengte=${TOKEN_LEN}). App URL (via .env/env): ${APP_URL}"

SYNC_PATH="/api/integrations/simhuis/sync-sims"
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
  echo "[info] Probeer endpoint: POST ${TEST_URL}"
  CAND_HTTP=$(curl -sS -o "${RESPONSE_FILE}" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "X-Sync-Triggered-By: systemd-timer" \
    -H "Content-Type: application/json" \
    --max-time 900 \
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
    echo "[info]   → connectie naar ${CAND} mislukt (volgende candidate)."
  else
    echo "[info]   → onverwachte HTTP ${CAND_HTTP} via ${CAND} (volgende candidate)."
  fi
done

if [ -z "${USED_URL}" ]; then
  HTTP_CODE=000
  BODY=""
fi
rm -f "${RESPONSE_FILE}"

echo "[info] Uiteindelijke call: ${USED_URL:-<geen endpoint bereikbaar>} → HTTP ${HTTP_CODE}"
[ -n "${BODY}" ] && echo "${BODY}"

if [ "${HTTP_CODE}" = "000" ]; then
  echo "[fout] Sims-sync kon GEEN ENKEL endpoint bereiken."
  echo "[hint] Geprobeerd:"
  for CAND in "${CANDIDATES[@]}"; do echo "       - ${CAND}${SYNC_PATH}"; done
  echo "[hint] Controleer: docker ps | grep stm-app ; docker exec stm-app curl -s http://127.0.0.1:3000/api/health --max-time 5"
  exit 1
fi

if [ "${HTTP_CODE}" = "403" ]; then
  echo "[fout] Sims-sync: 403 Forbidden. Host-token ≠ container-token."
  echo "[hint] Vergelijk SIMHUIS_SYNC_API_TOKEN in ${ENV_FILE} en docker exec stm-app printenv SIMHUIS_SYNC_API_TOKEN."
  exit 1
fi

if [ "${HTTP_CODE}" != "200" ]; then
  echo "[fout] Sims-sync mislukt (HTTP ${HTTP_CODE})."
  exit 1
fi

if echo "${BODY}" | grep -q '"ok"\s*:\s*true'; then
  if echo "${BODY}" | grep -q '"skipped"\s*:\s*true'; then
    REASON="$(echo "${BODY}" | grep -o '"reason"\s*:\s*"[^"]*"' | head -n1 || true)"
    echo "[skip] Sims-sync overgeslagen door Schedule Guard: ${REASON}"
  else
    echo "[ok] Sims-sync voltooid."
  fi
  exit 0
else
  echo "[fout] Sims-sync retourneerde ok=false."
  exit 1
fi
