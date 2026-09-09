#!/usr/bin/env bash
# ============================================================
# Nexus - install.sh
# Install wizard voor productie-VPS (Ubuntu/Debian + Docker).
# Stack: Next.js standalone + PostgreSQL + Caddy (via compose).
# Idempotent: veilig meerdere keren draaien.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED="\e[31m"; GRN="\e[32m"; YLW="\e[33m"; CYN="\e[36m"; BLU="\e[34m"; BLD="\e[1m"; DIM="\e[2m"; RST="\e[0m"

SKIP_SEED=0
FORCE_REBUILD=0
NON_INTERACTIVE=0

usage() {
  cat <<EOF
${BLD}Nexus Installatiewizard${RST}  (dockerized, self-contained)

Gebruik:
  $0 [OPTIES]

Opties:
  --skip-seed         Sla \`prisma db seed\` over (geen demo-data / admin user).
  --force-rebuild     Dwing nieuwe Docker rebuild van nexus-app image.
  --non-interactive   Geen prompts; gebruik defaults (voor CI / ansible).
  -h, --help          Toon deze help.

Vereisten:
  - Debian/Ubuntu-achtige distributie (andere: waarschuwing, zelf Docker installeren).
  - Minimaal 1 GB RAM, 5 GB vrije schijfruimte.
  - Internet toegang (voor Docker Hub, apt, Caddy TLS).

Uitvoer:
  1. Systeemcheck
  2. Docker installeren (indien afwezig)
  3. .env genereren (roept scripts/setup-env.sh aan)
  4. PostgreSQL container starten + healthcheck
  5. Applicatie image bouwen + prisma migrate deploy
  6. (Optioneel) database seeden
  7. Volledige stack opstarten (nexus-app + caddy)
  8. Healthcheck + samenvatting
EOF
}

# --- Argument parsing ---------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-seed)        SKIP_SEED=1; shift ;;
    --force-rebuild)    FORCE_REBUILD=1; shift ;;
    --non-interactive)  NON_INTERACTIVE=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *) echo -e "${RED}Onbekende optie: $1${RST}"; usage; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

# --- Helpers -------------------------------------------------

info()  { echo -e "${CYN}ℹ  $*${RST}"; }
ok()    { echo -e "${GRN}✔  $*${RST}"; }
warn()  { echo -e "${YLW}⚠  $*${RST}"; }
err()   { echo -e "${RED}✖  $*${RST}" >&2; }
title() { echo -e "\n${BLD}┌─ $*${RST}"; }
step()  { echo -e "${BLU}▸ $*${RST}"; }
hr()    { echo -e "${DIM}────────────────────────────────────────────${RST}"; }

confirm() {
  local msg="$1" default="${2:-y}"
  [[ "$NON_INTERACTIVE" -eq 1 ]] && return 0
  local hint="[Y/n]"
  [[ "$default" == "n" ]] && hint="[y/N]"
  echo -ne "${CYN}?${RST} ${msg} ${hint} "
  read -r ans
  ans="${ans,,}"
  [[ -z "$ans" ]] && ans="$default"
  [[ "$ans" == "y" || "$ans" == "yes" ]]
}

require_cmd() { command -v "$1" >/dev/null 2>&1; }

# ============================================================
# STAP 0 — Banner en rechtencheck
# ============================================================
title "Nexus — Installatiewizard"
echo -e "${DIM}  https://github.com/<org>/nexus   ·   self-hosted · VPS-ready${RST}"
hr

if [[ "$EUID" -eq 0 ]]; then
  err "Draai dit script NIET als root. Gebruik een gewone gebruiker met sudo-rechten."
  exit 1
fi

if ! sudo -n true 2>/dev/null && [[ "$NON_INTERACTIVE" -eq 0 ]]; then
  info "Dit script heeft sudo nodig voor pakketinstallaties. Voer zo nodig je wachtwoord in."
  sudo -v || { err "sudo mislukt."; exit 1; }
fi

# ============================================================
# STAP 1 — Systeemcheck
# ============================================================
title "Systeemcheck"

# OS
OS_ID=""
if [[ -f /etc/os-release ]]; then
  OS_ID="$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"
  VERSION_ID="$(grep -E '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')"
  info "OS: ${OS_ID^} ${VERSION_ID:-}"
else
  warn "Kon /etc/os-release niet lezen."
fi
if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
  warn "Dit script is geoptimaliseerd voor Ubuntu/Debian. (huidig: ${OS_ID^})"
  warn "Docker en Caddy worden NIET automatisch geïnstalleerd; installeer deze zelf."
  [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Doorgaan ondanks?" || exit 2
fi

# Architectuur
ARCH="$(uname -m)"
info "Architectuur: $ARCH"
case "$ARCH" in
  x86_64|aarch64) ;;
  *) warn "Architectuur $ARCH is niet expliciet getest. (mogelijk: werkt niet)";
     [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Toch doorgaan?" || exit 2 ;;
esac

# RAM
TOTAL_RAM_KB=0
if require_cmd free; then
  TOTAL_RAM_KB="$(free | awk '/^Mem:/ {print $2}')"
fi
TOTAL_RAM_MB=$(( TOTAL_RAM_KB / 1024 ))
info "RAM: ~${TOTAL_RAM_MB} MB"
if (( TOTAL_RAM_MB > 0 && TOTAL_RAM_MB < 1000 )); then
  warn "Minder dan 1 GB RAM gedetecteerd. Dit wordt afgeraden."
  [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Toch doorgaan?" || exit 2
fi

# Disk
FREE_DISK_MB=0
if require_cmd df; then
  FREE_DISK_MB="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {printf "%.0f", $4/1024}')"
fi
info "Schijfruimte (vrij): ~${FREE_DISK_MB} MB"
if (( FREE_DISK_MB > 0 && FREE_DISK_MB < 5000 )); then
  warn "Minder dan 5 GB vrije schijfruimte. Risico op build-falen."
  [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Toch doorgaan?" || exit 2
fi

# Projectbestanden
for f in package.json Dockerfile docker-compose.yml prisma/schema.prisma; do
  if [[ ! -f "$ROOT_DIR/$f" ]]; then
    err "Verwacht bestand ontbreekt in $ROOT_DIR: $f"
    err "Draai dit script vanuit de Nexus project-map."
    exit 1
  fi
done

ok "Systeemcheck voltooid."

# ============================================================
# STAP 2 — Docker installeren (indien nodig)
# ============================================================
title "Docker (engine + compose)"

if require_cmd docker && require_cmd docker; then
  DOCKER_VER="$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')"
  COMPOSE_VER="$(docker compose version 2>/dev/null | awk '{print $4}' | tr -d ',v' || true)"
  ok "Docker $DOCKER_VER aanwezig."
  if [[ -n "$COMPOSE_VER" ]]; then
    ok "Docker Compose v$COMPOSE_VER aanwezig."
  else
    err "Docker compose plugin ontbreekt. Installeer: docker-compose-plugin"
    exit 3
  fi
else
  if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
    err "Docker ontbreekt en kan niet auto-geïnstalleerd worden op ${OS_ID^}."
    err "Installeer Docker handmatig en herhaal."
    exit 3
  fi

  step "Docker installeren via apt (officiële repo)..."

  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg lsb-release

  KEYRING="/usr/share/keyrings/docker-archive-keyring.gpg"
  sudo install -m 0755 -d /usr/share/keyrings
  curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg \
    | sudo gpg --dearmor -o "$KEYRING" --yes 2>/dev/null
  sudo chmod a+r "$KEYRING"

  ARCH2="$(dpkg --print-architecture)"
  CODENAME="$(grep -E '^VERSION_CODENAME=' /etc/os-release | cut -d= -f2 | tr -d '"')"
  [[ -z "$CODENAME" ]] && CODENAME="$(lsb_release -cs 2>/dev/null || true)"
  echo \
    "deb [arch=$ARCH2 signed-by=$KEYRING] https://download.docker.com/linux/${OS_ID} ${CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update -y
  sudo apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  ok "Docker geïnstalleerd."

  CURRENT_USER="$(id -un)"
  if ! id -nG "$CURRENT_USER" | grep -qw docker; then
    step "Gebruiker '${CURRENT_USER}' toevoegen aan 'docker' groep..."
    sudo usermod -aG docker "$CURRENT_USER"
    warn "De 'docker' groep is gewijzigd. __LOG UIT EN LOG WEER IN__ (of newgrp docker) vooraleer verder te gaan."
    warn "Daarna herhaal:  bash scripts/install.sh"
    exit 4
  fi
fi

# ============================================================
# STAP 3 — .env instellen
# ============================================================
title "Environment (.env)"

SETUP_ENV_ARGS=()
[[ "$NON_INTERACTIVE" -eq 1 ]] && SETUP_ENV_ARGS+=(--non-interactive)

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  step "Genereren van .env (setup-env.sh)..."
  bash "$ROOT_DIR/scripts/setup-env.sh" "${SETUP_ENV_ARGS[@]}"
else
  info ".env bestaat al. (gebruik setup-env.sh -f om te herschrijven)"
fi

if ! grep -qE '^AUTH_SECRET=.+' "$ROOT_DIR/.env"; then
  err "AUTH_SECRET ontbreekt in .env. Roep eerst scripts/setup-env.sh aan."
  exit 5
fi
if ! grep -qE '^POSTGRES_PASSWORD=.+' "$ROOT_DIR/.env"; then
  err "POSTGRES_PASSWORD ontbreekt in .env."
  exit 5
fi

# Source env variables (zonder export naar host-shell)
set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env"
set +a

ok ".env gevalideerd."

# ============================================================
# STAP 4 — PostgreSQL (nexus-db) opstarten
# ============================================================
title "Database: nexus-db"

DB_CMD=(docker compose up -d nexus-db)
step "Starten: ${DB_CMD[*]}"
"${DB_CMD[@]}"

step "Wachten tot PostgreSQL healthy is..."
MAX=40
for i in $(seq 1 "$MAX"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' nexus-db 2>/dev/null || true)"
  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi
  if [[ "$STATUS" == "unhealthy" ]]; then
    err "PostgreSQL unhealthy na ${i}s. Logs:"
    docker logs --tail 50 nexus-db
    exit 6
  fi
  sleep 1
  echo -n "."
done
echo ""

STATUS="$(docker inspect --format='{{.State.Health.Status}}' nexus-db 2>/dev/null || true)"
[[ "$STATUS" != "healthy" ]] && { err "PostgreSQL kwam niet healthy binnen ${MAX}s."; exit 6; }
ok "PostgreSQL is healthy."

# ============================================================
# STAP 5 — Applicatie bouwen + migraties
# ============================================================
title "Applicatie: bouwen & migreren"

BUILD_OPTS=()
[[ "$FORCE_REBUILD" -eq 1 ]] && BUILD_OPTS+=(--no-cache)

step "Docker build: nexus-app ${BUILD_OPTS[*]}"
docker compose build "${BUILD_OPTS[@]}" nexus-app
ok "Build voltooid."

step "Prisma: migrate deploy"
docker compose run --rm nexus-app sh -c "cd /app && npx prisma migrate deploy" \
  || { err "Prisma migrate deploy mislukt."; exit 7; }
ok "Migraties toegepast."

# ============================================================
# STAP 6 — (Optioneel) Seeden
# ============================================================
title "Database seeden (optioneel)"
if [[ "$SKIP_SEED" -eq 1 ]]; then
  info "--skip-seed: seeden wordt overgeslagen."
elif [[ ! -f "$ROOT_DIR/prisma/seed.ts" ]]; then
  warn "Geen prisma/seed.ts gevonden. Seeden overgeslagen."
else
  if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    if confirm "Database seeden (admin gebruiker + demo-data)?"; then
      step "Uitvoeren: prisma db seed"
      docker compose run --rm nexus-app sh -c "cd /app && npm run prisma:seed" \
        || { warn "Seeden gaf fouten (zie hierboven)."; }
      ok "Seeden voltooid."
    fi
  else
    info "Non-interactive: seeden wordt overgeslagen."
  fi
fi

# ============================================================
# STAP 7 — Volledige stack opstarten
# ============================================================
title "Stack opstarten (app + caddy)"

step "docker compose up -d"
docker compose up -d

step "Wachten op nexus-app..."
for i in $(seq 1 60); do
  if docker compose exec -T nexus-app sh -c 'wget -qO- http://127.0.0.1:3000 >/dev/null 2>&1 || curl -sf http://127.0.0.1:3000 >/dev/null 2>&1' 2>/dev/null; then
    break
  fi
  sleep 1
  echo -n "."
done
echo ""

ok "Stack actief."

# ============================================================
# STAP 8 — Eindcontrole & samenvatting
# ============================================================
title "Samenvatting"

APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
DOMAIN="${NEXUS_DOMAIN:-}"

# Controleer of het Caddy / app endpoint bereikbaar is (vanuit de host)
step "Eind healthcheck: $APP_URL"
HTTP_CODE="000"
if require_cmd curl; then
  HTTP_CODE="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 \
    --connect-timeout 5 --retry 2 --insecure "$APP_URL" 2>/dev/null || true)"
fi

if [[ "$HTTP_CODE" =~ ^(200|302|307|308)$ ]]; then
  ok "App bereikbaar (HTTP $HTTP_CODE)."
else
  warn "App niet direct bereikbaar (HTTP $HTTP_CODE). Check: docker compose logs caddy nexus-app"
fi

hr
echo -e "${BLD}  ✅ Nexus geïnstalleerd!${RST}"
echo ""
echo -e "  ${CYN}App URL         :${RST}  $APP_URL"
[[ -n "$DOMAIN" ]] && echo -e "  ${CYN}Domein (TLS)    :${RST}  $DOMAIN  (Caddy managed Let's Encrypt)"
echo -e "  ${CYN}Containers      :${RST}  nexus-app, nexus-db, nexus-caddy"
echo ""
echo -e "  ${CYN}Status controleren :${RST}  docker compose -f $ROOT_DIR/docker-compose.yml ps"
echo -e "  ${CYN}Logs bekijken     :${RST}  docker compose logs -f nexus-app"
echo -e "  ${CYN}Stoppen           :${RST}  docker compose down"
echo -e "  ${CYN}Opstarten         :${RST}  docker compose up -d"
echo ""
echo -e "  ${DIM}Seed admin (indien geseed)  : admin@nexus.local  /  Test1234!${RST}"
echo -e "  ${DIM}Verander direct je wachtwoord na eerste login!${RST}"
hr
ok "Installatie voltooid."
