#!/usr/bin/env bash
# ==============================================================================
# nexus-install.sh — ONE-CLICK STM (voorheen Nexus) Installer voor Ubuntu Server
# Repository: https://github.com/SeguiloNL/Nexus
# Idempotent: meerdere keren draaien is VEILIG.
# Strict:    set -Eeuo pipefail + ERR-trap (iedere fout stopt METEEN, met duidelijke melding).
#
# Installatie bestaat UIT:
#   - OS hardening (update, minimale pakketten, fail2ban + auto security patches)
#   - Tijdsynchronisatie (systemd-timesyncd, NL NTP-pool) + nl_NL.UTF-8 locale
#   - PostgreSQL 16 client, zstd/pigz compressie, acl
#   - 1,5x RAM swapfile (overslaan met --skip-swap)
#   - Firewall (UFW): alleen 22 (SSH), 80/443 (HTTPS). 5432 ALTIJD DICHT!
#   - Sysctl hardening (swappiness, file descriptors, socket backlog) + limits.conf
#   - Non-root gebruiker "stm" (sudo + docker groep, SSH keys geconserveerd)
#   - Docker Engine (officiële apt repo, met log-rotation daemon.json)
#   - Caddy reverse proxy (Let's Encrypt HTTPS, security headers, X-Forwarded-*)
#   - Code: AUTO download van GitHub (https://github.com/SeguiloNL/Nexus) tenzij overschreven
#   - .env AUTO-GENERATIE: AUTH_SECRET (32 hex) + POSTGRES_PASSWORD (24 base64) + STM_DOMAIN
#   - Docker build (stm-app + stm-db) + up -d (migrations via entrypoint.sh, Prisma migrate deploy)
#   - (Optioneel --seed) Demo-gebruikers en demo-data via prisma/seed.mjs
#   - Automatische backups (P2.1) systemd timer 03:00 NL, rotatie 7d/4w/3m + rsync optie
#   - Post-install summary: URL + credentials + troubleshooting tips
#
# ========================  STANDAARD ONE-LINER (DIRECT VANAF GITHUB)  ========================
# Kopieer en plak in je Ubuntu VPS (als root / sudo-gebruiker):
#   curl -sSL https://raw.githubusercontent.com/SeguiloNL/Nexus/main/nexus-install.sh \
#     | sudo bash -s -- --domain stm.jouwdomein.nl --email hostmaster@jouwdomein.nl --seed
# ============================================================================================
#
# Alle argumenten:
#   --domain <FULL-DOMAIN>         Publiek domein (bv. stm.jouwdomein.nl). ZONDER = localhost/test zonder TLS.
#   --git-url <URL>                Git-repo URL. DEFAULT: https://github.com/SeguiloNL/Nexus.git
#   --install-dir <PATH>           Waar de code komt te staan. Default: /opt/stm
#   --email <E-MAIL>               (Optioneel) Let's Encrypt e-mailadres voor verlopeningsmeldingen.
#   --ssh-key <FILE-or-STRING>     (Optioneel) Pad naar pubkey, of de letterlijke pubkey. Wordt aan ~stm/.ssh/authorized_keys toegevoegd.
#   --seed                         (Optioneel) Draai prisma db seed (3 gebruikers + demo data).
#   --no-caddy                     (Optioneel) Installeer GEEN Caddy (bv. als je al nginx/traefik hebt).
#   --skip-swap                    (Optioneel) Geen swapfile aanmaken (bv. als er al swap is).
#   --non-interactive              (Optioneel) Geen J/N vragen (voor CI / Ansible).
#   -h, --help                     Deze help.
# ==============================================================================
set -Eeuo pipefail

# ------------------------------------------------------------------------------
# 0. Globals, logging, colors, helpers
# ------------------------------------------------------------------------------
INSTALL_SCRIPT_NAME="nexus-install.sh"
INSTALLER_VERSION="1.1.0"
INSTALL_START_EPOCH="$(date +%s)"
DEFAULT_INSTALL_DIR="/opt/stm"
DEFAULT_SWAP_MULTIPLIER="1.5"
DEFAULT_GIT_URL="https://github.com/SeguiloNL/Nexus.git"
DEFAULT_GIT_BRANCH="${DEFAULT_GIT_BRANCH:-main}"

# --- Logging: EERST placeholder (/tmp, altijd schrijfbaar). NA root-check zetten we hem om naar /var/log/stm-install.
LOG_DIR_TMP="${TMPDIR:-/tmp}/stm-install"
LOG_FILE="${LOG_DIR_TMP:-/tmp}/install-$(date +%Y%m%d-%H%M%S)-$$.log"
mkdir -p "$LOG_DIR_TMP" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="/dev/null"
# exec 2> >(tee -a ... >&2) UITGESTELD: zie STAP 0b init_logging() NA root-check.

# ANSI colors (geen color indien geen tty of NO_COLOR=1)
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; CYN=$'\e[36m'; BLU=$'\e[34m'
  BLD=$'\e[1m'; DIM=$'\e[2m'; RST=$'\e[0m'
else
  RED=""; GRN=""; YLW=""; CYN=""; BLU=""; BLD=""; DIM=""; RST=""
fi

# --- Flags ---
DOMAIN=""
GIT_URL=""
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
EMAIL=""
SSH_KEY_ARG=""
SEED=0
NO_CADDY=0
SKIP_SWAP=0
NON_INTERACTIVE=0
SHOW_HELP=0

# --- Gebruiker / OS ---
STM_USER="stm"
STM_GROUP="stm"
STM_HOME="/home/${STM_USER}"
TZ_VALUE="${TZ:-Europe/Amsterdam}"

# ------------------------------------------------------------------------------
# 0a. Helpers
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
${BLD}nexus-install.sh v${INSTALLER_VERSION}${RST} — One-click STM installer voor Ubuntu 22.04/24.04 LTS.
Repository: ${CYN}${DEFAULT_GIT_URL}${RST}

${BLD}Gebruik:${RST}
  sudo bash $0 [OPTIONS]

${BLD}Vereisten:${RST}
  - OS: Ubuntu 22.04 LTS of 24.04 LTS (x86_64 of arm64)
  - Min. 1 GB RAM, 10 GB SSD, 1 vCPU. (2 GB + swap AANBEVOLEN)
  - Root of sudo (draai het met sudo; NIET als ingelogde non-root sudoer zonder sudo)
  - DNS A/AAAA record: ${CYN}--domain${RST} waarde moet al wijzen naar DEZE VPS (voor TLS)
  - Indien Git-branch anders dan 'main': exporteer DEFAULT_GIT_BRANCH=feature/test

${BLD}Belangrijkste Opties:${RST}
  --domain <FULL-DOMAIN>        Publiek domein (bv. stm.jouwdomein.nl). Laat weg voor localhost/test zonder TLS.
  --git-url <URL>               Git repo URL. DEFAULT: ${CYN}${DEFAULT_GIT_URL}${RST}
  --install-dir <PATH>          Installatiemap. Default ${DEFAULT_INSTALL_DIR}
  --email <E-MAIL>              (Optioneel) Let's Encrypt contact-e-mail (verlopeningsmeldingen).
  --ssh-key <FILE-or-STRING>    (Optioneel) Pad of letterlijke public key voor gebruiker '${STM_USER}'.
  --seed                        Draai prisma db seed (3 demo-gebruikers + data).
  --no-caddy                    Installeer GEEN Caddy (je hebt al nginx/traefik).
  --skip-swap                   Maak GEEN swapfile (bv. als er al swap is of je wilt 0 swap).
  --non-interactive             Geen J/N vragen (CI / Ansible).
  -h, --help                    Deze help.

${BLD}Voorbeelden:${RST}
  # ================================================================
  # 1) ONE-LINER — DIRECT VANAF GITHUB (AANBEVOLEN)
  #    Download alleen dit script en alles (code + installatie) gaat automatisch.
  # ================================================================
  curl -sSL https://raw.githubusercontent.com/SeguiloNL/Nexus/${DEFAULT_GIT_BRANCH}/nexus-install.sh \\
    | sudo bash -s -- \\
        --domain stm.mijnbedrijf.nl \\
        --email hostmaster@mijnbedrijf.nl \\
        --seed

  # ================================================================
  # 2) Eerste install — script bestond al lokaal
  # ================================================================
  sudo bash $0 \\
    --domain stm.mijnbedrijf.nl \\
    --email hostmaster@mijnbedrijf.nl \\
    --seed

  # ================================================================
  # 3) Lokaal testen zonder TLS (bestaande code)
  # ================================================================
  sudo bash $0 --non-interactive --skip-swap
EOF
}

