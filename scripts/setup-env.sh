#!/usr/bin/env bash
# ============================================================
# Nexus - setup-env.sh
# Genereert/valideert .env voor productie-installatie.
# Idempotent: overschrijft geen bestaande waarden tenzij met -f.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_TEMPLATE="$ROOT_DIR/.env.production.example"
# Template fallbacks: als .env.production.example ontbreekt (oude checkouts), probeer dan de oude.
[[ ! -f "$ENV_TEMPLATE" ]] && ENV_TEMPLATE="$ROOT_DIR/.env.example"
FORCE=0

RED="\e[31m"; GRN="\e[32m"; YLW="\e[33m"; CYN="\e[36m"; BLD="\e[1m"; RST="\e[0m"

usage() {
  cat <<EOF
Gebruik: $0 [OPTIES]

Genereert .env voor Nexus met veilige defaults en interactieve prompts.

Opties:
  -f, --force     Overschrijf ook bestaande waarden.
  -h, --help      Toon deze help.
  --non-interactive   Gebruik uitsluitend defaults; geen prompts.
                      (Handig voor CI / geautomatiseerde installs.)
EOF
}

NON_INTERACTIVE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--force)           FORCE=1; shift ;;
    -h|--help)            usage; exit 0 ;;
    --non-interactive)    NON_INTERACTIVE=1; shift ;;
    *) echo -e "${RED}Onbekende optie: $1${RST}"; usage; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

info()  { echo -e "${CYN}ℹ  $*${RST}"; }
ok()    { echo -e "${GRN}✔  $*${RST}"; }
warn()  { echo -e "${YLW}⚠  $*${RST}"; }
err()   { echo -e "${RED}✖  $*${RST}" >&2; }
title() { echo -e "\n${BLD}── $* ──${RST}"; }

# --- Helpers -------------------------------------------------

ensure_var() {
  local key="$1" default="$2" prompt_msg="$3"
  local current=""

  if [[ -f "$ENV_FILE" ]]; then
    current="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
    current="${current%\"}"; current="${current#\"}"
  fi

  local value=""
  if [[ -n "$current" && "$FORCE" -eq 0 ]]; then
    value="$current"
    info "$key: behoud bestaande waarde (${#value} tekens)."
  elif [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    value="$default"
    info "$key: ingesteld op default (non-interactive)."
  else
    local hint=""
    [[ -n "$default" ]] && hint=" [${default}]"
    echo -ne "${CYN}?${RST} ${prompt_msg}${hint}: "
    read -r value
    [[ -z "$value" ]] && value="$default"
  fi

  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # Escapen voor sed: & / \ delimiters
    local escaped
    escaped="$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')"
    sed -i.bak "s|^${key}=.*|${key}=\"${escaped}\"|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    echo "${key}=\"${value}\"" >> "$ENV_FILE"
  fi
}

rand_hex()   { openssl rand -hex "${1:-32}" | tr -d '\n'; }
rand_b64()   { openssl rand -base64 "${1:-24}" | tr -d '\n/' | cut -c1-32; }

detect_default_url() {
  if command -v hostname >/dev/null 2>&1; then
    local h fqdn
    h="$(hostname -s 2>/dev/null || hostname)"
    fqdn="$(hostname -f 2>/dev/null || true)"
    if [[ -n "$fqdn" && "$fqdn" != *"localhost"* && "$fqdn" == *.* ]]; then
      echo "https://${fqdn}"
      return
    fi
    if command -v curl >/dev/null 2>&1; then
      local ip
      ip="$(curl -s --connect-timeout 2 https://ifconfig.me 2>/dev/null || true)"
      if [[ -n "$ip" ]]; then
        echo "http://${ip}:3000"
        return
      fi
    fi
  fi
  echo "http://localhost:3000"
}

# --- Main ----------------------------------------------------

title "Nexus .env setup"

if [[ ! -f "$ENV_TEMPLATE" ]]; then
  err "Template $ENV_TEMPLATE ontbreekt!"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  info "Aanmaken .env vanuit template..."
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  ok ".env aangemaakt."
fi

# AUTH_SECRET (minimaal 32 chars)
AUTH_DEFAULT="$(rand_hex 32)"
ensure_var "AUTH_SECRET" "$AUTH_DEFAULT" "Auth secret (laat leeg voor autogenerate)"

# POSTGRES_PASSWORD
PGPASS_DEFAULT="$(rand_b64 24)"
ensure_var "POSTGRES_PASSWORD" "$PGPASS_DEFAULT" "PostgreSQL wachtwoord (laat leeg voor autogenerate)"

# POSTGRES_DB / POSTGRES_USER (met defaults)
ensure_var "POSTGRES_DB"   "stm" "PostgreSQL database naam"
ensure_var "POSTGRES_USER" "stm" "PostgreSQL gebruikersnaam"

# NEXT_PUBLIC_APP_URL
DEFAULT_URL="$(detect_default_url)"
ensure_var "NEXT_PUBLIC_APP_URL" "$DEFAULT_URL" "Publieke App URL (bijv. https://stm.jouwdomein.nl)"

# AUTH_URL: default naar NEXT_PUBLIC_APP_URL + /api/auth
APP_URL="$(grep -E '^NEXT_PUBLIC_APP_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
AUTH_URL_DEFAULT="${APP_URL%/}/api/auth"
ensure_var "AUTH_URL" "$AUTH_URL_DEFAULT" "Auth callback URL (laat leeg = <APP_URL>/api/auth)"

# AUTH_TRUST_HOST: VERPLICHT voor productie i.c.m. Caddy reverse proxy.
ensure_var "AUTH_TRUST_HOST" "true" "Auth.js vertrouwt X-Forwarded headers van reverse proxy (aanbevolen: true)"

# STM_DOMAIN: publiek domein (voor Caddy HTTPS).
PROTO="$(echo "$APP_URL" | grep -oE '^https?://' || true)"
DOMAIN_DEFAULT="$(echo "${APP_URL#"$PROTO"}" | cut -d: -f1 | cut -d/ -f1)"
if [[ "$DOMAIN_DEFAULT" == "localhost" || "$DOMAIN_DEFAULT" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  DOMAIN_DEFAULT=""
fi
ensure_var "STM_DOMAIN" "$DOMAIN_DEFAULT" "Publiek domein (voor Caddy HTTPS). Leeg = localhost/IP zonder TLS"
# Compat oude NEXUS_DOMAIN env var (Caddyfile accepteert ook NEXUS_DOMAIN)
ensure_var "NEXUS_DOMAIN" "\${STM_DOMAIN:-}" "Compat NEXUS_DOMAIN (laat leeg = gebruikt STM_DOMAIN)"

NODE_ENV_DEFAULT="production"
ensure_var "NODE_ENV" "$NODE_ENV_DEFAULT" "Node environment"

TZ_DEFAULT="Europe/Amsterdam"
ensure_var "TZ" "$TZ_DEFAULT" "Tijdzone"

ok ".env configuratie voltooid."
echo ""
echo ""
echo -e "${BLD}Volgende stap:${RST}"
echo -e "   ${CYN}bash $ROOT_DIR/scripts/deploy-stm.sh${RST}   (productie, VPS — docker-compose.prod.yml)"
echo -e "   ${CYN}bash $ROOT_DIR/scripts/install.sh${RST}    (lokaal/dev — docker-compose.dev pattern)"
