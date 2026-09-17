#!/usr/bin/env bash
# ==============================================================================
# STM — Production Deploy Script voor Ubuntu/Debian VPS
# Idempotent: veilig meerdere keren te draaien.
# Strict: set -Eeuo pipefail; iedere error stopt onmiddellijk.
#
# ==============================================================================
# V O O R   E E R S T E   U I T V O E R I N G — P R E R E Q U I S I T E S (10x)
# ==============================================================================
# Voordat je bash scripts/deploy-stm.sh draait, moet je VPS VOLDOEN AAN:
#
#   1.  OS: Ubuntu 22.04 LTS of 24.04 LTS (64-bit x86_64 of arm64).
#       Andere Debian-achtigen: mogen, niet expliciet getest.
#   2.  User: non-root gebruiker met SUDO-rechten.
#         Doe NIET deploy als root. (script waarschuwt en stopt.)
#   3.  SSH: toegang via SSH key heeft DE VOORKEUR (niet wachtwoord).
#       Root-login via wachtwoord: UIT in /etc/ssh/sshd_config.
#   4.  Firewall: alleen poorten 22 (ssh), 80 (http), 443 (https) OPEN.
#         · ufw (Ubuntu standaard):  sudo ufw allow OpenSSH ; sudo ufw allow 80 ; sudo ufw allow 443 ; sudo ufw enable
#         · Andere: vergelijkbare regels.
#       POORT 5432 (Postgres) ALTIJD DICHT NAAR HET INTERNET.
#   5.  DNS: A-record (en optioneel AAAA-record) van je STM_DOMAIN
#       (bv. stm.jouwdomein.nl) naar HET PUBLIEKE IP ADRES van deze VPS.
#       Controle:  dig A stm.jouwdomein.nl +short  (moet het IP zijn)
#       → ZONDER deze stap werkt Let's Encrypt / Caddy HTTPS NIET.
#   6.  Pakketten: ca-certificates, curl, gnupg, lsb-release, sudo, git.
#       (Script installeert ze indien ontbrekend.)
#   7.  Resources: min. 1 GB RAM, 2 vCPU, 10 GB vrije schijfruimte (SSD).
#       Advies: 2 GB RAM + 2 vCPU (Next.js build = geheugenintensief).
#   8.  Swapfile: ten zeerste AANBEVOLEN op servers <4 GB RAM.
#       Instellen: zie scripts/swapfile.sh (indien aanwezig).
#   9.  Tijd (NTP) moet gesynchroniseerd zijn (timedatectl).
#  10. .env bestand: in projectroot.
#       · Kopieer vanuit template:  cp .env.production.example .env
#       · Vul in: AUTH_SECRET, POSTGRES_PASSWORD, NEXT_PUBLIC_APP_URL,
#                STM_DOMAIN, INSERVE_SUBDOMAIN, INSERVE_API_KEY,
#                SIMHUIS_API_KEY (P1), NAVIXY_API_KEY (P1).
#       · Template: zie .env.production.example
#
# ==============================================================================
# G E B R U I K
# ==============================================================================
#   bash scripts/deploy-stm.sh                  # eerste installatie + deploy
#   bash scripts/deploy-stm.sh --skip-docker     # Docker al geinstalleerd
#   bash scripts/deploy-stm.sh --force-rebuild   # --no-cache Docker rebuild
#   bash scripts/deploy-stm.sh --non-interactive # CI / ansible (geen prompts)
#   bash scripts/deploy-stm.sh -h                # help
# ==============================================================================
set -Eeuo pipefail

# ------------------------------------------------------------------------------
# — Globals & initialisatie —
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT_DIR}/logs"
LOG_FILE="${LOG_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
ENV_FILE="${ROOT_DIR}/.env"
ENV_TEMPLATE="${ROOT_DIR}/.env.production.example"

SKIP_DOCKER=0
FORCE_REBUILD=0
NON_INTERACTIVE=0
SHOW_HELP=0

# ANSI colors (uitschakelbaar via NO_COLOR=1)
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; CYN=$'\e[36m'; BLU=$'\e[34m'
  BLD=$'\e[1m'; DIM=$'\e[2m'; RST=$'\e[0m'
