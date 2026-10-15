#!/usr/bin/env bash
# ============================================================
# STM/Nexus — Reset klanten + contactpersonen (voor import-test)
#
# Verwijdert ALLE klanten, contactpersonen en de koppeltabel,
# inclusief de afhankelijke business-rijen (subscriptions,
# invoices, vehicles, activation_orders, assignments).
#
# Gebruikt expliciete DELETEs in FK-volgorde (geen TRUNCATE
# CASCADE!) zodat users, sims, products, trackers,
# sync_job_configs en audit_logs BEWAARD blijven.
# PostgreSQL's onDelete: SetNull zet users.customerId en
# sims.customerId automatisch op NULL.
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
C_SUB_BEFORE="$(count subscriptions)"
C_INV_BEFORE="$(count invoices)"
C_VEH_BEFORE="$(count vehicles)"
C_USER_BEFORE="$(count users)"
C_SIM_BEFORE="$(count sims)"
log "[info] Vooraf — customers: ${C_CUST_BEFORE} | contact_persons: ${C_CONT_BEFORE} | customer_contact_persons: ${C_LINK_BEFORE}"
log "[info] Vooraf — subscriptions: ${C_SUB_BEFORE} | invoices: ${C_INV_BEFORE} | vehicles: ${C_VEH_BEFORE}"
log "[info] Vooraf — users: ${C_USER_BEFORE} (blijft bewaard) | sims: ${C_SIM_BEFORE} (blijft bewaard)"

# ---- 4. Bevestiging ----
if [ "${FORCE}" -ne 1 ]; then
  echo ""
  echo "WAARSCHUWING: Dit verwijdert ALLE klanten, contactpersonen,"
  echo "subscriptions, invoices, vehicles, activation_orders en assignments."
  echo "Users, sims, products, trackers en sync-configuraties blijven bewaard."
  echo "Dit kan niet ongedaan gemaakt worden zonder database-herstel."
  echo ""
  read -r -p "Typ 'JA' om te bevestigen: " ANSWER
  if [ "${ANSWER}" != "JA" ]; then
    log "[info] Geannuleerd."
    exit 0
  fi
fi

# ---- 5. Uitvoeren: expliciete DELETEs in FK-volgorde binnen 1 transactie ----
# Volgorde is belangrijk vanwege onDelete: Restrict op:
#   invoices.subscriptionId / invoices.customerId
#   tracker_assignments.subscriptionId
#   sim_assignments.subscriptionId
#   subscriptions.customerId
#   vehicles.customerId
#   activation_orders.customerId
log "[info] Uitvoeren: DELETE in FK-volgorde (transactioneel)"

SQL="BEGIN;
DELETE FROM invoices;
DELETE FROM tracker_assignments;
DELETE FROM sim_assignments;
DELETE FROM activation_orders;
DELETE FROM subscriptions;
DELETE FROM vehicles;
DELETE FROM customer_contact_persons;
DELETE FROM user_customers;
DELETE FROM customers;
DELETE FROM contact_persons;
COMMIT;"

echo "${SQL}" | docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" 2>&1 \
  | tee >(while IFS= read -r line; do log "[sql] ${line}"; done)

# ---- 6. Tel achteraf ----
C_CUST_AFTER="$(count customers)"
C_CONT_AFTER="$(count contact_persons)"
C_LINK_AFTER="$(count customer_contact_persons)"
C_USER_AFTER="$(count users)"
C_SIM_AFTER="$(count sims)"
log "[info] Achteraf — customers: ${C_CUST_AFTER} | contact_persons: ${C_CONT_AFTER} | customer_contact_persons: ${C_LINK_AFTER}"
log "[info] Achteraf — users: ${C_USER_AFTER} | sims: ${C_SIM_AFTER}"

if [ "${C_USER_AFTER}" = "0" ]; then
  log "[warn] De users-tabel is leeg! Je hebt geen admin-account meer om in te loggen."
  log "[hint] Herstel een admin via: cd ${WORKDIR} && npx prisma db seed"
fi

log "[ok] Reset voltooid. Je kunt de Inserve-klantimport opnieuw draaien."