info()  { printf '%bℹ  %s%b\n' "${CYN}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
ok()    { printf '%b✔  %s%b\n' "${GRN}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
warn()  { printf '%b⚠  %s%b\n' "${YLW}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
err()   { printf '%b✖  %s%b\n' "${RED}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
title() { printf '\n%b┌─ %s%b\n' "${BLD}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
step()  { printf '%b▸ %s%b\n' "${BLU}" "$*" "${RST}" | tee -a "$LOG_FILE" >&2 ; }
hr()    { printf '%b─────────────────────────────────────────────────────────────%b\n' "${DIM}" "${RST}" | tee -a "$LOG_FILE" >&2 ; }

confirm() {
  local msg="$1" default="${2:-y}"
  [[ "$NON_INTERACTIVE" -eq 1 ]] && return 0
  local hint="[Y/n]"
  [[ "$default" == "n" ]] && hint="[y/N]"
  printf '%b?%b %s %s ' "${CYN}" "${RST}" "${msg}" "${hint}"
  read -r ans
  ans="${ans,,}"
  [[ -z "$ans" ]] && ans="$default"
  [[ "$ans" == "y" || "$ans" == "yes" || "$ans" == "j" || "$ans" == "ja" ]]
}

require_cmd() { command -v "$1" >/dev/null 2>&1 ; }

on_error() {
  local line="$1"
  local cmd="$2"
  hr
  err "Installer FAILED op regel ${line}: ${cmd}"
  err "Volledig logbestand: ${LOG_FILE}"
  err "Los het probleem op, je kunt het script VEILIG opnieuw draaien (idempotent)."
  exit 1
}
trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

# ------------------------------------------------------------------------------
# 0b. Argument parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)          [[ $# -ge 2 ]] || { err "--domain heeft een argument."; usage; exit 2; }; DOMAIN="$2"; shift 2 ;;
    --git-url)         [[ $# -ge 2 ]] || { err "--git-url heeft een argument."; usage; exit 2; }; GIT_URL="$2"; shift 2 ;;
    --install-dir)     [[ $# -ge 2 ]] || { err "--install-dir heeft een argument."; usage; exit 2; }; INSTALL_DIR="$2"; shift 2 ;;
    --email)           [[ $# -ge 2 ]] || { err "--email heeft een argument."; usage; exit 2; }; EMAIL="$2"; shift 2 ;;
    --ssh-key)         [[ $# -ge 2 ]] || { err "--ssh-key heeft een argument."; usage; exit 2; }; SSH_KEY_ARG="$2"; shift 2 ;;
    --seed)            SEED=1; shift ;;
    --no-caddy)        NO_CADDY=1; shift ;;
    --skip-swap)       SKIP_SWAP=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help)         SHOW_HELP=1; shift ;;
    *) err "Onbekende optie: $1"; usage; exit 2 ;;
  esac
done

# Defaults na parsing
[[ -z "${GIT_URL:-}" ]] && GIT_URL="${DEFAULT_GIT_URL}"
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
[[ "$SHOW_HELP" -eq 1 ]] && { usage; exit 0; }

# ==============================================================================
# STAP 0.1 — Anti-recursie dead-man switch (laatste redmiddel, voorkomt oneindige lus).
#            Maximaal 3 her-execs (bootstrap + sudo escalatie + update). Daarna foutmelding.
# ==============================================================================
STM_RUN_COUNT="${STM_RUN_COUNT:-0}"
STM_RUN_COUNT=$(( STM_RUN_COUNT + 1 ))
export STM_RUN_COUNT
if (( STM_RUN_COUNT > 3 )); then
  echo "✖  FATALE FOUT: Installer heeft zichzelf ${STM_RUN_COUNT}x herstart (oneindige lus detectie)." >&2
  echo "   Stop. Los het probleem op en start opnieuw." >&2
  exit 10
fi

# ------------------------------------------------------------------------------
# STAP 0.2 — /etc/hosts hostname fix (als het KAN: indien root of writable).
#            Voorkomt "sudo: unable to resolve host cloud.example.com" warning.
# ------------------------------------------------------------------------------
fix_etc_hosts() {
  local h
  h="$(hostname 2>/dev/null || true)"
  local fqdn
  fqdn="$(hostname -f 2>/dev/null || true)"
  # Als beide resolven → niets doen.
  if [[ -n "$h" && -n "$fqdn" ]] && getent hosts "$fqdn" >/dev/null 2>&1 && getent hosts "$h" >/dev/null 2>&1; then
    return 0
  fi
  # /etc/hosts niet schrijfbaar → overslaan (wordt later als root opnieuw gedaan).
  [[ ! -w /etc/hosts ]] && return 0
  local to_add=()
  [[ -n "$fqdn" && "$fqdn" != *" "* ]] && to_add+=("$fqdn")
  [[ -n "$h" && ! " ${to_add[*]} " =~ " $h " ]] && to_add+=("$h")
  # Voeg 127.0.0.1 en 127.0.1.1 rijen toe
  if (( ${#to_add[@]} > 0 )); then
    local line_plain="127.0.1.1 ${to_add[*]}"
    if ! grep -qF "$line_plain" /etc/hosts 2>/dev/null; then
      # Zorg voor een newline op het eind
      tail -c 1 /etc/hosts 2>/dev/null | read -r _ || echo >> /etc/hosts 2>/dev/null || true
      echo "$line_plain" >> /etc/hosts 2>/dev/null || true
      # 127.0.0.1 tevens
      local line_loop="127.0.0.1 ${to_add[*]}"
      grep -qF "$line_loop" /etc/hosts 2>/dev/null || echo "$line_loop" >> /etc/hosts 2>/dev/null || true
    fi
  fi
}
fix_etc_hosts || true

# ==============================================================================
# STAP 0.3 — EERST: Root / sudo controleren (VOOR we bootstrap of iets anders doen).
#             We gebruiken MEERDERE checks zodat escalatie MAXIMAAL 1x gebeurt.
# ==============================================================================
escalated=0
if [[ -n "${SUDO_ESCALATED:-}" && "${SUDO_ESCALATED}" == "1" ]]; then escalated=1; fi
if [[ -n "${SUDO_USER:-}" ]]; then escalated=1; fi
if [[ "$EUID" -eq 0 ]]; then escalated=1; fi

if [[ "$escalated" -eq 0 ]]; then
  # NIET root en NIET geëscaleerd → probeer sudo.
  if require_cmd sudo; then
    # Test of sudo zonder wachtwoord MAG (non-interactive).
    if sudo -n true 2>/dev/null; then
      export SUDO_ESCALATED=1
      exec sudo -H -E --preserve-env=HOME,PATH,NO_COLOR,TZ,STM_RUN_COUNT,SUDO_ESCALATED,STM_BOOTSTRAPPED,DEFAULT_GIT_BRANCH \
        bash "$0" "$@"
    fi
    # sudo -n (zonder wachtwoord) mag niet. Vraag gebruiker om handmatig sudo.
    cat <<'EOT' >&2
┌──────────────────────────────────────────────────────────────────────────────┐
│  💡 NIET als root gedraaid EN sudo vereist een wachtwoord.                    │
│                                                                              │
│  KORTE OPLOSSING (voer deze exact uit):                                      │
│    sudo -E bash "$0" $@                                                      │
│   OF (als $0 alleen bestandsnaam is, GEEN absoluut pad):                     │
│    sudo -E bash ./nexus-install.sh --domain stm.jouwdomein.nl --seed         │
│                                                                              │
│  sudo zal nu jouw wachtwoord vragen (1x). Daarna gaat alles automatisch.     │
└──────────────────────────────────────────────────────────────────────────────┘
EOT
    exit 3
  fi
  echo "✖  Geen sudo gevonden en niet als root gedraaid. Installeer sudo of draai als root." >&2
  exit 3
fi

# Nu ZEKER root: init logging (schrijft naar /var/log/stm-install)
# ------------------------------------------------------------------------------
# Helper: init_logging: als EUID=root → /var/log/stm-install, anders /tmp fallback.
# Zet ook exec 2>> tee redirect zodat stderr ook in logfile staat.
init_logging() {
  local want_dir="/var/log/stm-install"
  if [[ "$EUID" -eq 0 ]]; then
    if mkdir -p "$want_dir" 2>/dev/null && [[ -d "$want_dir" && -w "$want_dir" ]]; then
      LOG_DIR="$want_dir"
      LOG_FILE="${LOG_DIR}/install-$(date +%Y%m%d-%H%M%S).log"
      : > "$LOG_FILE" 2>/dev/null || true
      chmod 0640 "$LOG_FILE" 2>/dev/null || true
    fi
  fi
  # Kopieer eerdere /tmp log naar nieuw bestand (indien bestaat en verschillend)
  local old_log=""
  old_log="$(ls -t /tmp/stm-install/install-*-$$.log 2>/dev/null | head -1 || true)"
  if [[ -n "${old_log:-}" && -s "$old_log" && "${old_log}" != "${LOG_FILE}" ]]; then
    cat "$old_log" >> "$LOG_FILE" 2>/dev/null || true
  fi
  # stderr ook naar log (naast al bestaande stdout tee in helpers).
  if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" ]]; then
    exec 2> >(tee -a "$LOG_FILE" >&2) 2>/dev/null || true
  fi
}
init_logging

# Nu als root: /etc/hosts fix OPNIEUW (eerste poging was non-root en mislukte mogelijk door permissies)
fix_etc_hosts || true

# ------------------------------------------------------------------------------
# BOOTSTRAP: Zorg dat de VOLLEDIGE REPO lokaal staat (ook als je alleen het script
#            downloadde via `curl | bash`). Als benodigde bestanden ontbreken:
#            clone de repo, copy dit script erin, en RE-EXEC jezelf.
# ------------------------------------------------------------------------------
# Vereiste bestanden (moeten in INSTALL_DIR staan of in de huidige script-dir)
REQ_FILES=(
  "docker-compose.prod.yml"
  ".env.production.example"
  "Caddyfile"
  "scripts/backup-stm-db.sh"
  "deploy/stm-db-backup.service"
  "deploy/stm-db-backup.timer"
)

repo_files_present_in() {
  local d="$1"
  [[ -z "$d" || ! -d "$d" ]] && return 1
  local f
  for f in "${REQ_FILES[@]}"; do
    if [[ ! -f "${d}/${f}" ]]; then
      return 1
    fi
  done
  return 0
}

bootstrap_repo_if_needed() {
  # Sla over als we al ge-bootstrapte zijn (voorkom oneindige lus)
  if [[ "${STM_BOOTSTRAPPED:-}" == "1" ]]; then
    info "Bootstrap: reeds gedaan (STM_BOOTSTRAPPED=1). Overslaan."
    return 0
  fi
  # Bepaal in welke map we al dan niet zoeken
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P 2>/dev/null || echo /tmp)"
  local search_dirs=()
  [[ -n "${INSTALL_DIR:-}" && -d "${INSTALL_DIR:-}" ]] && search_dirs+=("$INSTALL_DIR")
  [[ "$script_dir" != "/" ]] && search_dirs+=("$script_dir")
  search_dirs+=("$(pwd -P 2>/dev/null || echo /tmp)")
  local d
  for d in "${search_dirs[@]}"; do
    if repo_files_present_in "$d"; then
      info "Bootstrap: repo aanwezig in ${d}."
      # Zorg dat INSTALL_DIR ook echt naar deze map wijst
      INSTALL_DIR="$d"
      return 0
    fi
  done

  # --- Benodigde bestanden ontbreken. Clone de repo, copy dit script, re-exec. ---
  # Minimale apt: zorg dat git/curl/ca-certificates bestaan (zelfs in een kale Ubuntu)
  export DEBIAN_FRONTEND=noninteractive
  local bootstrap_tmpdir=""
  if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "ℹ  Bootstrap: apt install git/curl/ca-certificates (1e setup...)" | tee -a "$LOG_FILE" >&2
    for _ in 1 2 3; do apt-get update -y >/dev/null 2>&1 && break || sleep 3; done
    apt-get install -y --no-install-recommends git curl ca-certificates >/dev/null 2>&1 || true
  fi
  # Bepaal target dir voor clone
  local target="${INSTALL_DIR}"
  mkdir -p "$target" 2>/dev/null || true
  if ! repo_files_present_in "$target"; then
    printf 'ℹ  Bootstrap: %s klonen naar %s ...\n' "$GIT_URL" "$target" | tee -a "$LOG_FILE" >&2
    bootstrap_tmpdir="$(mktemp -d /tmp/stm-clone-XXXXXX)"
    # Clone (depth 1 voor snelheid) met branch indien bekend
    local clone_branch=()
    if [[ -n "${DEFAULT_GIT_BRANCH:-}" ]]; then
      clone_branch=(--branch "${DEFAULT_GIT_BRANCH}")
    fi
    # Run clone in tmp, dan move naar target (atomic)
    if ! git clone --depth 1 "${clone_branch[@]}" "${GIT_URL}" "${bootstrap_tmpdir}/repo" 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2; then
      # fallback: zonder branch spec (wellicht bestaat branch niet, default HEAD van remote pakken)
      git clone --depth 1 "${GIT_URL}" "${bootstrap_tmpdir}/repo" 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2
    fi
    # Bestanden verplaatsen naar target (atomic, ook als target al deels gevuld was)
    if [[ -d "${bootstrap_tmpdir}/repo" ]]; then
      shopt -s dotglob nullglob
      local item
      for item in "${bootstrap_tmpdir}/repo"/*; do
        local base="${item##*/}"
        if [[ -e "${target}/${base}" ]]; then
          # Bestaande bestanden niet overschrijven, tenzij het het install script zelf is
          [[ "${base}" == "nexus-install.sh" || "${base}" == "stm-install.sh" ]] && mv -f "${item}" "${target}/${base}" || true
        else
          mv -f "${item}" "${target}/${base}"
        fi
      done
      shopt -u dotglob nullglob
    fi
    rm -rf "${bootstrap_tmpdir}"
  fi

  # Kopieer DIT SCRIPT (zelfs als het uit /dev/stdin pipe kwam) naar de target repo
  local self_in_target="${target}/nexus-install.sh"
  # Als we al op een schijfbestand zitten en gelijk zijn: skip.
  if [[ -f "$0" ]] && [[ "$(realpath "$0" 2>/dev/null || echo "$0")" != "$(realpath "${self_in_target}" 2>/dev/null || echo "${self_in_target}")" ]]; then
    cp -af "$0" "${self_in_target}" 2>/dev/null || true
  fi
  if [[ ! -f "${self_in_target}" ]]; then
    if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
      cp -af "${BASH_SOURCE[0]}" "${self_in_target}" 2>/dev/null || true
    fi
    if [[ ! -f "${self_in_target}" ]]; then
      err "Bootstrap: kon install-script niet kopiëren naar repo (target: ${self_in_target}). Download het handmatig via: curl -sSLo ${self_in_target} https://raw.githubusercontent.com/SeguiloNL/Nexus/${DEFAULT_GIT_BRANCH}/nexus-install.sh"
      exit 9
    fi
  fi
  chmod +x "${self_in_target}" 2>/dev/null || true

  # --- RE-EXEC: zelfde script, nu in de target repo, met STM_BOOTSTRAPPED=1 + alle originele args ---
  local pass_args=()
  local has_install_dir=0
  local a
  for a in "$@"; do [[ "$a" == "--install-dir" ]] && has_install_dir=1; done
  pass_args=("$@")
  if [[ "$has_install_dir" -eq 0 ]]; then
    pass_args+=(--install-dir "${target}")
  fi
  export STM_BOOTSTRAPPED=1
  echo "ℹ  Bootstrap: herstart installer vanuit ${self_in_target} (STM_RUN_COUNT=${STM_RUN_COUNT})..." | tee -a "$LOG_FILE" >&2
  exec bash "${self_in_target}" "${pass_args[@]}"
  # exec komt NOOIT terug.
}
bootstrap_repo_if_needed "$@"
# Update globale paden (kloon nu in INSTALL_DIR)
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.prod.yml"
ENV_FILE="${INSTALL_DIR}/.env"
ENV_TEMPLATE="${INSTALL_DIR}/.env.production.example"
BACKUP_SCRIPT_SRC="${INSTALL_DIR}/scripts/backup-stm-db.sh"
BACKUP_SERVICE_SRC="${INSTALL_DIR}/deploy/stm-db-backup.service"
BACKUP_TIMER_SRC="${INSTALL_DIR}/deploy/stm-db-backup.timer"
CUSTOM_CADDYFILE_SRC="${INSTALL_DIR}/Caddyfile"

# ------------------------------------------------------------------------------
# 0c. Installer START banner
# ------------------------------------------------------------------------------
title "nexus-install.sh v${INSTALLER_VERSION} — STM (voorheen Nexus) complete installer"
printf '%b  Starttijd : %s%b\n'        "${DIM}" "$(date +"%Y-%m-%d %H:%M:%S %Z")" "${RST}" | tee -a "$LOG_FILE" >&2
printf '%b  Run-count: %s (max 3 anti-lus)%b\n' "${DIM}" "${STM_RUN_COUNT}" "${RST}" | tee -a "$LOG_FILE" >&2
printf '%b  Uitvoerder: EUID=%s  SUDO_USER=%s%b\n' "${DIM}" "${EUID}" "${SUDO_USER:-none}" "${RST}" | tee -a "$LOG_FILE" >&2
printf '%b  Logbestand: %s%b\n'        "${DIM}" "${LOG_FILE}" "${RST}" | tee -a "$LOG_FILE" >&2
printf '%b  Install dir: %s%b\n'        "${DIM}" "${INSTALL_DIR}" "${RST}" | tee -a "$LOG_FILE" >&2
hr

# ==============================================================================
# STAP 1 — PREFLIGHT (OS detectie, resources)
# ==============================================================================
title "STAP 1 — Preflight: OS, resources"
ok "Uitgevoerd met root-rechten (EUID=${EUID})."

# 1.2 OS check: Ubuntu 22.04 / 24.04
if [[ ! -f /etc/os-release ]]; then
  err "Kon /etc/os-release niet lezen (geen herkende Linux distro). Dit script is alleen voor Ubuntu."
  exit 4
fi
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-unknown}" in
  ubuntu) ;;
  *) warn "OS ID='${ID}'. Script is afgestemd op Ubuntu. Resultaten zijn ONGETEST." ; [[ $NON_INTERACTIVE -eq 0 ]] && confirm "Toch doorgaan?" || exit 4 ;;
esac
case "${VERSION_ID:-0}" in
  22.04|24.04) ok "OS: Ubuntu ${VERSION_ID} (${PRETTY_NAME:-})" ;;
  *) warn "Ubuntu versie ${VERSION_ID} wordt NIET expliciet ondersteund (alleen 22.04/24.04 getest)."; [[ $NON_INTERACTIVE -eq 0 ]] && confirm "Toch doorgaan?" || exit 4 ;;