else
  RED=""; GRN=""; YLW=""; CYN=""; BLU=""; BLD=""; DIM=""; RST=""
fi

# ------------------------------------------------------------------------------
# — Helpers —
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
${BLD}STM Deploy Script${RST}  (productie, docker-compose.prod.yml)

Gebruik:
  $0 [OPTIES]

Opties:
  --skip-docker       Controle/docker installatie overslaan (je hebt het al).
  --force-rebuild     Dwing nieuwe Docker rebuild (--no-cache).
  --non-interactive   Geen prompts; automatische defaults (CI/CD).
  --skip-preflight    Skips OS / firewall / DNS prereq checks (niet aanbevolen).
  -h, --help          Toon deze help en sluit af.

Uitvoer logbestand:
  ${LOG_FILE}
EOF
}

info()  { printf '%bℹ  %s%b\n' "${CYN}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
ok()    { printf '%b✔  %s%b\n' "${GRN}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
warn()  { printf '%b⚠  %s%b\n' "${YLW}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
err()   { printf '%b✖  %s%b\n' "${RED}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
title() { printf '\n%b┌─ %s%b\n' "${BLD}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
step()  { printf '%b▸ %s%b\n' "${BLU}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
hr()    { printf '%b────────────────────────────────────────────────%b\n' "${DIM}" "${RST}" | tee -a "$LOG_FILE" >&2 ; }

confirm() {
  local msg="$1" default="${2:-y}"
  [[ "$NON_INTERACTIVE" -eq 1 ]] && return 0
  local hint="[Y/n]"
  [[ "$default" == "n" ]] && hint="[y/N]"
  printf '%b?%b %s %s ' "${CYN}" "${RST}" "${msg}" "${hint}"
  read -r ans
  ans="${ans,,}"
  [[ -z "$ans" ]] && ans="$default"
  [[ "$ans" == "y" || "$ans" == "yes" ]]
}

require_cmd() { command -v "$1" >/dev/null 2>&1 ; }

on_error() {
  local line="$1"
  local cmd="$2"
  err "Script FAILED op regel ${line}: ${cmd}"
  err "Volledig logbestand: ${LOG_FILE}"
  exit 1
}
trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

# ------------------------------------------------------------------------------
# — Argument parsing —
# ------------------------------------------------------------------------------
SKIP_PREFLIGHT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker)     SKIP_DOCKER=1; shift ;;
    --force-rebuild)   FORCE_REBUILD=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --skip-preflight)  SKIP_PREFLIGHT=1; shift ;;
    -h|--help)         SHOW_HELP=1; shift ;;
    *) err "Onbekende optie: $1"; usage; exit 1 ;;
  esac
done
[[ "$SHOW_HELP" -eq 1 ]] && { usage; exit 0; }

# --- Logdir ---------------------------------------------------------------
mkdir -p "$LOG_DIR"
touch "$LOG_FILE"
exec 2> >(tee -a "$LOG_FILE" >&2)

# ------------------------------------------------------------------------------
# STAP 0 — Rechtencheck + OS + project files
# ------------------------------------------------------------------------------
title "STM — Productie Deploy Script"
printf '%b  %s  ·  log: %s%b\n' "${DIM}" "$(date +"%Y-%m-%d %H:%M:%S")" "${LOG_FILE}" "${RST}" | tee -a "$LOG_FILE" >&2
hr

if [[ "$EUID" -eq 0 ]]; then
  err "Draai NIET als root. Gebruik een non-root gebruiker met sudo."
  exit 1
fi

if ! sudo -n true 2>/dev/null && [[ "$NON_INTERACTIVE" -eq 0 ]]; then
  info "Dit script heeft sudo nodig. Voer zo nodig je wachtwoord in:"
  sudo -v || { err "sudo mislukt."; exit 1; }
fi

cd "$ROOT_DIR"

# Projectbestanden aanwezig?
REQUIRED_FILES=(
  Dockerfile
  docker-compose.prod.yml
  Caddyfile
  entrypoint.sh
  prisma/schema.prisma
  package.json
  .env.production.example
)
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "${ROOT_DIR}/${f}" ]]; then
    err "Bestand ontbreekt in ${ROOT_DIR}: ${f}"
    exit 1
  fi
done
ok "Projectbestanden OK."

