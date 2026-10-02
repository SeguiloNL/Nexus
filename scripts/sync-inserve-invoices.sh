#!/usr/bin/env bash
# ============================================================
# STM — Inserve Invoices & Subscriptions Sync trigger (elke 6 uur)
#
# Roept interne sync via docker exec in de stm-app container.
# Voert op zijn beurt de inserve-sync services aan voor alle
# pendente abonnementen en facturen.
#
# Handmatig testen:
#   cd /opt/stm && bash scripts/sync-inserve-invoices.sh
# ============================================================
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${WORKDIR}/docker-compose.prod.yml"

cd "${WORKDIR}"

echo "[info] Start Inserve sync (abonnementen + facturen)"

if ! docker info >/dev/null 2>&1; then
  echo "[fout] Docker daemon niet bereikbaar. Kan sync niet uitvoeren."
  exit 2
fi

APP_RUNNING=$(docker ps --format '{{.Names}}' -f name='^stm-app$' 2>/dev/null || true)
if [ -z "${APP_RUNNING}" ]; then
  echo "[fout] stm-app container draait niet. Start eerst de stack."
  exit 2
fi

SYNC_SCRIPT="/tmp/inserve-sync-batch-$$.mjs"

cat > "${SYNC_SCRIPT}" <<'SYNC_JS_EOF'
import { PrismaClient } from '@prisma/client';
import { syncSubscriptionToInserve } from './src/server/services/inserve-sync.service';
import { syncInvoiceToInserve } from './src/server/services/inserve-invoice-sync.service';

const prisma = new PrismaClient();
const CTX = { userId: 'cron_inserve_sync', userRole: 'ADMIN' };

async function main() {
  console.log(`[${new Date().toISOString()}] Start Inserve batch sync...`);

  // 1) Abonnementen die nog nooit of faalde sync
  const subs = await prisma.subscription.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'CANCELLED', 'TERMINATED', 'SUSPENDED'] },
      OR: [
        { inserveSyncStatus: null },
        { inserveSyncStatus: 'FAILED' },
        { inserveSyncStatus: 'SKIPPED' },
      ],
    },
    select: { id: true, subscriptionNumber: true, status: true, inserveSyncStatus: true },
    take: 200,
  });

  console.log(`  ${subs.length} abonnementen te synchroniseren.`);
  let subOk = 0, subFail = 0, subSkip = 0;
  for (const s of subs) {
    try {
      const r = await syncSubscriptionToInserve(s.id, CTX);
      if (r.status === 'SYNCED') subOk++;
      else if (r.status === 'SKIPPED') subSkip++;
      else { subFail++; console.error(`    FAIL sub ${s.subscriptionNumber}: ${r.error ?? r.details}`); }
    } catch (e) { subFail++; console.error(`    EXC sub ${s.subscriptionNumber}:`, e); }
  }

  // 2) Facturen
  const invs = await prisma.invoice.findMany({
    where: {
      status: { in: ['DRAFT', 'SENT', 'OVERDUE'] },
      OR: [
        { inserveSyncStatus: null },
        { inserveSyncStatus: 'FAILED' },
        { inserveSyncStatus: 'SKIPPED' },
      ],
    },
    select: { id: true, invoiceNumber: true, status: true, inserveSyncStatus: true },
    take: 200,
  });

  console.log(`  ${invs.length} facturen te synchroniseren.`);
  let invOk = 0, invFail = 0, invSkip = 0;
  for (const iv of invs) {
    try {
      const r = await syncInvoiceToInserve(iv.id, CTX);
      if (r.status === 'SYNCED') invOk++;
      else if (r.status === 'SKIPPED') invSkip++;
      else { invFail++; console.error(`    FAIL inv ${iv.invoiceNumber}: ${r.error ?? r.details}`); }
    } catch (e) { invFail++; console.error(`    EXC inv ${iv.invoiceNumber}:`, e); }
  }

  console.log(`[${new Date().toISOString()}] KLAAR. Sub: ok=${subOk} skip=${subSkip} fail=${subFail} | Inv: ok=${invOk} skip=${invSkip} fail=${invFail}`);
  process.exit((subFail + invFail) > 0 ? 3 : 0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
SYNC_JS_EOF

trap 'rm -f "${SYNC_SCRIPT}"' EXIT

if ! docker cp "${SYNC_SCRIPT}" "stm-app:/app/.cron-inserve-sync.mjs" 2>&1; then
  echo "[fout] Kon sync script niet kopiëren naar container."
  exit 1
fi

RC=0
docker exec -T stm-app sh -lc 'cd /app && node .cron-inserve-sync.mjs' 2>&1 || RC=$?

docker exec -T stm-app rm -f "/app/.cron-inserve-sync.mjs" 2>/dev/null || true

if [ "${RC}" -eq 0 ]; then
  echo "[ok] Inserve sync voltooid (rc=0)."
elif [ "${RC}" -eq 3 ]; then
  echo "[warn] Inserve sync deel-succes (rc=3: enkele items gefaald)."
  exit 0
else
  echo "[fout] Inserve sync mislukt (rc=${RC})."
  exit 1
fi