esac

# 1.3 Architectuur
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64) ok "Architectuur: ${ARCH}" ;;
  *) warn "Architectuur ${ARCH} — Docker/Npm build kan falen. Doorgaan..." ;;
esac

# 1.4 RAM (Min. 1 GB; waarschuwing < 2 GB)
TOTAL_RAM_KB=0
require_cmd free && TOTAL_RAM_KB="$(free | awk '/^Mem:/ {print $2}')"
TOTAL_RAM_MB=$(( TOTAL_RAM_KB / 1024 ))
info "RAM: ~${TOTAL_RAM_MB} MB"
if (( TOTAL_RAM_MB < 1000 )); then
  warn "Minder dan 1 GB RAM. Next.js standalone + Postgres kan problemen geven."
  [[ $SKIP_SWAP -eq 0 ]] && info "Swapfile van 1,5x RAM wordt AANGEMAAKT (kan --skip-swap)."
  [[ $NON_INTERACTIVE -eq 0 ]] && confirm "Doorgaan?" || exit 5
fi

# 1.5 Schijfruimte: Min. 10 GB
FREE_DISK_MB=0
require_cmd df && FREE_DISK_MB="$(df -Pk "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {printf "%.0f", $4/1024}' || echo 0)"
[[ "$FREE_DISK_MB" -eq 0 ]] && require_cmd df && FREE_DISK_MB="$(df -Pk / | awk 'NR==2 {printf "%.0f", $4/1024}')"
info "Schijfruimte: ~${FREE_DISK_MB} MB (vrij in ${INSTALL_DIR:-/})"
if (( FREE_DISK_MB > 0 && FREE_DISK_MB < 8000 )); then
  warn "Minder dan ~8 GB vrij. Docker build zal mogelijk falen."
  [[ $NON_INTERACTIVE -eq 0 ]] && confirm "Toch doorgaan?" || exit 5