# ------------------------------------------------------------------------------
# STAP 1 — Systeem (preflight) checks
# ------------------------------------------------------------------------------
title "Preflight — Systeem en VPS checks"

if [[ "$SKIP_PREFLIGHT" -eq 1 ]]; then
  warn "--skip-preflight: OS / firewall / DNS checks worden overgeslagen (niet aanbevolen)."
else
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
    warn "Script is afgestemd op Ubuntu/Debian. (huidig: ${OS_ID^})."
    warn "Docker/Caddy installatie wordt mogelijk overgeslagen."
    [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Toch doorgaan?" || exit 2
  fi

  # Architectuur
  ARCH="$(uname -m)"
  info "Architectuur: ${ARCH}"
  case "$ARCH" in
    x86_64|aarch64) ;;
    *) warn "Architectuur ${ARCH} mogelijk niet ondersteund."
       [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Doorgaan?" || exit 2 ;;
  esac

  # RAM
  TOTAL_RAM_KB=0
  require_cmd free && TOTAL_RAM_KB="$(free | awk '/^Mem:/ {print $2}')"
  TOTAL_RAM_MB=$(( TOTAL_RAM_KB / 1024 ))
  info "RAM: ~${TOTAL_RAM_MB} MB"
  if (( TOTAL_RAM_MB > 0 && TOTAL_RAM_MB < 1000 )); then
    warn "Minder dan 1 GB RAM. Next.js build kan falen."
    [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Doorgaan?" || exit 2
  fi

  # Disk
  FREE_DISK_MB=0
  require_cmd df && FREE_DISK_MB="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {printf "%.0f", $4/1024}')"
  info "Schijfruimte (vrij): ~${FREE_DISK_MB} MB"
  if (( FREE_DISK_MB > 0 && FREE_DISK_MB < 5000 )); then
    warn "Minder dan 5 GB vrij. Risico op build/store falen."
    [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Doorgaan?" || exit 2
  fi

  # Firewall ufw check (indien aanwezig)
  if require_cmd ufw && sudo ufw status | head -1 | grep -q "Status: active"; then
    UFW_OUT="$(sudo ufw status verbose 2>/dev/null || true)"
    info "ufw actief. Check regels..."
    if echo "$UFW_OUT" | grep -qE " 80/tcp| 80 "; then ok "ufw: poort 80 open"; else warn "ufw: poort 80 lijkt DICHT (Caddy Let's Encrypt heeft deze nodig)."; fi
    if echo "$UFW_OUT" | grep -qE " 443/tcp| 443 "; then ok "ufw: poort 443 open"; else warn "ufw: poort 443 lijkt DICHT (HTTPS)."; fi
    if echo "$UFW_OUT" | grep -qE " 22/tcp| 22 |OpenSSH"; then ok "ufw: poort 22 (ssh) open"; else warn "ufw: poort 22 lijkt DICHT — VERLIES JE TOEGANG!"; fi
  else
    info "Geen ufw actief; firewall check overslaan (zorg zelf voor regels)."
  fi

  # DNS (STM_DOMAIN)
  if [[ -f "$ENV_FILE" ]]; then
    set -a; source "$ENV_FILE"; set +a || true
  fi
  CANDIDATE_DOMAIN="${STM_DOMAIN:-${NEXUS_DOMAIN:-}}"
  if [[ -n "$CANDIDATE_DOMAIN" && "$CANDIDATE_DOMAIN" != "localhost" ]]; then
    info "DNS check: ${CANDIDATE_DOMAIN}"
    if require_cmd dig; then
      RESOLVED_IP="$(dig +short A "${CANDIDATE_DOMAIN}" 2>/dev/null | head -1 || true)"
      [[ -z "${RESOLVED_IP:-}" ]] && RESOLVED_IP="$(dig +short AAAA "${CANDIDATE_DOMAIN}" 2>/dev/null | head -1 || true)"
      if [[ -n "${RESOLVED_IP:-}" ]]; then
        ok "DNS A/AAAA-record gevonden: ${RESOLVED_IP}"
      else
        warn "Geen DNS A/AAAA-record voor ${CANDIDATE_DOMAIN}. Caddy Let's Encrypt zal FAILEN."
        [[ "$NON_INTERACTIVE" -eq 0 ]] && confirm "Toch doorgaan (bv. testen zonder TLS)?" || exit 2
      fi
    else
      info "dig niet beschikbaar; DNS handmatig controleren: dig A ${CANDIDATE_DOMAIN} +short"
    fi
  else
    warn "STM_DOMAIN niet gezet in .env. Caddy gebruikt localhost (geen TLS)."
  fi
fi

# ------------------------------------------------------------------------------
# STAP 2 — Docker installeren (indien --skip-docker =0)
# ------------------------------------------------------------------------------
title "Docker Engine + Compose Plugin"

if [[ "$SKIP_DOCKER" -eq 1 ]]; then
  info "--skip-docker: docker installatie stap overslaan."
else
  if require_cmd docker && docker compose version >/dev/null 2>&1; then
    DOCKER_VER="$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')"
    COMPOSE_VER="$(docker compose version 2>/dev/null | awk '{print $4}' | tr -d ',v' || true)"
    ok "Docker ${DOCKER_VER} aanwezig."
    [[ -n "${COMPOSE_VER}" ]] && ok "Docker Compose v${COMPOSE_VER} aanwezig."
  else
    if [[ "${OS_ID}" != "ubuntu" && "${OS_ID}" != "debian" ]]; then
      err "Docker ontbreekt en apt-installatie werkt alleen op Ubuntu/Debian."
      err "Installeer Docker handmatig (docs.docker.com/engine/install) en herhaal."
      exit 3
    fi
    step "Docker installeren via officiële apt-repo..."

    sudo apt-get update -y | tee -a "$LOG_FILE"
    sudo apt-get install -y ca-certificates curl gnupg lsb-release git tzdata \
      | tee -a "$LOG_FILE"

    KEYRING="/usr/share/keyrings/docker-archive-keyring.gpg"
    sudo install -m 0755 -d /usr/share/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
      | sudo gpg --dearmor -o "$KEYRING" --yes 2>/dev/null
    sudo chmod a+r "$KEYRING"

    ARCH2="$(dpkg --print-architecture)"
    CODENAME="$(grep -E '^VERSION_CODENAME=' /etc/os-release | cut -d= -f2 | tr -d '"')"
    [[ -z "${CODENAME}" ]] && CODENAME="$(lsb_release -cs 2>/dev/null || true)"
    echo "deb [arch=${ARCH2} signed-by=${KEYRING}] https://download.docker.com/linux/${OS_ID} ${CODENAME} stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

    sudo apt-get update -y | tee -a "$LOG_FILE"
    sudo apt-get install -y \
      docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin \
      | tee -a "$LOG_FILE"

    CURRENT_USER="$(id -un)"
    if ! id -nG "${CURRENT_USER}" | grep -qw docker; then
      step "Gebruiker '${CURRENT_USER}' toevoegen aan docker-groep..."
      sudo usermod -aG docker "${CURRENT_USER}"
      warn "Docker groep gewijzigd."
      warn "  👉 LOG UIT EN LOG WEER IN, of run:  newgrp docker"
      warn "  👉 Daarna herhaal:  bash scripts/deploy-stm.sh --skip-docker"
      exit 4
    fi
    ok "Docker geïnstalleerd."
  fi
fi

# ------------------------------------------------------------------------------
# STAP 3 — .env bestand (validatie + eventueel auto-genereren)
# ------------------------------------------------------------------------------
title "Environment (.env) valideren"

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ "${NON_INTERACTIVE}" -eq 0 ]]; then
    if confirm ".env bestaat niet. Aanmaken vanuit .env.production.example?"; then
      step "Kopiëren template → .env"
      cp "${ENV_TEMPLATE}" "${ENV_FILE}"
      ok ".env aangemaakt. BELANGRIJK: bewerk hem nu (AUTH_SECRET, POSTGRES_PASSWORD, NEXT_PUBLIC_APP_URL, STM_DOMAIN, ...)."
      warn "Open NU een andere terminal, en pas .env aan:"
      warn "    nano ${ENV_FILE}"
      confirm "Klaar met bewerken van .env?"
    else
      err ".env is verplicht. Kopieer template: cp ${ENV_TEMPLATE} ${ENV_FILE} en bewerk."
      exit 5
    fi
  else
    err "NON_INTERACTIVE: .env bestaat niet. Eerst kopiëren en bewerken."
    exit 5
  fi
fi

# Source env zodat wij required waarden kunnen controleren
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}" 2>/dev/null || true
set +a

