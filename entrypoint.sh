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
# 2. Prisma migrate deploy (alleen als CLI beschikbaar)
# ----------------------------------------------------------------------------
PRISMA_CLI=""
if [ -x /app/node_modules/.bin/prisma ]; then
  PRISMA_CLI="/app/node_modules/.bin/prisma"
elif [ -f /app/node_modules/prisma/build/index.js ]; then
  PRISMA_CLI="node /app/node_modules/prisma/build/index.js"
elif command -v npx >/dev/null 2>&1; then
  PRISMA_CLI="npx prisma"
fi

if [ -n "$PRISMA_CLI" ]; then
  log "Start prisma migrate deploy (via: $PRISMA_CLI)"
  if $PRISMA_CLI migrate deploy; then
    log "✔ Migraties succesvol toegepast."
  else
    err "❌ Prisma migrate deploy MISLUKT. App wordt NIET gestart (voorkomt half gemigreerde staat)."
    exit 1
  fi
else
  log "⚠  Geen Prisma CLI gevonden. Migrations stap overslaan (verwachten we dat al elders)."
fi

# ----------------------------------------------------------------------------
# 3. Start Next.js standalone server, met graceful shutdown
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