fi

# ==============================================================================
# STAP 2 — OS prep, pakketten, TZ, PostgreSQL client repo, locale, NTP, swap, UFW, sysctl
# ==============================================================================
title "STAP 2 — OS prep, pakketten, Postgres repo, locale, NTP, swap, firewall, sysctl"

# 2.1 Tijdzone instellen
if [[ -n "${TZ_VALUE:-}" ]]; then
  step "Tijdzone zetten: ${TZ_VALUE}"
  if [[ -f /etc/timezone ]]; then
    echo "${TZ_VALUE}" > /etc/timezone
  fi
  # shellcheck disable=SC2069
  ln -sf "/usr/share/zoneinfo/${TZ_VALUE}" /etc/localtime 2>/dev/null || true
  require_cmd timedatectl && timedatectl set-timezone "${TZ_VALUE}" 2>/dev/null || true
  ok "Tijdzone: ${TZ_VALUE} (nu: $(date +%Z))"
fi

# 2.2 apt update + basis-pakketten
step "apt-update + basis-pakketten (curl, git, openssl, htop, jq, logrotate, ...)"
export DEBIAN_FRONTEND=noninteractive
for _ in 1 2 3; do apt-get update -y 2>&1 | tail -4 | tee -a "$LOG_FILE" >&2 && break || sleep 5; done
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release sudo git tzdata openssl \
  rsyslog logrotate ufw fail2ban unattended-upgrades apt-transport-https software-properties-common \
  locales htop netcat-openbsd iproute2 procps psmisc jq pigz zstd acl bzip2 tree dnsutils \
  2>&1 | tee -a "$LOG_FILE" >&2
ok "Basis-systeem-pakketten geïnstalleerd (inclusief zstd/pigz/acl)."

# 2.3 PostgreSQL 16 APT repo + client (aanbevolen: client/server version match voor backup/restore)
step "PostgreSQL 16: official apt repo toevoegen + postgresql-client-16 installeren"
# https://wiki.postgresql.org/wiki/Apt
PG_KEYRING="/usr/share/keyrings/postgresql-archive-keyring.gpg"
if [[ ! -f "$PG_KEYRING" ]]; then
  mkdir -p /usr/share/keyrings
  for _ in 1 2 3; do
    if curl -fsSL "https://www.postgresql.org/media/keys/ACCC4CF8.asc" 2>/dev/null \
        | gpg --dearmor --yes -o "$PG_KEYRING" 2>/dev/null; then
      break
    fi
    sleep 5
  done
  chmod a+r "$PG_KEYRING"
fi
PG_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo jammy)}")"
PG_APT_LIST="/etc/apt/sources.list.d/pgdg.list"
if [[ ! -f "${PG_APT_LIST}" ]] || ! grep -qF "apt.postgresql.org" "${PG_APT_LIST}" 2>/dev/null; then
  echo "deb [signed-by=${PG_KEYRING}] http://apt.postgresql.org/pub/repos/apt ${PG_CODENAME}-pgdg main" \
    > "${PG_APT_LIST}"
fi
apt-get update -y 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
apt-get install -y --no-install-recommends postgresql-client-16 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || \
  apt-get install -y --no-install-recommends postgresql-client 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
if command -v psql >/dev/null 2>&1; then
  PSQL_VER="$(psql --version 2>&1 | awk '{print $3}' | cut -d. -f1)"
  ok "PostgreSQL client: psql v${PSQL_VER}."
else
  warn "PostgreSQL client installatie mislukt (optioneel, kan later handmatig)."
fi

# 2.4 Locale (nl_NL.UTF-8 + en_US.UTF-8) voor facturen/data tijden/valuta
title "STAP 2b — Locale + NTP tijdsynchronisatie (kritiek voor JWT + facturen)"
step "Genereren: nl_NL.UTF-8 + en_US.UTF-8 locale"
# Pas /etc/locale.gen idempotent aan
if [[ -f /etc/locale.gen ]]; then
  sed -i.bak \
    -e 's/^# *nl_NL.UTF-8 UTF-8/nl_NL.UTF-8 UTF-8/' \
    -e 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' \
    /etc/locale.gen 2>/dev/null || true
  rm -f /etc/locale.gen.bak
else
  { echo "en_US.UTF-8 UTF-8"; echo "nl_NL.UTF-8 UTF-8"; } > /etc/locale.gen
fi
locale-gen --purge en_US.UTF-8 nl_NL.UTF-8 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
# Default locale: OS logs in het Engels, tijds/valuta/cijfers Nederlands (voor facturen)
cat > /etc/default/locale <<'LOCALE_EOF'
LANG=en_US.UTF-8
LC_CTYPE="en_US.UTF-8"
LC_NUMERIC=nl_NL.UTF-8
LC_TIME=nl_NL.UTF-8
LC_COLLATE="en_US.UTF-8"
LC_MONETARY=nl_NL.UTF-8
LC_MESSAGES="en_US.UTF-8"
LC_PAPER=nl_NL.UTF-8
LC_NAME=nl_NL.UTF-8
LC_ADDRESS=nl_NL.UTF-8
LC_TELEPHONE=nl_NL.UTF-8
LC_MEASUREMENT=nl_NL.UTF-8
LC_IDENTIFICATION=nl_NL.UTF-8
LOCALE_EOF
chmod 0644 /etc/default/locale
# Update huidige shell meteen
# shellcheck disable=SC1091
. /etc/default/locale 2>/dev/null || true
ok "Locale: en_US.UTF-8 (logs, OS), nl_NL.UTF-8 (tijden, valuta, nummers voor facturen)."

# 2.5 NTP tijdsynchronisatie (systemd-timesyncd, Nederlandse pool servers)
step "Tijdsynchronisatie: systemd-timesyncd + NL NTP pool (noodzakelijk voor JWT + Auth + factuur datums)"
TIMESYNCD_DROPIN="/etc/systemd/timesyncd.conf.d/10-stm-ntp.conf"
mkdir -p "$(dirname "$TIMESYNCD_DROPIN")"
cat > "$TIMESYNCD_DROPIN" <<'NTPEOF'
[Time]
NTP=ntp.ripe.net 0.nl.pool.ntp.org 1.nl.pool.ntp.org 2.nl.pool.ntp.org 3.nl.pool.ntp.org
FallbackNTP=time.cloudflare.com time.google.com
NTPEOF
chmod 0644 "$TIMESYNCD_DROPIN"
systemctl daemon-reload 2>/dev/null || true
# Enable en start timesyncd
systemctl enable --now systemd-timesyncd 2>/dev/null || true
# Indien timedatectl aanwezig: set NTP = yes
require_cmd timedatectl && (timedatectl set-ntp true 2>/dev/null || true) || true
# Controleer (zacht falen indien VM tijd niet kan syncen in container-achtige omgevingen)
if require_cmd timedatectl && timedatectl show -p NTP 2>/dev/null | grep -qE "=yes|=true"; then
  ok "NTP actief (systemd-timesyncd). Synchroniseert met NL pool servers: ntp.ripe.net + 0-3.nl.pool.ntp.org"
else
  warn "NTP NIET actief in de kernel. Indien fysieke VPS: controleer /etc/systemd/timesyncd.conf. JWT/facturen kunnen afwijkende tijden geven."
fi

# 2.6 Sysctl hardening + bestandsdescriptors (Next.js + Prisma + Postgres hebben er veel nodig)
title "STAP 2c — Kernel tweaks (sysctl) + bestandsdescriptors (limits.conf)"
SYSCTL_STM="/etc/sysctl.d/99-stm-performance.conf"
cat > "$SYSCTL_STM" <<'SYSCTLEOF'
# STM / Nexus — performance & security hardening (nexus-install.sh)
# ---------------------------------------------
# Swap minder agressief (vooral voor Postgres)
vm.swappiness = 10
# Dentry/inode cache: niet te veel vasthouden (memory pressure)
vm.vfs_cache_pressure = 200
# Maximum open file descriptors (systeembreed)
fs.file-max = 1048576
# User max inotify watches (Next.js build, file watchers)
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
# Listen queue (backlog) voor reverse proxy / Next.js
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 4096
# SYN flood protection
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_syncookies = 1
# Forwarding uitzetten (geen router)
net.ipv4.ip_forward = 0
# Kernel keyring (Auth.js/OpenSSL met grote certificaten)
kernel.keys.maxbytes = 2000000
kernel.keys.maxkeys = 10000
SYSCTLEOF
chmod 0644 "$SYSCTL_STM"
# Toepassen (negeer fouten als container de sysctls niet kan zetten)
sysctl --system >/dev/null 2>&1 || true
ok "Kernel sysctl performance + security tweaks toegepast (indien ondersteund in kernel)."