MISSING=()
[[ -z "${AUTH_SECRET:-}" ]] && MISSING+=("AUTH_SECRET")
[[ -z "${POSTGRES_PASSWORD:-}" ]] && MISSING+=("POSTGRES_PASSWORD")
[[ -z "${NEXT_PUBLIC_APP_URL:-}" ]] && MISSING+=("NEXT_PUBLIC_APP_URL")
if (( ${#MISSING[@]} > 0 )); then
  err ".env ontbreekt VERPLICHTE velden: ${MISSING[*]}"
  err "Zie template: ${ENV_TEMPLATE}"
  exit 5
fi
# AUTH_SECRET minimum lengte 32 chars
if [[ "${#AUTH_SECRET}" -lt 32 ]]; then
  warn "AUTH_SECRET korter dan 32 tekens. Genereer: openssl rand -hex 32"
  [[ "${NON_INTERACTIVE}" -eq 0 ]] && confirm "Toch doorgaan?" || exit 5
fi
# AUTH_TRUST_HOST moet true zijn in productie (Caddy X-Forwarded-Proto)
if [[ "${AUTH_TRUST_HOST:-}" != "true" ]]; then
  warn "AUTH_TRUST_HOST staat NIET op 'true'. Inloggen via Caddy geeft CallbackRouteError!"
  if [[ "${NON_INTERACTIVE}" -eq 0 ]]; then
    if confirm "AUTH_TRUST_HOST NU op 'true' zetten in .env?"; then
      if grep -qE '^AUTH_TRUST_HOST=' "${ENV_FILE}"; then
        sed -i.bak 's|^AUTH_TRUST_HOST=.*|AUTH_TRUST_HOST=true|' "${ENV_FILE}" && rm -f "${ENV_FILE}.bak"
      else
        echo "AUTH_TRUST_HOST=true" >> "${ENV_FILE}"
      fi
      ok "Geschreven."
    fi
  fi
fi

ok ".env gevalideerd."

# ------------------------------------------------------------------------------
# STAP 4 — Database container starten
# ------------------------------------------------------------------------------
title "Database: stm-db (PostgreSQL 16)"

step "Starten: docker compose -f ${COMPOSE_FILE##*/} up -d stm-db"
docker compose -f "${COMPOSE_FILE}" up -d stm-db | tee -a "$LOG_FILE"

step "Wachten tot PostgreSQL healthy..."
MAX_WAIT=60
for i in $(seq 1 "$MAX_WAIT"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-db 2>/dev/null || true)"
  case "$STATUS" in
    healthy) break ;;
    unhealthy)
      err "PostgreSQL UNHEALTHY na ${i}s. Logs:"
      docker logs --tail 60 stm-db 2>&1 | tee -a "$LOG_FILE"
      exit 6
      ;;
    *) ;;
  esac
  sleep 1
  printf '.'
