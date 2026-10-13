#!/usr/bin/env bash
# ============================================================
# STM/Nexus — Reset klanten + contactpersonen (voor import-test)
#
# Verwijdert ALLE klanten, contactpersonen en de koppeltabel,
# inclusief alle afhankelijke rijen (subscriptions, invoices,
# vehicles, activation_orders, user_customers, enz.) via
# TRUNCATE ... CASCADE.
#
# Gebruik:
#   bash scripts/reset-customers-contacts.sh            # met bevestiging
#   bash scripts/reset-customers-contacts.sh --yes      # zonder bevestiging
# ============================================================
set -Eeuo pipefail

trap 'TS="$(date "+%Y-%m-%dT%H:%M:%S%z")"; echo "[${TS}] [fout] Script $0 faalde op regel $LINENO: exit code $?" >&2' ERR

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WORKDIR}/.env"

FORCE=0
if [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ]; then
  FORCE=1
fi

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"; }

# ---- 1. Bepaal DB-container (prod: stm-db, dev: nexus-db) ----
DB_CONTAINER=""
for c in stm-db nexus-db; do
  if docker ps --format '{{.Names}}' -f "name=^${c}\$" 2>/dev/null | grep -q "^${c}\$"; then
    DB_CONTAINER="${c}"
    break
  fi
done
if [ -z "${DB_CONTAINER}" ]; then
  log "[fout] Geen draaiende DB-container gevonden (stm-db of nexus-db)."
  exit 1
fi
log "[info] DB-container: ${DB_CONTAINER}"

# ---- 2. Laad credentials uit .env ----
DB_USER=""
DB_NAME=""
if [ -f "${ENV_FILE}" ]; then
  DB_USER="$(grep -E '^POSTGRES_USER=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || true)"
  DB_NAME="$(grep -E '^POSTGRES_DB=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || true)"
  if [ -z "${DB_USER}" ] || [ -z "${DB_NAME}" ]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"\r' || true)"
    # postgresql://USER:PASS@HOST:PORT/DB
    if [ -n "${DATABASE_URL}" ]; then
      DB_USER="${DB_USER:-$(printf '%s' "${DATABASE_URL}" | sed -nE 's#^postgresql://([^:]+):.*#\1#p')}"
      DB_NAME="${DB_NAME:-$(printf '%s' "${DATABASE_URL}" | sed -nE 's#.*/([^/?]+).*#\1#p')}"
    fi
  fi
fi
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-stm}"
log "[info] DB user: ${DB_USER}  |  DB name: ${DB_NAME}"

PSQL() { docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "$1"; }

# ---- 3. Tel vooraf ----
count() { PSQL "SELECT COALESCE(count(*),0) FROM \"$1\";" 2>/dev/null | tr -d ' \n' || echo "?"; }

C_CUST_BEFORE="$(count customers)"
C_CONT_BEFORE="$(count contact_persons)"
C_LINK_BEFORE="$(count customer_contact_persons)"
log "[info] Vooraf  — customers: ${C_CUST_BEFORE} | contact_persons: ${C_CONT_BEFORE} | customer_contact_persons: ${C_LINK_BEFORE}"

# ---- 4. Bevestiging ----
if [ "${FORCE}" -ne 1 ]; then
  echo ""
  echo "WAARSCHUWING: Dit verwijdert ALLE klanten en contactpersonen,"
  echo "inclusief alle gekoppelde data (subscriptions, invoices, vehicles,"
  echo "activation_orders, user_customers, enz.). Dit kan niet ongedaan"
  echo "gemaakt worden zonder een database-herstel."
  echo ""
  read -r -p "Typ 'JA' om te bevestigen: " ANSWER
  if [ "${ANSWER}" != "JA" ]; then
    log "[info] Geannuleerd."
    exit 0
  fi
fi

# ---- 5. Uitvoeren (TRUNCATE CASCADE in 1 transactie) ----
log "[info] Uitvoeren: TRUNCATE customers, contact_persons, customer_contact_persons CASCADE"
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c \
  "TRUNCATE TABLE customers, contact_persons, customer_contact_persons RESTART IDENTITY CASCADE;" 2>&1 \
  | tee >(while IFS= read -r line; do log "[sql] ${line}"; done)

# ---- 6. Tel achteraf ----
C_CUST_AFTER="$(count customers)"
C_CONT_AFTER="$(count contact_persons)"
C_LINK_AFTER="$(count customer_contact_persons)"
log "[info] Achteraf — customers: ${C_CUST_AFTER} | contact_persons: ${C_CONT_AFTER} | customer_contact_persons: ${C_LINK_AFTER}"

log "[ok] Reset voltooid. Je kunt de import nu opnieuw draaien."