# 2.7 Security limits (nofile = 65536 voor users/root/STM)
LIMITS_STM="/etc/security/limits.d/99-stm-nofile.conf"
cat > "$LIMITS_STM" <<'LIMITSEOF'
*       soft    nofile  65536
*       hard    nofile  65536
root    soft    nofile  65536
root    hard    nofile  65536
# STM deploy-gebruiker
stm     soft    nofile  65536
stm     hard    nofile  65536
# Docker container runtime
root    soft    nproc   65536
root    hard    nproc   65536
stm     soft    nproc   65536
stm     hard    nproc   65536
LIMITSEOF
chmod 0644 "$LIMITS_STM"
ok "Security/limits: 65536 open bestanden + nproc voor alle users, root & stm (vereist voor Prisma/Next.js)."

# 2.8 Swapfile (1,5x RAM) als --skip-swap niet gezet EN er nog géén swap actief is.
title "STAP 2d — Swapfile (1,5x RAM, overslaan met --skip-swap)"
if [[ "$SKIP_SWAP" -eq 0 ]]; then
  SWAP_NOW_KB="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if (( SWAP_NOW_KB < 1024 )); then
    SWAP_SIZE_MB=$(( (TOTAL_RAM_MB > 0 ? TOTAL_RAM_MB : 1024) * 15 / 10 ))  # 1,5x
    (( SWAP_SIZE_MB < 1024 )) && SWAP_SIZE_MB=1024
    SWAP_FILE="/swapfile"
    if [[ ! -f "$SWAP_FILE" ]]; then
      step "Swapfile aanmaken: ${SWAP_SIZE_MB} MB (${SWAP_FILE})"
      fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE" 2>/dev/null || \
        dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
      chmod 0600 "$SWAP_FILE"
      mkswap "$SWAP_FILE" 2>&1 | tee -a "$LOG_FILE" >&2
      swapon "$SWAP_FILE" 2>&1 | tee -a "$LOG_FILE" >&2
      if ! grep -qF "$SWAP_FILE" /etc/fstab 2>/dev/null; then
        echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
      fi
      ok "Swapfile actief: ${SWAP_SIZE_MB} MB (${SWAP_FILE})."
    else
      info "Swapfile bestaat al (${SWAP_FILE}); activeren indien nodig."
      swapon -s | grep -qF "$SWAP_FILE" || swapon "$SWAP_FILE" 2>/dev/null || true
    fi
  else
    info "Swap reeds actief (${SWAP_NOW_KB} kB). Nieuwe swapfile overgeslagen."
  fi
else
  info "Skip-swap flag: swapfile niet aangemaakt."
fi

# 2.9 Firewall (UFW)
title "STAP 2e — Firewall (UFW): alleen 22 (SSH), 80 (HTTP), 443 (HTTPS)"
if require_cmd ufw; then
  # Reset UFW niet als er al regels staan (idempotent). Voeg ALLEEN de benodigde TOE.
  step "Toestaan: SSH (22), HTTP (80), HTTPS (443) | Weigeren: 5432 (Postgres, altijd!)"
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true

  # Weiger expliciet 5432 (Postgres) — MOET DICHT NAAR HET INTERNET.
  ufw deny 5432/tcp  >/dev/null 2>&1 || true
  ufw deny 5432/udp  >/dev/null 2>&1 || true

  if ! ufw status | head -1 | grep -q "Status: active"; then
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
      echo "y" | ufw enable >/dev/null 2>&1 || true
    else
      confirm "UFW inschakelen (AANBEVOLEN: alle inkomende UIT, behalve SSH/HTTP/HTTPS)?" && \
        echo "y" | ufw enable 2>&1 | tee -a "$LOG_FILE" >&2 || true
    fi
  fi

  if ufw status 2>/dev/null | head -1 | grep -q "Status: active"; then
    ok "UFW actief. Alleen 22 (SSH), 80 (HTTP), 443 (HTTPS) open. 5432 (Postgres) DICHT."
  else
    warn "UFW NIET geactiveerd. Zorg ZELF voor firewall (5432 DICHT!)."
  fi
fi

# 2.10 fail2ban + unattended (security updates)
step "Beveiliging: fail2ban (bruteforce protectie SSH) + unattended-upgrades (auto security patches)"
systemctl enable fail2ban 2>/dev/null || true
systemctl restart fail2ban 2>/dev/null || true
systemctl enable unattended-upgrades 2>/dev/null || true
dpkg-reconfigure --frontend=noninteractive unattended-upgrades 2>&1 >/dev/null || true
ok "fail2ban + automatic security updates ingeschakeld."

# ==============================================================================
# STAP 3 — Non-root gebruiker "stm" (sudo + docker groep, SSH authorized_keys)
# ==============================================================================
title "STAP 3 — Gebruiker '${STM_USER}' aanmaken (non-root deploy gebruiker)"

# 3.1 Groep + user aanmaken
if ! getent group "$STM_GROUP" >/dev/null 2>&1; then
  groupadd --system "$STM_GROUP"
  ok "Groep '${STM_GROUP}' aangemaakt."
fi
if ! id -u "$STM_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$STM_HOME" \
    --shell /bin/bash --gid "$STM_GROUP" --groups sudo \
    --comment "STM deploy gebruiker (nexus-install.sh)" "$STM_USER"
  ok "Gebruiker '${STM_USER}' aangemaakt (sudo-groep, home ${STM_HOME})."
else
  info "Gebruiker '${STM_USER}' bestaat reeds."
  # Zorg dat hij in sudo zit:
  usermod -aG sudo "$STM_USER" 2>/dev/null || true
fi

# 3.2 SSH authorized_keys voor 'stm' (indien --ssh-key)
SSH_DIR="${STM_HOME}/.ssh"
mkdir -p "$SSH_DIR"
chmod 0700 "$SSH_DIR"
chown -R "${STM_USER}:${STM_GROUP}" "$SSH_DIR"
if [[ -n "${SSH_KEY_ARG:-}" ]]; then
  AUTH_KEYS="${SSH_DIR}/authorized_keys"
  step "Voeg SSH public key toe: ${STM_USER} -> ${AUTH_KEYS}"
  touch "$AUTH_KEYS"
  chmod 0600 "$AUTH_KEYS"
  # Als argument een bestand is → lees inhoud; anders letterlijke key
  if [[ -f "${SSH_KEY_ARG}" ]]; then
    cat "${SSH_KEY_ARG}" >> "$AUTH_KEYS"
  else
    printf '%s\n' "${SSH_KEY_ARG}" >> "$AUTH_KEYS"
  fi
  # Ontdubbelen + lege regels weghalen
  sort -u -o "$AUTH_KEYS" "$AUTH_KEYS"
  sed -i '/^\s*$/d' "$AUTH_KEYS"
  chown "${STM_USER}:${STM_GROUP}" "$AUTH_KEYS"
  ok "SSH authorized_keys bijgewerkt voor ${STM_USER} (regels: $(wc -l < "$AUTH_KEYS"))."
fi

# 3.3 Als installer root is, en root heeft authorized_keys: kopieer naar stm (handig: zelfde key werkt voor beide users).
ROOT_AUTH_KEYS="/root/.ssh/authorized_keys"
if [[ -f "$ROOT_AUTH_KEYS" && -s "$ROOT_AUTH_KEYS" ]]; then
  AUTH_KEYS="${SSH_DIR}/authorized_keys"
  touch "$AUTH_KEYS"
  chmod 0600 "$AUTH_KEYS"
  cat "$ROOT_AUTH_KEYS" >> "$AUTH_KEYS" || true
  sort -u -o "$AUTH_KEYS" "$AUTH_KEYS"
  sed -i '/^\s*$/d' "$AUTH_KEYS"
  chown "${STM_USER}:${STM_GROUP}" "$AUTH_KEYS"
  info "Root-SSH keys ook gekopieerd naar ${STM_USER} (${AUTH_KEYS})."
fi

# ==============================================================================
# STAP 4 — Docker Engine (officiële repo) + daemon.json (log rotate)
# ==============================================================================
title "STAP 4 — Docker Engine + Compose Plugin installeren (officiële apt repo)"

if ! require_cmd docker || ! docker compose version >/dev/null 2>&1; then
  step "Docker toevoegen: apt repo (download.docker.com)"

  # GPG keyring
  KEYRING="/usr/share/keyrings/docker-archive-keyring.gpg"
  install -m 0755 -d /usr/share/keyrings
  # Haal key op (3x retry)
  for _ in 1 2 3; do
    if curl -fsSL "https://download.docker.com/linux/ubuntu/gpg" 2>/dev/null \
        | gpg --dearmor --yes -o "$KEYRING" 2>/dev/null; then
      break
    fi
    sleep 5
  done
  chmod a+r "$KEYRING"

  # repo toevoegen
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo jammy)}")"
  DPKG_ARCH="$(dpkg --print-architecture)"
  echo "deb [arch=${DPKG_ARCH} signed-by=${KEYRING}] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y 2>&1 | tail -2 | tee -a "$LOG_FILE" >&2

  step "Docker installeren: docker-ce + buildx + compose-plugin"
  apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin \
    2>&1 | tail -4 | tee -a "$LOG_FILE" >&2
  ok "Docker + Compose plugin geïnstalleerd."