done
printf '\n'
STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-db 2>/dev/null || true)"
[[ "${STATUS}" != "healthy" ]] && { err "PostgreSQL kwam niet healthy binnen ${MAX_WAIT}s."; exit 6; }
ok "PostgreSQL healthy."

# ------------------------------------------------------------------------------
# STAP 5 — Applicatie bouwen (met of zonder cache)
# ------------------------------------------------------------------------------
title "Applicatie: Docker build (stm-app)"

BUILD_FLAGS=()
[[ "${FORCE_REBUILD}" -eq 1 ]] && BUILD_FLAGS+=("--no-cache")
step "docker compose build ${BUILD_FLAGS[*]:-}  (Dit kan 3-8 minuten duren...)"
docker compose -f "${COMPOSE_FILE}" build "${BUILD_FLAGS[@]}" stm-app 2>&1 | tee -a "$LOG_FILE"
ok "Build voltooid."

# ------------------------------------------------------------------------------
# STAP 6 — Applicatie starten (entrypoint.sh doet zelf migrations)
# ------------------------------------------------------------------------------
title "Applicatie: Starten + stack up"

step "docker compose up -d"
docker compose -f "${COMPOSE_FILE}" up -d 2>&1 | tee -a "$LOG_FILE"

step "Wachten tot Next.js healthy..."
APP_MAX=120
for i in $(seq 1 "${APP_MAX}"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-app 2>/dev/null || true)"
  case "$STATUS" in
    healthy) break ;;
    unhealthy)
      # 1 healthcheck falen = nog niet herstart. Als STATUS echt unhealthy is:
      # toon laatste 60 lijnen logs.
      if (( i > 80 )); then
        warn "Next.js health niet optimaal. Laatste logs:"
        docker logs --tail 60 stm-app 2>&1 | tee -a "$LOG_FILE" || true
      fi
      ;;
    *) ;;
  esac
  sleep 1
  if (( i % 15 == 0 )); then printf '\n  [%d/%d] nog wachten...' "$i" "${APP_MAX}"; fi
