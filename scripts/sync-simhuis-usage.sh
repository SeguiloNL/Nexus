#!/usr/bin/env bash
# ============================================================
# STM — Simhuis Usage Sync trigger (every 15 min via systemd)
#
# Roept de Next.js API route /api/integrations/simhuis/sync-usage
# aan met Bearer auth + X-Sync-Triggered-By header.
# Ververkt Schedule Guard (skipped=true => exit 0, geen fout).
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/sync-simhuis-usage.sh
# ============================================================
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

APP_URL="http://127.0.0.1:3000"
API_TOKEN=""

if [ -f "${ENV_FILE}" ]; then
  while IFS='= ' read -r key value; do
    [[ -z "${key}" || "${key}" == \#* ]] && continue
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    case "${key}" in
      NEXT_PUBLIC_APP_URL|STM_APP_URL)
        if [ -n "${value}" ]; then APP_URL="${value}"; fi
        ;;
      SIMHUIS_SYNC_API_TOKEN)
        API_TOKEN="${value}"
        ;;
    esac
  done < "${ENV_FILE}"
else
  echo "[warn] Geen .env bestand gevonden in ${WORKDIR}. STM_APP_URL en SIMHUIS_SYNC_API_TOKEN worden uit environment gehaald."
  APP_URL="${STM_APP_URL:-${APP_URL}}"
  API_TOKEN="${SIMHUIS_SYNC_API_TOKEN:-}"
fi

if [ -z "${API_TOKEN}" ]; then
  echo "[fout] SIMHUIS_SYNC_API_TOKEN is niet gezet in .env of environment. Kan usage-sync niet uitvoeren."
  exit 2
fi

SYNC_URL="${APP_URL%/}/api/integrations/simhuis/sync-usage"

echo "[info] Aanroepen usage-sync: POST ${SYNC_URL}"
RESPONSE_FILE="$(mktemp)"
HTTP_CODE=$(curl -sS -o "${RESPONSE_FILE}" -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "X-Sync-Triggered-By: systemd-timer" \
  -H "Content-Type: application/json" \
  --max-time 600 \
  "${SYNC_URL}" || true)

BODY="$(cat "${RESPONSE_FILE}" 2>/dev/null || echo "")"
rm -f "${RESPONSE_FILE}"

echo "[info] HTTP ${HTTP_CODE}. Response:"
echo "${BODY}"

if [ "${HTTP_CODE}" != "200" ]; then
  echo "[fout] Usage-sync mislukt (HTTP ${HTTP_CODE})."
  exit 1
fi

# Schedule Guard: taak wordt geskipt indien buiten window => NIET als fout behandelen.
if echo "${BODY}" | grep -q '"ok"\s*:\s*true'; then
  if echo "${BODY}" | grep -q '"skipped"\s*:\s*true'; then
    REASON="$(echo "${BODY}" | grep -o '"reason"\s*:\s*"[^"]*"' | head -n1 || true)"
    echo "[skip] Usage-sync overgeslagen door Schedule Guard: ${REASON}"
  else
    echo "[ok] Usage-sync voltooid."
  fi
  exit 0
else
  echo "[fout] Usage-sync retourneerde ok=false."
  exit 1
fi