else
  ok "Docker + Compose al aanwezig: $(docker --version 2>&1) / $(docker compose version 2>&1 | tr -d '\n' || true)."
fi

# 4.1 Daemon.json: log rotation (10m × 5), default-address-pools indien CGNAT conflict
step "Docker daemon.json (logrotate + IPv6 + default cidr pools)"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKER_DAEMON_EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  },
  "ipv6": true,
  "fixed-cidr-v6": "fd00:cadd1:ceb4::/64",
  "default-address-pools": [
    {"base": "172.25.0.0/16", "size": 24},
    {"base": "172.31.0.0/16", "size": 24}
  ]
}
DOCKER_DAEMON_EOF
# Docker groep aanmaken (indien nog niet) + user toevoegen
getent group docker >/dev/null 2>&1 || groupadd docker
usermod -aG docker "$STM_USER" 2>/dev/null || true
# Herstart Docker (indien draaiend)
systemctl enable docker 2>/dev/null || true
systemctl restart docker 2>/dev/null || systemctl start docker 2>/dev/null || true
ok "Docker daemon config (log-rotation + pools) toegepast. Gebruiker ${STM_USER} in docker-groep."

# ==============================================================================
# STAP 5 — Code: Git clone OF fallback. Chown naar ${STM_USER}.
# ==============================================================================
title "STAP 5 — Installatiemap: ${INSTALL_DIR} (git clone OF bestaande map)"

mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd -P)"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.prod.yml"
ENV_FILE="${INSTALL_DIR}/.env"
ENV_TEMPLATE="${INSTALL_DIR}/.env.production.example"
BACKUP_SCRIPT_SRC="${INSTALL_DIR}/scripts/backup-stm-db.sh"
BACKUP_SERVICE_SRC="${INSTALL_DIR}/deploy/stm-db-backup.service"
BACKUP_TIMER_SRC="${INSTALL_DIR}/deploy/stm-db-backup.timer"
CUSTOM_CADDYFILE_SRC="${INSTALL_DIR}/Caddyfile"

CODE_WAS_HERE_BEFORE=0
if [[ -f "${INSTALL_DIR}/package.json" && -f "${INSTALL_DIR}/prisma/schema.prisma" ]]; then
  info "Installatiemap bevat reeds STM-code. Git-clone overgeslagen."
  CODE_WAS_HERE_BEFORE=1
elif [[ -n "${GIT_URL:-}" ]]; then
  step "Git clone: ${GIT_URL} -> ${INSTALL_DIR}"
  # Als map al bestaat maar niet STM-code: haal hem eerst leeg of gebruik subfolder
  if [[ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    # Iets staat er al, en het is geen STM-code. Clone in subdir genaamd stm-code en verplaats.
    warn "${INSTALL_DIR} is niet leeg EN bevat geen STM-code. Clonen naar /tmp/stm-code en verplaatsen..."
    TMP_GIT="/tmp/stm-install-git-$$"
    rm -rf "$TMP_GIT"
    require_cmd git
    git clone --depth 1 "$GIT_URL" "$TMP_GIT" 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2
    # Verplaats alle bestanden (inclusief verborgen .env.production.example)
    shopt -s dotglob nullglob
    mv "${TMP_GIT}/"* "${INSTALL_DIR}/" 2>&1 | tee -a "$LOG_FILE" >&2 || true
    shopt -u dotglob nullglob
    rm -rf "$TMP_GIT"
  else
    require_cmd git
    git clone --depth 1 "$GIT_URL" "$INSTALL_DIR" 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2
  fi
  ok "Git code gecloned naar ${INSTALL_DIR}."
else
  # Geen --git-url en map is leeg/geen code.
  warn "Geen --git-url en ${INSTALL_DIR} bevat geen STM-code."
  warn "Upload handmatig de code naar ${INSTALL_DIR} en herhaal: sudo bash $0"
  # Voor NON-interactive: FAAL.
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    err "NON_INTERACTIVE + geen code in ${INSTALL_DIR} + geen --git-url. Kan niet verder."
    exit 6
  fi
  if ! confirm "Heb je de code handmatig geüpload naar ${INSTALL_DIR} en wil je DOORGAAN?"; then
    info "Stop. Upload eerst de code en herhaal."
    exit 6
  fi
fi

# Chown naar non-root gebruiker (veiligheid, ook voor later: git pull als stm)
step "chown -R ${STM_USER}:${STM_GROUP} ${INSTALL_DIR}"
chown -R "${STM_USER}:${STM_GROUP}" "$INSTALL_DIR"

# ==============================================================================
# STAP 6 — .env GENERATIE (automatisch indien ontbrekend, of upgrade bestaande)
# ==============================================================================
title "STAP 6 — Environment (.env) genereren in ${ENV_FILE}"

# 6.1 Template bestaat?
if [[ ! -f "$ENV_TEMPLATE" ]]; then
  err "Ontbreekt: ${ENV_TEMPLATE}. Code in ${INSTALL_DIR} is incompleet."
  exit 7
fi

# 6.2 Genereer AUTOMATISCH indien .env ontbreekt.
ENV_EXISTED_BEFORE=0
if [[ -f "$ENV_FILE" ]]; then
  ENV_EXISTED_BEFORE=1
  info ".env bestond reeds (${ENV_FILE}). Alleen ontbrekende waarden worden AANGEVULD."
else
  step "Kopieer template → .env en vul AUTEURSWAARDEN in."
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  chown "${STM_USER}:${STM_GROUP}" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
fi

# Helper: voeg een KEY=VALUE toe, of vervang alleen als LEEG / NIET BESTAAT.
env_upsert() {
  local key="$1" value="$2"
  # Bestaat de key al?
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # Heeft de key een waarde? Indien WAARDE = skip, tenzij FORCE
    local cur
    cur="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed "s/^\"//;s/\"\$//")"
    if [[ -z "${cur}" ]]; then
      # Vervang lege regel
      sed -i.bak -e "s|^${key}=\$|${key}=${value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
    fi
    # Bestaande waarde: NIET overschrijven (veilig).
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

# Genereer secrets
GEN_AUTH_SECRET=""
GEN_PG_PASS=""
if [[ "$ENV_EXISTED_BEFORE" -eq 0 ]]; then
  GEN_AUTH_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "GENERATE_ME_openssl_rand_hex_32_PLEASE")"
  GEN_PG_PASS="$(openssl rand -base64 24 2>/dev/null | tr -d '\n' | tr -d '=+/' | cut -c1-28 || echo "GENERATE_ME_STRONG_PASSWORD_PLEASE")"
fi

# --domain param → NEXT_PUBLIC_APP_URL + STM_DOMAIN
if [[ -n "${DOMAIN:-}" ]]; then
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"
  NEXT_APP_URL="https://${DOMAIN}"
  env_upsert "STM_DOMAIN" "${DOMAIN}"
  env_upsert "NEXUS_DOMAIN" '${STM_DOMAIN:-}'
  env_upsert "NEXT_PUBLIC_APP_URL" "${NEXT_APP_URL}"
  env_upsert "AUTH_URL" '${NEXT_PUBLIC_APP_URL:-}/api/auth'
else
  # Geen domein: localhost (geen TLS).
  env_upsert "STM_DOMAIN" "localhost"
  env_upsert "NEXT_PUBLIC_APP_URL" "http://localhost:3000"
  env_upsert "AUTH_URL" "http://localhost:3000/api/auth"
fi

# Altijd: AUTH_TRUST_HOST=true (Caddy reverse proxy) + TZ + secrets
env_upsert "AUTH_TRUST_HOST" "true"
env_upsert "TZ" "${TZ_VALUE}"
env_upsert "NODE_ENV" "production"
env_upsert "POSTGRES_DB" "stm"
env_upsert "POSTGRES_USER" "stm"
[[ -n "${GEN_AUTH_SECRET:-}" ]] && env_upsert "AUTH_SECRET" "${GEN_AUTH_SECRET}"
[[ -n "${GEN_PG_PASS:-}"     ]] && env_upsert "POSTGRES_PASSWORD" "${GEN_PG_PASS}"
# Caddy on host: app zit op 127.0.0.1:3000
env_upsert "STM_APP_URL" "127.0.0.1:3000"

# Laatste beveiliging
chmod 0600 "$ENV_FILE"
chown "${STM_USER}:${STM_GROUP}" "$ENV_FILE"

# Laat de gebruiker de waarden even zien
info ".env (${ENV_FILE}):"
# Print values MET maskering (laatste 4 tekens alleen van secrets)
awk -F= '
BEGIN { mask_keys_re = "(AUTH_SECRET|POSTGRES_PASSWORD|INSERVE_API_KEY|SIMHUIS_PASSWORD|NAVIXY_PANEL_PASSWORD|NAVIXY_USER_PASSWORD|NAVIXY_SESSION_HASH)" }
{
  key=$1
  if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
    if (key ~ mask_keys_re) {
      val=substr($0, length(key)+2)
      if (length(val) > 4) { val = sprintf("****%s", substr(val, length(val)-3)) }
      else if (length(val) == 0) { val = "(leeg)" }
      printf "    - %s = %s\n", key, val
    } else {
      printf "    - %s\n", $0
    }
  }
}' "$ENV_FILE"

ok ".env ${ENV_FILE} is aangemaakt/geüpdatet (maskering voor wachtwoorden/tokens)."