done
printf '\n'

STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-app 2>/dev/null || true)"
if [[ "${STATUS}" == "healthy" ]]; then
  ok "Next.js healthy."
else
  warn "Healthcheck status: ${STATUS}. App is wellicht nog aan het opstarten."
  warn "Laatste applicatielogs (60 regels):"
  docker logs --tail 60 stm-app 2>&1 | tee -a "$LOG_FILE" || true
fi

# ------------------------------------------------------------------------------
# STAP 7 — Eind-controle (HTTP check + connectiviteit backend)
# ------------------------------------------------------------------------------
title "Eindcontrole"

APP_URL="${NEXT_PUBLIC_APP_URL}"
info "NEXT_PUBLIC_APP_URL: ${APP_URL}"

# Local host check via 127.0.0.1:3000 (rechtstreeks, niet via Caddy)
HTTP_CODE_LOCAL="000"
if require_cmd curl; then
  HTTP_CODE_LOCAL="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 8 \
    --connect-timeout 5 --retry 2 --insecure http://127.0.0.1:3000 2>/dev/null || true)"
fi
case "$HTTP_CODE_LOCAL" in
  200|301|302|307|308) ok "App endpoint OK via 127.0.0.1:3000 (HTTP ${HTTP_CODE_LOCAL})." ;;
  *) warn "App niet bereikbaar via 127.0.0.1:3000 (HTTP ${HTTP_CODE_LOCAL}). Check logs." ;;
esac

# Publieke URL check (optioneel)
if [[ -n "${APP_URL}" ]]; then
  info "Probeer ${APP_URL}..."
  HTTP_CODE_PUB="000"
  if require_cmd curl; then
    HTTP_CODE_PUB="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 15 \
      --connect-timeout 8 --retry 2 --insecure "${APP_URL}" 2>/dev/null || true)"
  fi
  case "$HTTP_CODE_PUB" in
    200|301|302|307|308) ok "App bereikbaar via ${APP_URL} (HTTP ${HTTP_CODE_PUB})." ;;
    *) warn "App nog NIET bereikbaar via ${APP_URL} (HTTP ${HTTP_CODE_PUB})."
       warn "Meest voorkomende oorzaken: Caddy niet gestart, DNS record mistig, of poort 80/443 dicht in firewall." ;;
  esac
fi

# ------------------------------------------------------------------------------
# STAP 8 — Caddy (hint: op host of als container; install hint)
# ------------------------------------------------------------------------------
title "Caddy Reverse Proxy — Tips"

CANDIDATE_DOMAIN="${STM_DOMAIN:-${NEXUS_DOMAIN:-localhost}}"
if require_cmd caddy; then
  ok "Caddy binary GEVONDEN op host."
  info "Wanneer je Caddy op de HOST installeert (aanbevolen i.p.v. container):"
  cat <<EOF | tee -a "$LOG_FILE"
    1. Kopieer Caddyfile:    sudo cp Caddyfile /etc/caddy/Caddyfile
    2. Edit indien nodig:    sudo nano /etc/caddy/Caddyfile  (app URL = 127.0.0.1:3000)
    3. Import env:           printf 'STM_DOMAIN=${CANDIDATE_DOMAIN}\nSTM_APP_URL=127.0.0.1:3000\n' | sudo tee /etc/caddy/.env
    4. Herlaad:              sudo systemctl reload caddy
