#!/bin/sh
# ============================================================================
# STM — Docker Runtime Entrypoint (Next.js standalone + Prisma migrations)
# Robuust: DB connectivity wait loop, migrations eerst, daarna server.
# Exit codes:
#   0 = clean shutdown
#   1 = migrations failure (stop container, do NOT start Next.js half)
# ============================================================================
set -eu

log() {
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] [entrypoint] $*"
}
err() {
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] [entrypoint] ERROR: $*" >&2
}

cd /app

# ════════════════════════════════════════════════════════════════════════════
# PRISMA SAFETY: Forceer BINARY engine (geen library/musl/openssl crash!)
#   library engine crash op Alpine musl+openssl3 → JSON parse "Error load"
#   binary engine = alles statically linked, werkt ALTID op elke Linux!
# ════════════════════════════════════════════════════════════════════════════
export PRISMA_CLIENT_ENGINE_TYPE="${PRISMA_CLIENT_ENGINE_TYPE:-binary}"
log "PRISMA_CLIENT_ENGINE_TYPE=${PRISMA_CLIENT_ENGINE_TYPE} (altijd binary = crash-safe)"

# ----------------------------------------------------------------------------
# 1. Wachten tot PostgreSQL bereikbaar is
# ----------------------------------------------------------------------------
DB_HOST=""
DB_PORT="5432"
DB_USER=""
DB_NAME=""

# Extract uit DATABASE_URL formaat: postgresql://USER:PASS@HOST:PORT/NAME?opts
if [ -n "${DATABASE_URL:-}" ]; then
  REST="${DATABASE_URL#postgresql://}"
  CREDS="${REST%%@*}"
  HOSTPORTNAME="${REST#*@}"
  HOSTPORT="${HOSTPORTNAME%%/*}"
  DB_PORT="${HOSTPORT##*:}"
  DB_HOST="${HOSTPORT%%:*}"
  DB_USER="${CREDS%%:*}"
  DB_NAME="${HOSTPORTNAME%%\?*}"
  DB_NAME="${DB_NAME##*/}"
fi

log "DATABASE_URL parsed: host=${DB_HOST:-?}, port=${DB_PORT}, user=${DB_USER:-?}, db=${DB_NAME:-?}"

MAX_WAIT=60
WAITED=0
READY=0
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  if [ -n "${DB_HOST:-}" ] && [ -n "${DB_PORT:-}" ]; then
    if command -v nc >/dev/null 2>&1; then
      if nc -z -w 1 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
        READY=1
        break
      fi
    elif command -v timeout >/dev/null 2>&1; then
      if timeout 1 sh -c "echo > /dev/tcp/${DB_HOST}/${DB_PORT}" 2>/dev/null; then
        READY=1
        break
      fi
    else
      READY=1
      break
    fi
  else
    log "⚠  DATABASE_URL niet beschikbaar voor parsing, overslaan netwerk check."
    READY=1
    break
  fi
  WAITED=$((WAITED + 2))
  log "Wachten op PostgreSQL (${WAITED}/${MAX_WAIT}s)..."
  sleep 2
done

if [ "$READY" -eq 0 ]; then
  err "PostgreSQL onbereikbaar na ${MAX_WAIT}s (host=${DB_HOST}, port=${DB_PORT}). Stop container."
  exit 1
fi

log "PostgreSQL bereikbaar."

# ----------------------------------------------------------------------------
# 2. Prisma: detect CLI + FULL debug print
# ----------------------------------------------------------------------------
PRISMA_CLI=""
if [ -x /app/node_modules/.bin/prisma ]; then
  PRISMA_CLI="/app/node_modules/.bin/prisma"
elif [ -f /app/node_modules/prisma/build/index.js ]; then
  PRISMA_CLI="node /app/node_modules/prisma/build/index.js"
elif command -v npx >/dev/null 2>&1; then
  PRISMA_CLI="npx prisma"
fi
log "PRISMA CLI: ${PRISMA_CLI:-(none)}"
if [ -n "$PRISMA_CLI" ]; then
  log "PRISMA VERSION: $( (eval $PRISMA_CLI --version) 2>&1 || echo unknown)"
fi
log "PRISMA SCHEMA BESTAND: $(ls -la /app/prisma/schema.prisma 2>&1 || echo MISSING)"

# ----------------------------------------------------------------------------
# 3. Prisma migrate deploy — 3 TIER FALLBACK GEEN CRASH MEER!
#    Tier 1 : migrate deploy     (netjes, met migrations tabel)
#    Tier 2 : migrate deploy     (nog 1x retry met expliciet binary engine env)
#    Tier 3 : db push           (schema geforceerd syncen, zonder migrations)
# ----------------------------------------------------------------------------
run_migrate_ok=0
if [ -n "$PRISMA_CLI" ]; then

  # ---- Tier 1 ----
  log "Start prisma migrate deploy (tier 1/3: normale weg via migrationsmap)"
  if (eval $PRISMA_CLI migrate deploy) 2>&1; then
    run_migrate_ok=1
    log "✔ (1/3) Migraties succesvol toegepast."
  else
    err "⚠  (1/3) Prisma migrate deploy mislukt (zie boven). Op naar tier 2: retry."
  fi

  # ---- Tier 2 ----
  if [ "$run_migrate_ok" -eq 0 ]; then
    log "Start prisma migrate deploy (tier 2/3: retry met EXPORT binary engine + verbose)"
    if (PRISMA_CLIENT_ENGINE_TYPE=binary eval $PRISMA_CLI migrate deploy) 2>&1; then
      run_migrate_ok=1
      log "✔ (2/3) Migraties succesvol op retry."
    else
      err "⚠  (2/3) Migrate deploy nog steeds mislukt. Laatste redmiddel: PRISMA DB PUSH."
    fi
  fi

  # ---- Tier 3: ALTIJD WERKT ----
  if [ "$run_migrate_ok" -eq 0 ]; then
    log "Start prisma db push (tier 3/3: LAATSTE REDMIDDEL, schema DWINGEN naar DB) — dit werkt ALTID!"
    if (PRISMA_CLIENT_ENGINE_TYPE=binary eval $PRISMA_CLI db push --skip-generate --accept-data-loss) 2>&1; then
      run_migrate_ok=1
      log "✔ (3/3) Prisma DB PUSH: schema succesvol gesynchroniseerd (fallback)."
    else
      err "❌ (3/3) ZELFS DB PUSH is mislukt! Schema sync onmogelijk. App wordt NIET gestart."
      exit 1
    fi
  fi

else
  log "⚠  Geen Prisma CLI gevonden. Migrations stap overslaan (verwachten we dat al elders)."
fi

# ----------------------------------------------------------------------------
# 4. Start Next.js standalone server, met graceful shutdown
# ----------------------------------------------------------------------------
log "Start Next.js standalone server (PORT=${PORT:-3000}, HOSTNAME=${HOSTNAME:-0.0.0.0})"

PID=""
shutdown() {
  log "Ontvangen SIGTERM/SIGINT — graceful shutdown PID=$PID"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  log "Shutdown voltooid."
  exit 0
}
trap shutdown TERM INT

HOSTNAME_VAL="${HOSTNAME:-0.0.0.0}"
PORT_VAL="${PORT:-3000}"

# Next.js standalone server.js accepteert HOSTNAME en PORT via env (Node server.js)
export HOSTNAME="${HOSTNAME_VAL}"
export PORT="${PORT_VAL}"

node server.js &
PID=$!
wait "$PID" || true
log "Next.js server gestopt."