# ==============================================================================
# STAP 7 — Caddy (tenzij --no-caddy)
# ==============================================================================
if [[ "$NO_CADDY" -eq 0 ]]; then
  title "STAP 7 — Caddy reverse proxy + Let's Encrypt (HTTPS, security headers)"

  if ! require_cmd caddy; then
    step "Caddy installeren via Cloudsmith apt repo..."
    # https://caddyserver.com/docs/install#debian-ubuntu-raspbian
    install -m 0755 -d /usr/share/keyrings
    for _ in 1 2 3; do
      if curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" 2>/dev/null \
          | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null; then
        break
      fi
      sleep 5
    done
    chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
      > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
    apt-get update -y 2>&1 | tail -2 | tee -a "$LOG_FILE" >&2
    apt-get install -y --no-install-recommends caddy 2>&1 | tail -2 | tee -a "$LOG_FILE" >&2
  fi

  # Caddyfile kopiëren naar /etc/caddy + env file
  step "Caddy configureren: /etc/caddy/Caddyfile + /etc/caddy/.env"
  if [[ -f "$CUSTOM_CADDYFILE_SRC" ]]; then
    cp "$CUSTOM_CADDYFILE_SRC" /etc/caddy/Caddyfile
    chown root:root /etc/caddy/Caddyfile
    chmod 0644 /etc/caddy/Caddyfile
  else
    warn "Geen Caddyfile in project (${CUSTOM_CADDYFILE_SRC}). Fallback: minimal reverse proxy."
    cat > /etc/caddy/Caddyfile <<'CADDY_FALLBACK'
{$STM_DOMAIN:localhost} {
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
  header X-Content-Type-Options    "nosniff"
  header X-Frame-Options           "SAMEORIGIN"
  header Referrer-Policy           "strict-origin-when-cross-origin"
  header Permissions-Policy        "camera=(), microphone=(), geolocation=()"
  encode gzip zstd
  reverse_proxy 127.0.0.1:3000 {
    header_up X-Forwarded-For    {remote_host}
    header_up X-Forwarded-Proto  {scheme}
    header_up X-Forwarded-Host   {host}
    header_up X-Real-IP          {remote_host}
    transport http { keepalive 32 keepalive_interval 30s timeout 120s }
  }
}
CADDY_FALLBACK
    chmod 0644 /etc/caddy/Caddyfile
  fi
  # Caddy env: alleen STM_DOMAIN + STM_APP_URL (volgt direct uit .env)
  # shellcheck disable=SC2063
  grep -E '^(STM_DOMAIN|NEXT_PUBLIC_APP_URL|STM_APP_URL)=' "$ENV_FILE" > /etc/caddy/.env || true
  # Als STM_APP_URL nog niet in ENV stond: vul hier met localhost:3000
  grep -qE '^STM_APP_URL=' /etc/caddy/.env || echo "STM_APP_URL=127.0.0.1:3000" >> /etc/caddy/.env
  chown root:root /etc/caddy/.env
  chmod 0600 /etc/caddy/.env
  # E-mailadres (Let's Encrypt)
  if [[ -n "${EMAIL:-}" ]]; then
    step "Caddy global e-mail (Let's Encrypt): ${EMAIL} → /etc/caddy/Caddyfile"
    # Zet aan het begin, voor de site-block
    if ! grep -qF "{\"$EMAIL\"}" /etc/caddy/Caddyfile 2>/dev/null; then
      TMP_CADDY="$(mktemp)"
      printf '{
  email %s
  acme_ca https://acme-v02.api.letsencrypt.org/directory
}

' "${EMAIL}" > "$TMP_CADDY"
      cat /etc/caddy/Caddyfile >> "$TMP_CADDY"
      mv "$TMP_CADDY" /etc/caddy/Caddyfile
      chmod 0644 /etc/caddy/Caddyfile
    fi
  fi
  # Caddyfile droog testen
  step "caddy validate /etc/caddy/Caddyfile"
  if ! caddy validate --config /etc/caddy/Caddyfile 2>&1 | tee -a "$LOG_FILE" >&2; then
    warn "Caddyfile valideert NIET. Controleer /etc/caddy/Caddyfile na install."
  else
    ok "Caddyfile gevalideerd."
  fi
  # Enable/start
  systemctl enable caddy 2>/dev/null || true
  systemctl restart caddy 2>/dev/null || systemctl start caddy 2>/dev/null || true
  sleep 2
  if systemctl is-active --quiet caddy 2>/dev/null; then
    ok "Caddy actief (systemd). HTTPS wordt automatisch aangevraagd zodra DNS klopt."
  else
    warn "Caddy is NIET actief. Run: sudo systemctl status caddy — logs: journalctl -u caddy -n 80"
  fi
fi

# ==============================================================================
# STAP 8 — Docker build, up -d, migrations, health
# ==============================================================================
title "STAP 8 — Containers bouwen, starten, migrations + wachten tot healthy"

cd "$INSTALL_DIR"
COMPOSE_CMD=(docker compose -f "$COMPOSE_FILE")

# 8.1 Validatie compose
step "docker compose config valideren..."
"${COMPOSE_CMD[@]}" config -q 2>&1 | tee -a "$LOG_FILE" >&2
ok "docker-compose.prod.yml syntaxis OK."

# 8.2 Builden (met of zonder cache; --force-rebuild flag niet in installer maar rebuild als app image niet bestaat)
FORCE_REBUILD=0
if ! docker image inspect stm-stm-app >/dev/null 2>&1 || [[ "$CODE_WAS_HERE_BEFORE" -eq 0 ]]; then
  FORCE_REBUILD=1
fi
if [[ "$FORCE_REBUILD" -eq 1 ]]; then
  step "Docker build: stm-app (Next.js standalone) + pull Postgres 16. Dit duurt 3-10 minuten..."
  "${COMPOSE_CMD[@]}" pull --quiet stm-db 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
  "${COMPOSE_CMD[@]}" build --no-cache stm-app 2>&1 | tail -20 | tee -a "$LOG_FILE" >&2
else
  step "Docker image stm-stm-app bestaat. Snelle build (cache toegestaan)..."
  "${COMPOSE_CMD[@]}" pull --quiet stm-db 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
  "${COMPOSE_CMD[@]}" build stm-app 2>&1 | tail -10 | tee -a "$LOG_FILE" >&2
fi
ok "Docker build voltooid."

# 8.3 Up -d
step "docker compose up -d (stm-db eerst, dan stm-app — migrations via entrypoint.sh)"
"${COMPOSE_CMD[@]}" up -d 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2

# 8.4 Wachten tot stm-db healthy
MAX_WAIT_DB=90
step "Wachten tot PostgreSQL healthy (stm-db)..."
for i in $(seq 1 "$MAX_WAIT_DB"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-db 2>/dev/null || echo '')"
  case "$STATUS" in
    healthy) break ;;
    unhealthy)
      err "Postgres UNHEALTHY na ${i}s. Laatste logs:"
      docker logs --tail 40 stm-db 2>&1 | tee -a "$LOG_FILE" >&2
      exit 8
      ;;
    *) ;;
  esac
  sleep 1
  if (( i % 15 == 0 )); then printf '  [%d/%d] wachten op Postgres...\n' "$i" "$MAX_WAIT_DB" >&2 | tee -a "$LOG_FILE"; fi
done
STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-db 2>/dev/null || echo '')"
[[ "$STATUS" != "healthy" ]] && { err "Postgres kwam niet healthy binnen ${MAX_WAIT_DB}s (status=${STATUS})."; exit 8; }
ok "PostgreSQL healthy."

# 8.5 Wachten tot Next.js /api/health = 200 (entrypoint.sh draait migrate deploy, daarna start next)
APP_MAX_WAIT=180
step "Wachten tot Next.js healthy + /api/health = 200 (max ${APP_MAX_WAIT}s, entrypoint doet eerst Prisma migrate deploy)..."
for i in $(seq 1 "$APP_MAX_WAIT"); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-app 2>/dev/null || echo '')"
  case "$STATUS" in
    healthy) break ;;
    unhealthy)
      if (( i > 120 )); then
        warn "Next.js UNHEALTHY op ${i}s. Laatste logs:"
        docker logs --tail 50 stm-app 2>&1 | tee -a "$LOG_FILE" >&2 || true
      fi
      ;;
    *) ;;
  esac
  sleep 1
  if (( i % 20 == 0 )); then printf '  [%d/%d] wachten op Next.js (migraties + build startup)...\n' "$i" "$APP_MAX_WAIT" >&2 | tee -a "$LOG_FILE"; fi
done
# Externe check via 127.0.0.1:3000 (Caddy of direct)
HTTP_CODE="000"
if require_cmd curl; then
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
    --connect-timeout 5 --retry 2 --insecure http://127.0.0.1:3000/api/health 2>/dev/null || echo 000)"
fi
STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-app 2>/dev/null || echo '')"
if [[ "$HTTP_CODE" == "200" || "$STATUS" == "healthy" ]]; then
  ok "Next.js healthy + /api/health HTTP 200 (Docker status=${STATUS})."
else
  warn "Health status: ${STATUS}; /api/health 127.0.0.1:3000 -> HTTP ${HTTP_CODE}. Logs: docker logs --tail 80 stm-app"
fi

# ==============================================================================
# STAP 9 — Optioneel: prisma db seed (--seed)
# ==============================================================================
if [[ "$SEED" -eq 1 ]]; then
  title "STAP 9 — Seed: Prisma demo-gebruikers + data"
  step "docker exec stm-app npx prisma db seed"
  if docker exec stm-app npx prisma db seed 2>&1 | tail -10 | tee -a "$LOG_FILE" >&2; then
    ok "Seed succesvol. Demo-gebruikers: admin@nexus.local, medewerker@nexus.local, viewer@nexus.local (wachtwoord: Test1234!)."
  else
    warn "Prisma seed FAILDE. Doe later handmatig: docker exec stm-app npx prisma db seed"
  fi