EOF
else
  warn "Caddy NIET gevonden op host. Installeer optioneel (Ubuntu):"
  cat <<EOF | tee -a "$LOG_FILE"
       sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
       curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
       curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
       sudo apt update && sudo apt install caddy
EOF
  info "Alternatief: Caddy als Docker container (zie voorbeeld in dev docker-compose.yml)."
fi

# ------------------------------------------------------------------------------
# STAP 9 — SSH tunnel documentatie (P0.4: Database toegang)
# ------------------------------------------------------------------------------
title "Database GUI Access — via SSH Tunnel (SECURITY-FIRST)"
cat <<EOF | tee -a "$LOG_FILE"

STAP-BY-STAP — GUI TOEGANG TOT POSTGRES (VANAF JE EIGEN MACHTIGE, NIET VANAF VPS):

  ⚠  POORT 5432 STAAT IN DE VPS-FIREWALL EN IN docker-compose.prod.yml
     DICHT NAAR HET INTERNET. DOET NIET OPEN ZETTEN!
     Gebruik ALLEEN een SSH-tunnel.

  1) Open op je eigen laptop / Mac een terminal.
  2) Start een SSH-tunnel:

         ssh -v -N -L 5432:localhost:5432 <JE-VPS-USER>@<VPS-IP>

     - `-L 5432:localhost:5432` → lokaal 5432 forward via VPS naar localhost:5432 VANAF DE VPS.
     - Docker exposeert stm-db op 127.0.0.1 van VPS NIET.
       Daarom MOET je eerst in docker-compose.prod.yml de regels
         # ports:
         #   - "127.0.0.1:5432:5432"
       even UITCOMMENTEREN (verwijder #) en herstart:
         docker compose -f docker-compose.prod.yml up -d stm-db
       → Daarna werkt de SSH-tunnel.

  3) Nu verbindt je GUI (DBeaver, DataGrip, etc.) naar:
       Host:       localhost
       Poort:      5432
       Gebruiker:  ${POSTGRES_USER:-stm}
       Wachtwoord: (inhoud van POSTGRES_PASSWORD in .env)
       Database:   ${POSTGRES_DB:-stm}
       Schema:     public

  4) Sluit de tunnel met Ctrl+C in de SSH-terminal.

  ⚠  VERGEET NIET: na GUI-sessie, kan je 127.0.0.1:5432 expose IN docker-compose.prod.yml
     weer in commentaar zetten (extra voorzorg). Is wel 127.0.0.1-only, dus nooit van buiten.

EOF

# ------------------------------------------------------------------------------
# STAP 10 — Samenvatting + handige opdrachten
# ------------------------------------------------------------------------------
title "Deploy afgerond — Samenvatting"
hr
cat <<EOF | tee -a "$LOG_FILE"
  ${BLD}✅ STM Deployment — Voltooid.${RST}

  ${CYN}App URL         :${RST}  ${APP_URL:-"<NEXT_PUBLIC_APP_URL niet gezet>"}
  ${CYN}Domein          :${RST}  ${CANDIDATE_DOMAIN:-localhost}
  ${CYN}Containers      :${RST}  stm-app, stm-db

  ${CYN}Status controleren  :${RST}  docker compose -f ${COMPOSE_FILE} ps
  ${CYN}Logs App            :${RST}  docker compose -f ${COMPOSE_FILE} logs -f stm-app
  ${CYN}Logs DB             :${RST}  docker compose -f ${COMPOSE_FILE} logs -f stm-db
  ${CYN}Stoppen             :${RST}  docker compose -f ${COMPOSE_FILE} down
  ${CYN}Opstarten           :${RST}  docker compose -f ${COMPOSE_FILE} up -d
  ${CYN}Update (git pull)   :${RST}  bash scripts/deploy-stm.sh --skip-docker
                                     (--force-rebuild indien build-cache moet leeg)

  ${DIM}Defaults seed admin (indien je PRISMA SEED gedraaid hebt):
    admin@nexus.local  /  Test1234!${RST}
    (Direct na eerste login wachtwoord wijzigen.)
EOF
hr
ok "Deployment voltooid."