fi

# ==============================================================================
# STAP 10 — Automatische backups (P2.1) systemd timer installeren
# ==============================================================================
title "STAP 10 — Backups (P2.1): script + systemd timer (03:00 NL, rotatie 7d/4w/3m)"

BACKUP_DEST_SCRIPT="/opt/stm/scripts/backup-stm-db.sh"
BACKUP_DEST_SERVICE="/etc/systemd/system/stm-db-backup.service"
BACKUP_DEST_TIMER="/etc/systemd/system/stm-db-backup.timer"

if [[ ! -f "$BACKUP_SCRIPT_SRC" || ! -f "$BACKUP_SERVICE_SRC" || ! -f "$BACKUP_TIMER_SRC" ]]; then
  warn "Backup-bestanden ontbreken (${BACKUP_SCRIPT_SRC}, deploy/*). Overgeslaan."
else
  step "Installeren backups (idempotent)..."
  mkdir -p /opt/stm/scripts
  install -o root -g root -m 0750 "$BACKUP_SCRIPT_SRC"   "$BACKUP_DEST_SCRIPT"
  install -o root -g root -m 0644 "$BACKUP_SERVICE_SRC"  "$BACKUP_DEST_SERVICE"
  install -o root -g root -m 0644 "$BACKUP_TIMER_SRC"    "$BACKUP_DEST_TIMER"

  # Zorg dat /opt/stm ook naar STM_USER wijst (voor ./backups/)
  mkdir -p /opt/stm
  chown -R "${STM_USER}:${STM_GROUP}" /opt/stm || true

  step "systemctl daemon-reload + enable --now stm-db-backup.timer"
  systemctl daemon-reload
  systemctl enable --now stm-db-backup.timer 2>&1 | tee -a "$LOG_FILE" >&2 || true
  sleep 1
  TIMER_ACTIVE="$(systemctl is-active stm-db-backup.timer 2>/dev/null || echo "unknown")"
  TIMER_NEXT="$(systemctl list-timers stm-db-backup.timer --no-pager 2>/dev/null | tail -1 | awk '{print $1, $2, $3}' || echo '?')"
  if [[ "$TIMER_ACTIVE" == "active" ]]; then
    ok "Backup timer ACTIEF (${TIMER_ACTIVE}). Volgende geplande run: ${TIMER_NEXT}"
    info "  Handmatig NU backup draaien: sudo ${BACKUP_DEST_SCRIPT}"
    info "  Offsite sync (optioneel): voeg STM_BACKUP_RSYNC_TARGET='user@host:/data/stm-backups/' toe aan /opt/stm/.env"
  else
    warn "Backup timer NIET actief (${TIMER_ACTIVE}). Handmatig controleren: sudo systemctl list-timers stm-db-backup.timer"
  fi
fi

# ==============================================================================
# STAP 11 — Samenvatting + Post-install Tips
# ==============================================================================
INSTALL_END_EPOCH="$(date +%s)"
ELAPSED_SEC=$(( INSTALL_END_EPOCH - INSTALL_START_EPOCH ))
ELAPSED_MIN=$(( ELAPSED_SEC / 60 ))
ELAPSED_SEC_R=$(( ELAPSED_SEC - ELAPSED_MIN * 60 ))

title "STAP 11 — Installatie VOLTOOID in ${ELAPSED_MIN}m${ELAPSED_SEC_R}s"
hr

# Afgeleide waarden voor summary
FINAL_DOMAIN="$(awk -F= '/^STM_DOMAIN=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo "localhost")"
FINAL_URL="$(awk -F= '/^NEXT_PUBLIC_APP_URL=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo "http://localhost:3000")"
SUMMARY_AUTH_SECRET="*(automatisch gegenereerd — te vinden in ${ENV_FILE})"
SUMMARY_PG_PASS="*(automatisch gegenereerd — te vinden in ${ENV_FILE})"

# Lees pg password alleen om length te tonen (maskered)
PG_PASS_LEN="$(awk -F= '/^POSTGRES_PASSWORD=/ {print length($2)}' "$ENV_FILE" 2>/dev/null || echo 0)"

cat <<SUMMARY | tee -a "$LOG_FILE" >&2
${BLD}  ✅ Installatie SUCCESVOL — STM (voorheen Nexus)${RST}

  ${CYN}App-URL           :${RST}  ${FINAL_URL}
  ${CYN}Domein            :${RST}  ${FINAL_DOMAIN}
  ${CYN}Installatiemap    :${RST}  ${INSTALL_DIR}
  ${CYN}Deploy-gebruiker  :${RST}  ${STM_USER} (sudo + docker-groep; home=${STM_HOME})
  ${CYN}Docker containers :${RST}  stm-app (Next.js standalone 127.0.0.1:3000) + stm-db (PostgreSQL 16)
  ${CYN}Caddy              :${RST}  $([[ "$NO_CADDY" -eq 1 ]] && echo "OVERSLAAN (--no-caddy)") || systemctl is-active --quiet caddy && echo "Actief (HTTPS via Let's Encrypt)" || echo "Geactiveerd; controleer: sudo systemctl status caddy")
  ${CYN}Backups (timer)    :${RST}  sudo systemctl list-timers stm-db-backup.timer
  ${CYN}.env (secrets)    :${RST}  ${ENV_FILE} (chmod 0600, owned ${STM_USER}:${STM_GROUP})
                           Postgres-password length: ${PG_PASS_LEN} chars.
                           AUTH_SECRET gegenereerd?  ${GEN_AUTH_SECRET:+Ja} ${GEN_AUTH_SECRET:-Nee (bestond reeds)}

  ${CYN}Firewall (UFW)     :${RST}  $(ufw status 2>/dev/null | head -1)

  ${BLD}--- Demo-gebruikers (alleen als --seed meegegeven of later handmatig gedaan): ---${RST}
    E-mail                   Wachtwoord     Rol
    admin@nexus.local        Test1234!      ADMIN       (alles, incl. Instellingen + Import/Export)
    medewerker@nexus.local   Test1234!      EMPLOYEE    (view/create/edit + import/export + Settings READONLY)
    viewer@nexus.local       Test1234!      VIEWER      (read-only bekijken, GEEN instellingen)
  ${YLW}⚠  Verander direct alle wachtwoorden na eerste inlog!${RST}

  ${BLD}--- Nuttige commando's: ---${RST}
    cd ${INSTALL_DIR}
    docker compose -f docker-compose.prod.yml ps                       # status containers
    docker compose -f docker-compose.prod.yml logs -f stm-app            # live logs app
    docker compose -f docker compose logs -f stm-db                      # live logs postgres
    docker compose -f docker-compose.prod.yml up -d --build              # rebuild + restart (na code-wijzigingen)
    sudo ${BACKUP_DEST_SCRIPT:-/opt/stm/scripts/backup-stm-db.sh}        # NU backup draaien
    sudo systemctl list-timers stm-db-backup.timer                       # wanneer volgende backup?
    sudo ufw status verbose                                              # firewall regels tonen

  ${BLD}--- Troubleshooting (grote 4): ---${RST}
    1. Login mislukt (CallbackRouteError):  controleer .env → AUTH_TRUST_HOST=true  → docker restart stm-app
    2. 502 Bad Gateway (Caddy):            curl 127.0.0.1:3000/api/health  → 200?
    3. DB niet bereikbaar:                 docker ps -a | grep stm-db    → docker logs stm-db
    4. Kan /settings niet openen:          Log in als ADMIN. Employee = READONLY.
SUMMARY
hr

if [[ -z "${DOMAIN:-}" ]]; then
  warn "Je hebt --domain niet opgegeven. APP is bereikbaar op http://<VPS-IP>:3000 (MAAR zet Caddy/HTTPS aan!)."
fi

if [[ -n "${DOMAIN:-}" ]]; then
  DNS_CHECK_IP="0.0.0.0"
  if require_cmd dig; then
    DNS_CHECK_IP="$(dig +short A "${DOMAIN}" 2>/dev/null | head -1 || echo "")"
    [[ -z "${DNS_CHECK_IP}" ]] && DNS_CHECK_IP="$(dig +short AAAA "${DOMAIN}" 2>/dev/null | head -1 || echo "")"
  fi
  if [[ -n "${DNS_CHECK_IP:-}" ]]; then
    info "DNS-check: ${DOMAIN} → ${DNS_CHECK_IP} (als dit niet jouw VPS-IP is, Caddy krijgt geen TLS)."
  else
    warn "Geen DNS-record gevonden voor ${DOMAIN}. Caddy HTTPS ZAL FAILEN totdat A/AAAA-record klopt."
  fi
fi

ok "Installatielog: ${LOG_FILE} (bij fouten altijd meesturen)."

# Wees vriendelijk: als gebruiker root was, vertellen hoe in te loggen als non-root.
if [[ "$(id -un 2>/dev/null || echo root)" == "root" ]]; then
  info "Volgende stap: log in op de app, en ga direct naar /settings om Inserve/Simhuis/Navixy credentials in te vullen."
  info "Om verder te werken als non-root gebruiker:  sudo -u ${STM_USER} -i  (of SSH met --ssh-key key)."
fi

exit 0
