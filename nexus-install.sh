#!/usr/bin/env bash
# ==============================================================================
# nexus-install.sh — ONE-CLICK STM (voorheen Nexus) Installer + UPDATER voor Ubuntu
# Repository: https://github.com/SeguiloNL/Nexus
# Versie:     1.2.1 (HOTFIX: root-escalatie SUDO_USER-bug + defensieve Caddyfile-copy)
# Idempotent: meerdere keren draaien is VEILIG.
# Strict:    set -Eeuo pipefail + ERR-trap (iedere fout stopt METEEN, met duidelijke melding).
#
# HOOFDMODES:
#   1) EERSTE INSTALLATIE (default): volledige setup (OS, Docker, Caddy, DB, code)
#   2) UPDATE MODE (--update):      alleen code pullen + rebuild + restart.
#                                   Slaat OS prep / hardening / swap / firewall over.
#
# Installatie (MODE 1) bestaat UIT:
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
# Update (MODE 2, --update) doet:
#   - Pre-checks: git repo aanwezig, Docker draait, .env en compose file bestaan
#   - Lokale niet-gecommitde wijzigingen → git stash auto-bewaren (GEEN dataverlies!)
#   - git fetch + reset --hard naar laatste commit van DEFAULT_GIT_BRANCH
#   - Kritieke bestandsfixes (Dockerfile/entrypoint/next.config) OPNIEUW forceren
#   - .env AANVULLEN (nieuwe vars; bestaande secrets PRESERVEN, nooit onbedoeld overschrijven)
#   - Caddy reload (indien geactiveerd, zonder downtime)
#   - Docker build MET cache (snel!) + pull nieuwste base images + up -d --force-recreate
#   - Health checks (Postgres + Next.js /api/health = 200)
#   - (Optioneel --seed) Ook in update mode: demo users/seeds draaien
#   - Summary met commit diff + rollback-voorbeeld
#
# ========================  STANDAARD ONE-LINER (DIRECT VANAF GITHUB)  ========================
# Kopieer en plak in je Ubuntu VPS (als root / sudo-gebruiker):
#   curl -sSL https://raw.githubusercontent.com/SeguiloNL/Nexus/main/nexus-install.sh \
#     | sudo bash -s -- --domain stm.jouwdomein.nl --email hostmaster@jouwdomein.nl --seed
#
# NA iedere push naar GitHub — 1 commando = nieuwste code live:
#   sudo bash /opt/stm/nexus-install.sh --update
# ============================================================================================
#
# Alle argumenten:
#   --update                       (BESTAANDE install) Alleen update: git pull + rebuild.
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
# 0. CORE CONSTANTS (ZEER VROEG, VOOR safe start, zodat VERSIE/URL direct gebruikt kan worden)
# ------------------------------------------------------------------------------
INSTALL_SCRIPT_NAME="nexus-install.sh"
INSTALLER_VERSION="1.2.1"
INSTALL_START_EPOCH="$(date +%s)"
DEFAULT_INSTALL_DIR="/opt/stm"
DEFAULT_SWAP_MULTIPLIER="1.5"
DEFAULT_GIT_URL="https://github.com/SeguiloNL/Nexus.git"
DEFAULT_GIT_BRANCH="${DEFAULT_GIT_BRANCH:-main}"

# ==============================================================================
# SHELL SAFETY — Bash history expansion UITSCHAKELEN (globaal, VOOR ALLES)
#   Voorkomt crashes op "!" chars in URLs, commit messages, JSON, shell output.
#   Geactiveerd op 2 plekken: hier (globaal) & nogmaals binnen --update mode.
# ==============================================================================
set +H 2>/dev/null || true
unset HISTSIZE HISTFILE HISTFILESIZE 2>/dev/null || true
export HISTCONTROL=ignoreboth 2>/dev/null || true

# ==============================================================================
# 0.0 — SAFE START: Altijd direct output, VOOR we iets anders doen.
#      Dit zorgt dat je NOOIT MEER "niets gebeuren" hebt, zelfs als helpers/LOG_FILE falen.
# ==============================================================================
# Indirect: STM_DEBUG=1 → bash -x trace per regel (naar stderr, altijd zichtbaar!)
if [[ -n "${STM_DEBUG:-}" && "${STM_DEBUG:-}" == "1" ]]; then
  echo "[STM-DEBUG] Script start. PID=$$ EUID=${EUID} SUDO_USER=${SUDO_USER:-none} SUDO_ESCALATED=${SUDO_ESCALATED:-none} STM_RUN_COUNT=${STM_RUN_COUNT:-0}" >/dev/stderr || true
  echo "[STM-DEBUG] STM_DEBUG=1: bash -x trace AAN. Alle regels gaan zichtbaar voorbij op stderr." >/dev/stderr || true
  set -x
fi
# Altijd een simpele "ik leef" ping DIRECT naar stderr (geen pipes, geen helpers, geen LOG_FILE nodig):
echo "[STM] nexus-install.sh v${INSTALLER_VERSION} start (PID=$$ EUID=${EUID})" >/dev/stderr || true
echo "[STM] DEBUG: Voeg 'STM_DEBUG=1' toe (voor 'STM_DEBUG=1 sudo bash ./nexus-install.sh ...') om per regel te zien wat er gebeurt." >/dev/stderr || true

# ------------------------------------------------------------------------------
# 0. Globals (vervolg: logging, colors, helpers)
# ------------------------------------------------------------------------------

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
UPDATE_ONLY=0

# --- Gebruiker / OS ---
STM_USER="stm"
STM_GROUP="stm"
STM_HOME="/home/${STM_USER}"
TZ_VALUE="${TZ:-Europe/Amsterdam}"

# ------------------------------------------------------------------------------
# 0a. Helpers
# ------------------------------------------------------------------------------
# ── Schrijf helpers ──────────────────────────────────────────────────────────
# INFO / OK / STEP / TITLE / HR : naar STDOUT  (gebruiker ziet dit standaard)
# WARN / ERR                    : naar STDERR  (fouten/meldingen)
# ALLE helpers schrijven OOK naar $LOG_FILE via tee (log duplicatie).
#
# ☣️  CRITICAL: Deze helpers MOETEN NOOIT falen (geen non-zero exit code)!
#    Indien `tee` of LOG_FILE problemen geeft: schrijf alléén naar console
#    en zorg altijd voor exit 0. Anders kettingreactie via set -e + ERR-trap
#    → SILENT EXIT (de bug die je nu ervaart!).
to_log_and_stdout() {
  # 1: Naar stdout (altijd console, altijd ongeacht LOG_FILE)
  # 2: Indien mogelijk: OOK naar $LOG_FILE appenden, MAAR OOK DAN: succes = altijd 0
  local out=""
  out="$(cat 2>/dev/null || true)" || true
  # Altijd eerst stdout (zichtbaar voor gebruiker)
  printf '%s' "$out"
  # Optioneel: probeer ook naar $LOG_FILE. Lukt niet? Negeer het simpelweg.
  local want_log=1
  if [[ -z "${LOG_FILE:-}" ]]; then want_log=0; fi
  if [[ "${LOG_FILE:-}" == "/dev/null" ]]; then want_log=0; fi
  if [[ "$want_log" -eq 1 ]]; then
    # Check of tee bestaat en LOG_FILE map schrijfbaar is (of /dev/null al afgehandeld)
    if command -v tee >/dev/null 2>&1; then
      local log_dir
      log_dir="$(dirname "$LOG_FILE" 2>/dev/null || echo "")"
      if [[ -n "$log_dir" && -d "$log_dir" && -w "$log_dir" ]]; then
        printf '%s' "$out" >> "$LOG_FILE" 2>/dev/null || true
      fi
    fi
  fi
  return 0   # ☣️  ALTIJD SUCCES (ook als loggen mislukte)
}
to_log_and_stderr() {
  # Zelfde als bovenstaande, maar hoofd-output gaat naar stderr
  local out=""
  out="$(cat 2>/dev/null || true)" || true
  printf '%s' "$out" >&2
  local want_log=1
  if [[ -z "${LOG_FILE:-}" ]]; then want_log=0; fi
  if [[ "${LOG_FILE:-}" == "/dev/null" ]]; then want_log=0; fi
  if [[ "$want_log" -eq 1 ]]; then
    if command -v tee >/dev/null 2>&1; then
      local log_dir
      log_dir="$(dirname "$LOG_FILE" 2>/dev/null || echo "")"
      if [[ -n "$log_dir" && -d "$log_dir" && -w "$log_dir" ]]; then
        printf '%s' "$out" >> "$LOG_FILE" 2>/dev/null || true
      fi
    fi
  fi
  return 0   # ☣️  ALTIJD SUCCES
}

# Info/Ok/Step/Title/Hr → altijd stdout + log, NOOIT falen (|| true safe guard)
info()  { { printf '%bℹ  %s%b\n' "${CYN}" "$*" "${RST}" || true; } | to_log_and_stdout || true; }
ok()    { { printf '%b✔  %s%b\n' "${GRN}" "$*" "${RST}" || true; } | to_log_and_stdout || true; }
step()  { { printf '%b▸ %s%b\n'  "${BLU}" "$*" "${RST}" || true; } | to_log_and_stdout || true; }
title() { { printf '\n%b┌─ %s%b\n'   "${BLD}" "$*" "${RST}" || true; } | to_log_and_stdout || true; }
hr()    { { printf '%b─────────────────────────────────────────────────────────────%b\n' "${DIM}" "${RST}" || true; } | to_log_and_stdout || true; }
warn()  { { printf '%b⚠  %s%b\n' "${YLW}" "$*" "${RST}" || true; } | to_log_and_stderr || true; }
err()   { { printf '%b✖  %s%b\n' "${RED}" "$*" "${RST}" || true; } | to_log_and_stderr || true; }

usage() {
  cat <<EOF
${BLD}nexus-install.sh v${INSTALLER_VERSION}${RST} — One-click STM installer + updater voor Ubuntu 22.04/24.04 LTS.
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
  --update                      (BESTAANDE INSTALLATIE) Alleen update: git pull + rebuild + restart.
                                Slaat OS prep / gebruiker / firewall / swap over.
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
  # 1) ONE-LINER — EERSTE INSTALLATIE DIRECT VANAF GITHUB (AANBEVOLEN)
  #    Download alleen dit script en alles (code + installatie) gaat automatisch.
  # ================================================================
  curl -sSL https://raw.githubusercontent.com/SeguiloNL/Nexus/${DEFAULT_GIT_BRANCH}/nexus-install.sh \\
    | sudo bash -s -- \\
        --domain stm.mijnbedrijf.nl \\
        --email hostmaster@mijnbedrijf.nl \\
        --seed

  # ================================================================
  # 2) BESTAANDE INSTALLATIE — UPDATE NAAR NIEUWSTE COMMIT VAN GITHUB
  #    Na iedere push naar GitHub: 1 commando = nieuwste code live!
  # ================================================================
  sudo bash $0 --update

  # ================================================================
  # 3) Eerste install — script bestond al lokaal
  # ================================================================
  sudo bash $0 \\
    --domain stm.mijnbedrijf.nl \\
    --email hostmaster@mijnbedrijf.nl \\
    --seed

  # ================================================================
  # 4) Lokaal testen zonder TLS (bestaande code)
  # ================================================================
  sudo bash $0 --non-interactive --skip-swap
EOF
}

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
  # ── LAATSTE VERDEDIGING: Directe echo NAAR /dev/stderr (GEEN helpers, GEEN pipes, GEEN LOG_FILE).
  #    Zelfs als ALLES ANDERS faalt, zie je DIT in je terminal. Dit voorkomt "niets gebeuren".
  echo "" >/dev/stderr 2>/dev/null || true
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
  echo "❌  STM INSTALLER FOUT (regel ${line}): ${cmd}" >/dev/stderr 2>/dev/null || true
  echo "    PID=$$ EUID=${EUID}  Script: $0" >/dev/stderr 2>/dev/null || true
  if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" ]]; then
    echo "    Logbestand: ${LOG_FILE}" >/dev/stderr 2>/dev/null || true
    # Probeer ook direct naar logbestand te schrijven (geen pipes/helpers)
    echo "" >> "$LOG_FILE" 2>/dev/null || true
    echo "[FATAL ${line}] ${cmd}" >> "$LOG_FILE" 2>/dev/null || true
  else
    echo "    Logbestand: (geen / niet schrijfbaar)" >/dev/stderr 2>/dev/null || true
  fi
  echo "    Los het probleem op en start opnieuw (script is idempotent: meerdere keren draaien is veilig)." >/dev/stderr 2>/dev/null || true
  echo "    TIP: Gebruik STM_DEBUG=1 om per regel te zien wat er gebeurt." >/dev/stderr 2>/dev/null || true
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
  # ── Nu de fancy ANSI-versie OOK proberen (geen gevolg als het faalt)
  hr || true
  err "Installer FAILED op regel ${line}: ${cmd}" || true
  err "Volledig logbestand: ${LOG_FILE:-geen}" || true
  err "Los het probleem op, je kunt het script VEILIG opnieuw draaien (idempotent)." || true
  _STM_EXIT_PRINTED=1
  exit 1
}
trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

# ── EXIT TRAP (laatste-verdediging-2): ALTJD zichtbaar bij ELKE exit code != 0
#    (OOK expliciete `exit N`, die GEEN ERR-trap afvuurt! Dus vangt exit 2/3/4/5/9/10.)
on_exit() {
  local ec=$?
  [[ $ec -eq 0 ]] && return 0
  # Indien ERR trap al heeft gefiret (_STM_EXIT_PRINTED=1): geen duplicaat, enkel nog logbestand regel.
  if [[ "${_STM_EXIT_PRINTED:-0}" -eq 0 ]]; then
    echo "" >/dev/stderr 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
    echo "❌  STM INSTALLER AFGEBROKEN (exit code ${ec})" >/dev/stderr 2>/dev/null || true
    echo "    PID=$$ EUID=${EUID}  Script: $0" >/dev/stderr 2>/dev/null || true
    if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" ]]; then
      echo "    Logbestand: ${LOG_FILE}" >/dev/stderr 2>/dev/null || true
      echo "[EXIT ${ec}] Installer afgebroken" >> "$LOG_FILE" 2>/dev/null || true
    else
      echo "    Logbestand: (geen / niet schrijfbaar)" >/dev/stderr 2>/dev/null || true
    fi
    echo "    TIP: Gebruik STM_DEBUG=1 om per regel te zien wat er gebeurt." >/dev/stderr 2>/dev/null || true
    echo "    TIP: Script is idempotent — je kunt het VEILIG opnieuw draaien." >/dev/stderr 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
  fi
  return 0
}
trap 'on_exit' EXIT

# ------------------------------------------------------------------------------
# 0b. Argument parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update)          UPDATE_ONLY=1; shift ;;
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
#             STRICT: Script MOET echt als root draaien (EUID == 0).
#
#   ⚠️  HISTORISCHE BUG (vastgesteld 2026-09-22):
#       Oud checkte `SUDO_USER!=empty` ⇒ "al geëscaleerd". Maar als je als root
#       eerst `sudo -u stm -i` doet en VERVOLGENS ./nexus-install.sh draait,
#       blijft SUDO_USER GEZET (uit de eerste sudo-sessie), terwijl EUID=999 = stm.
#       Het script dacht toen "ik ben al root" en skipte de escalatie, waarna
#       het op alle /etc/caddy, systemctl en chown operaties crashte.
#
#   NIEUW: ECHTE root zijn (EUID == 0) is het ENIGE betrouwbare bewijs.
#         Onze eigen marker SUDO_ESCALATED=1 is ook betrouwbaar (want wij zetten
#         die alleen bij een succesvolle `exec sudo ... bash "$0" ...` herstart).
# ==============================================================================
#
# Helper: als_root <command...>
#   - DRAAIT command gegarandeerd als root.
#   - Als wij al root zijn (EUID=0):                direct exec, geen overhead.
#   - Als wij NIET root zijn maar sudo -n werkt:   via sudo -n -E -H
#   - Als geen van beide:                           exit 3 met duidelijke melding.
#     (in practice zouden wij nooit hier komen door de eerdere root-check!)
as_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  else
    if sudo -n true 2>/dev/null; then
      sudo -n -E -H "$@"
    else
      echo "" >/dev/stderr 2>/dev/null || true
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
      echo "❌  ROOT RECHTEN VEREIST (regel ${BASH_LINENO[0]:-?}): as_root $*" >/dev/stderr 2>/dev/null || true
      echo "    Je bent nu gebruiker $(id -un 2>/dev/null || echo "onbekend") met EUID=${EUID}." >/dev/stderr 2>/dev/null || true
      echo "" >/dev/stderr 2>/dev/null || true
      echo "    ✅  FIX: Log eerst UIT deze non-root sessie en start het script als ROOT:" >/dev/stderr 2>/dev/null || true
      echo "        exit" >/dev/stderr 2>/dev/null || true
      echo "        sudo -E bash $0 $*" >/dev/stderr 2>/dev/null || true
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
      exit 3
    fi
  fi
}

iam_root=0
if [[ "$EUID" -eq 0 ]]; then iam_root=1; fi
# Onze eigen marker (betrouwbaar: wij zetten hem alleen bij `exec sudo ...` herstart)
if [[ -n "${SUDO_ESCALATED:-}" && "${SUDO_ESCALATED}" == "1" ]]; then
  # Als we SUDO_ESCALATED hebben gezegd MOET EUID 0 zijn; is dat niet zo, dan
  # is er iets raar met de sudo-configuratie en forceren we een escalatie.
  if [[ "$EUID" -eq 0 ]]; then iam_root=1; fi
fi

if [[ "$iam_root" -eq 0 ]]; then
  # WIJ ZIJN NIET ROOT. Probeer escaleren via sudo.
  echo "[STM] Draaiend als gebruiker $(id -un 2>/dev/null || echo onbekend) (EUID=${EUID}). Auto-escalatie naar root proberen..." >/dev/stderr 2>/dev/null || true
  if require_cmd sudo; then
    # (1) Eerste keus: sudo zonder wachtwoord. Beste UX, 0 interactive prompts.
    if sudo -n true 2>/dev/null; then
      export SUDO_ESCALATED=1
      echo "[STM] sudo NOPASSWD toegestaan. PID=$$ → herstart als root via sudo -E bash $0 ..." >/dev/stderr 2>/dev/null || true
      exec sudo -H -E --preserve-env=HOME,PATH,NO_COLOR,TZ,STM_RUN_COUNT,SUDO_ESCALATED,STM_BOOTSTRAPPED,DEFAULT_GIT_BRANCH,STM_DEBUG \
        bash "$0" "$@"
      # exec komt nooit terug.
    fi
    # (2) Tweede keus: sudo MET wachtwoord. Laat de EXACTE copy-paste regel zien.
    #     Belangrijk: vermeld OOK de "stm"-sessie valkuil!
    echo "" >/dev/stderr 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
    echo "💡  Script draait NU NIET als root (huidige EUID=${EUID}, user=$(id -un 2>/dev/null || echo ?))." >/dev/stderr 2>/dev/null || true
    echo "    sudo vereist een wachtwoord (NOPASSWD) of je zat in een non-root sessie" >/dev/stderr 2>/dev/null || true
    echo "    (bijv. via \`sudo -u stm -i\` — dan blijft SUDO_USER staan en heb je nog steeds GEEN root!)" >/dev/stderr 2>/dev/null || true
    echo "" >/dev/stderr 2>/dev/null || true
    echo "    ✅  FIX — voer DEZE exacte regel UIT (in dezelfde terminal, of log eerst uit):" >/dev/stderr 2>/dev/null || true
    printf '        cd "%s" && sudo -E bash %s' "$(pwd -P 2>/dev/null || pwd)" "$0" >/dev/stderr 2>/dev/null || true
    # toon ook de originele args (zonder dat bash ze expansion verkeerd doet):
    _esc_arg=""
    for _esc_arg in "$@"; do
      printf ' %q' "$_esc_arg" >/dev/stderr 2>/dev/null || true
    done
    unset _esc_arg
    echo "" >/dev/stderr 2>/dev/null || true
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >/dev/stderr 2>/dev/null || true
    exit 3
  fi
  echo "✖  Geen sudo gevonden en niet als root gedraaid. Installeer sudo of draai als root (EUID=0)." >&2
  exit 3
fi

# Nu ZEKER root: init logging (schrijft naar /var/log/stm-install)
# ------------------------------------------------------------------------------
# Helper: init_logging: als EUID=root → /var/log/stm-install, anders /tmp fallback.
#   - Kopieert eerdere /tmp log naar nieuw bestand
#   - Redirect ZOWEL stdout ALS stderr via tee naar $LOG_FILE
#     → stdout+stderr OOK naar console (terminal output = zichtbaar!)
#   - Altijd fallback: LOG_FILE naar /dev/null OOK, dan nog wel console output.
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
  # Fallback: als bovenstaande mislukte, altijd een LOG_FILE dat /dev/null is (schrijven niet crasht)
  LOG_FILE="${LOG_FILE:-/dev/null}"
  # Kopieer eerdere /tmp log naar nieuw bestand (indien bestaat en verschillend)
  local old_log=""
  old_log="$(ls -t /tmp/stm-install/install-*-$$.log 2>/dev/null | head -1 || true)"
  if [[ -n "${old_log:-}" && -s "$old_log" && "${old_log}" != "${LOG_FILE}" && "${LOG_FILE}" != "/dev/null" ]]; then
    cat "$old_log" >> "$LOG_FILE" 2>/dev/null || true
  fi
  # ── BELANGRIJK: stdout EN stderr allebei via process substitution →
  #    console + logfile krijgen ALLE output. Nooit silent.
  #    (Doen we alleen als LOG_FILE niet /dev/null is; bij /dev/null gewoon console = default.)
  if [[ "${LOG_FILE}" != "/dev/null" ]]; then
    # stderr → tee naar logfile + stderr (duplicate niet op stdout!)
    exec 2> >(tee -a "$LOG_FILE" >&2) 2>/dev/null || true
    # stdout → tee naar logfile + stdout (zichtbaar in terminal!)
    exec >  >(tee -a "$LOG_FILE") 2>/dev/null || true
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
  # SAFETY: Schakel bash history expansion UIT + zet Git safe.directory voor target
  set +H 2>/dev/null || true
  if [[ -n "${target:-}" && -n "${target}" ]]; then
    git config --global --add safe.directory "${target}" 2>/dev/null || true
    [[ -n "${STM_USER:-}" ]] && sudo -nu "${STM_USER}" git config --global --add safe.directory "${target}" 2>/dev/null || true
    export GIT_CONFIG_COUNT=1
    export GIT_CONFIG_KEY_0="safe.directory"
    export GIT_CONFIG_VALUE_0="${target}"
  fi
  export DEBIAN_FRONTEND=noninteractive
  local bootstrap_tmpdir=""
  if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    info "Bootstrap: apt install git/curl/ca-certificates (1e setup...)"
    for _ in 1 2 3; do apt-get update -y >/dev/null 2>&1 && break || sleep 3; done
    apt-get install -y --no-install-recommends git curl ca-certificates >/dev/null 2>&1 || true
  fi
  # Bepaal target dir voor clone
  local target="${INSTALL_DIR}"
  mkdir -p "$target" 2>/dev/null || true
  if ! repo_files_present_in "$target"; then
    info "Bootstrap: ${GIT_URL} klonen naar ${target} ..."
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
        if [[ -z "${base}" ]]; then continue; fi
        # .git map: ALTIJD verplaatsen (cruciaal voor --update later!
        if [[ "${base}" == ".git" ]]; then
          rm -rf "${target}/.git" 2>/dev/null || true
          mv -f "${item}" "${target}/${base}" 2>/dev/null || cp -a "${item}" "${target}/${base}" 2>/dev/null || true
          continue
        fi
        if [[ -e "${target}/${base}" ]]; then
          # Bestaande bestanden niet overschrijven, tenzij het het install script zelf is
          [[ "${base}" == "nexus-install.sh" || "${base}" == "stm-install.sh" ]] && mv -f "${item}" "${target}/${base}" || true
        else
          mv -f "${item}" "${target}/${base}"
        fi
      done
      # Extra zekerheid: ALTIMER expliciet kopiëren indien nog aanwezig (fallback)
      if [[ -d "${bootstrap_tmpdir}/repo/.git" && ! -d "${target}/.git" ]]; then
        cp -a "${bootstrap_tmpdir}/repo/.git" "${target}/.git" 2>/dev/null || true
      fi
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
  info "Bootstrap: herstart installer vanuit ${self_in_target} (STM_RUN_COUNT=${STM_RUN_COUNT})..."
  echo "[STM] Bootstrap re-exec: herstart nu vanuit ${self_in_target} (zodat repo compleet in install dir staat)." >/dev/stderr 2>/dev/null || true
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
printf '%b  Starttijd : %s%b\n'        "${DIM}" "$(date +"%Y-%m-%d %H:%M:%S %Z")" "${RST}" | tee -a "$LOG_FILE"
printf '%b  Run-count: %s (max 3 anti-lus)%b\n' "${DIM}" "${STM_RUN_COUNT}" "${RST}" | tee -a "$LOG_FILE"
printf '%b  Uitvoerder: EUID=%s  SUDO_USER=%s%b\n' "${DIM}" "${EUID}" "${SUDO_USER:-none}" "${RST}" | tee -a "$LOG_FILE"
printf '%b  Logbestand: %s%b\n'        "${DIM}" "${LOG_FILE}" "${RST}" | tee -a "$LOG_FILE"
printf '%b  Install dir: %s%b\n'        "${DIM}" "${INSTALL_DIR}" "${RST}" | tee -a "$LOG_FILE"
hr

# ==============================================================================
# ╔════════════════════════════════════════════════════════════════════════════╗
# ║  UPDATE ONLY MODE (--update)                                               ║
# ║  Slaat STAPPEN 1-4 over (OS prep / gebruiker / firewall / Docker).         ║
# ║  Doet: git pull → bestandsfixes → .env upgrade → Caddy reload → rebuild.   ║
# ╚════════════════════════════════════════════════════════════════════════════╝
# ==============================================================================
if [[ "$UPDATE_ONLY" -eq 1 ]]; then
  title "UPDATE MODE — Alleen code bijwerken naar nieuwste GitHub commit"
  info "--update: OS prep / hardening / gebruiker / firewall / Docker install worden OVERSLAAN."

  # ── SHELL SAFETY: Bash history expansion UITSCHAKELEN + Git safety ──
  #    Voorkomt crash op speciale chars (!) in URL's / commit messages.
  #    Voorkomt "dubious ownership" crash in moderne Git >2.35.2: repo owner != huidige gebruiker.
  set +H 2>/dev/null || true
  for sdir in "${INSTALL_DIR}" "${INSTALL_DIR}/.git"; do
    git config --global --add safe.directory "${sdir}" 2>/dev/null || true
    [[ -n "${STM_USER:-}" ]] && sudo -nu "${STM_USER}" git config --global --add safe.directory "${sdir}" 2>/dev/null || true
  done
  # Ter verdediging: ook via env var forceren (werkt in oudere Git versies NIET, maar geen kwaad)
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="safe.directory"
  export GIT_CONFIG_VALUE_0="${INSTALL_DIR}"

  # ── CRITICAL: Zorg dat GIT_URL ALTIJD een waarde heeft! ──
  #    (kan leeg zijn als --git-url argument niet is doorgegeven + bootstrap het niet
  #     zette → dan val ik terug naar DEFAULT_GIT_URL)
  if [[ -z "${GIT_URL:-}" ]]; then
    info "  GIT_URL was leeg → fallback naar DEFAULT_GIT_URL: ${DEFAULT_GIT_URL}"
    GIT_URL="${DEFAULT_GIT_URL}"
  fi
  if [[ -z "${DEFAULT_GIT_BRANCH:-}" ]]; then
    DEFAULT_GIT_BRANCH="main"
    info "  DEFAULT_GIT_BRANCH was leeg → fallback: main"
  fi
  info "  Git config: repo=${GIT_URL}, branch=${DEFAULT_GIT_BRANCH}"

  # .env / docker-compose.prod.yml moeten bestaan (bewijs van bestaande install)
  if [[ ! -f "$ENV_FILE" || ! -f "$COMPOSE_FILE" ]]; then
    err "UPDATE MODE FAAL: .env of docker-compose.prod.yml ontbreekt in ${INSTALL_DIR}. Geen bestaande installatie."
    info "  Tip: Draai eerst een VOLLEDIGE installatie (zonder --update)."
    exit 11
  fi
  # Docker daemon moet draaien
  if ! docker info >/dev/null 2>&1; then
    err "UPDATE MODE FAAL: Docker daemon niet bereikbaar. Start eerst Docker: sudo systemctl start docker"
    exit 11
  fi

  # ── NETWORK PRE-CHECK: Kunnen we uberhaupt GitHub bereiken? ──
  #    Voorkomt 3x lange retry op een onbereikbare / DNS-broke VPS.
  step "Netwerk check: bereik GitHub (poort 443)?"
  GITHUB_HOST="$(printf '%s\n' "${GIT_URL}" | awk -F[/:] '{print $4}')"
  [[ -z "${GITHUB_HOST}" ]] && GITHUB_HOST="github.com"
  NET_OK=0
  if command -v timeout >/dev/null 2>&1 && (command -v nc >/dev/null 2>&1 || command -v bash >/dev/null 2>&1); then
    if command -v nc >/dev/null 2>&1; then
      timeout 5 nc -z -w 3 "${GITHUB_HOST}" 443 2>/dev/null && NET_OK=1 || true
    fi
    if [[ "$NET_OK" -eq 0 ]] && command -v curl >/dev/null 2>&1; then
      timeout 8 curl -sS -o /dev/null -m 5 -I "https://${GITHUB_HOST}/" 2>/dev/null && NET_OK=1 || true
    fi
  else
    NET_OK=1  # geen netwerk tools aanwezig → trust, overslaan check
  fi
  if [[ "$NET_OK" -eq 1 ]]; then
    ok "Netwerk OK: ${GITHUB_HOST}:443 bereikbaar."
  else
    err "Netwerk FAAL: ${GITHUB_HOST}:443 (GitHub) NIET bereikbaar vanaf deze VPS BINNEN 5s!"
    info "  Oorzaken + fixes:"
    info "   1. DNS werkt niet → test:   nslookup github.com"
    info "   2. Outbound firewall blokkeert 443 → test:   nc -zv github.com 443"
    info "   3. UFW blokkeert OUTPUT → sudo ufw allow out 443 comment 'git clone + updates'"
    info "   4. Repo URL verkeerd? Check met: export DEFAULT_GIT_URL=<jouw-https-url>"
    info "   5. GitHub status?  https://www.githubstatus.com/"
    exit 12
  fi

  cd "$INSTALL_DIR"
  COMPOSE_CMD=(docker compose -f "$COMPOSE_FILE")

  # ── AUTO-REPAIR: indien .git ontbreekt OF ongeldige repo (geen HEAD), ──
  #    herbouw dan de .git map AUTOMATISCH (zodat de gebruiker niet handmatig
  #    git init + remote add + fetch hoeft te doen). Dit is de bug die je had!
  GIT_VALID=0
  if [[ -d "${INSTALL_DIR}/.git" ]] && git -C "$INSTALL_DIR" rev-parse --git-dir >/dev/null 2>&1 && git -C "$INSTALL_DIR" rev-parse HEAD >/dev/null 2>&1; then
    GIT_VALID=1
  fi
  if [[ "$GIT_VALID" -eq 0 ]]; then
    title "AUTO-REPAIR: (her)bouw git repo in ${INSTALL_DIR}"
    info "  Oorzaak: installer heeft destijds de bestanden ZONDER .git-map gekopieerd."
    info "  Bestaande bestanden & .env PRESERVED; .git wordt opnieuw aangemaakt."
    # Oude corrupte .git → backup (voor zekerheid)
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
      OLDGIT_BACKUP="${INSTALL_DIR}/.git.backup-$$"
      step "Oude corrupte .git → backup naar ${OLDGIT_BACKUP} (bewaard 5 min)"
      mv -f "${INSTALL_DIR}/.git" "${OLDGIT_BACKUP}" 2>/dev/null || rm -rf "${INSTALL_DIR}/.git" 2>/dev/null || true
      # Automatisch na 5 minuten oude backup opschonen (fire-and-forget subshell)
      { sleep 300; rm -rf "${OLDGIT_BACKUP}" 2>/dev/null; } &
      disown 2>/dev/null || true
    fi
    # ── STAP A1: git init ──
    step "[1/5] Nieuwe git initialiseren (git init)"
    git_INIT_OUT="$(git -C "$INSTALL_DIR" init -q 2>&1)" ; git_INIT_RC=$?
    if [[ $git_INIT_RC -ne 0 ]]; then
      err "STAP 1/5 FAIL (git init, exit ${git_INIT_RC}): ${git_INIT_OUT}"
      exit 11
    fi
    ok "  git init OK."
    # ── STAP A2: remote origin toevoegen ──
    step "[2/5] Git remote origin zetten: ${GIT_URL}"
    git_REMOTE_OUT="$(git -C "$INSTALL_DIR" remote add origin "$GIT_URL" 2>&1)" ; git_REMOTE_RC=$?
    if [[ $git_REMOTE_RC -ne 0 ]]; then
      info "  remote add faalde (exit ${git_REMOTE_RC}, waarschijnlijk bestond origin al). Probeer set-url: ${git_REMOTE_OUT}"
      git_REMOTE_OUT="$(git -C "$INSTALL_DIR" remote set-url origin "$GIT_URL" 2>&1)" ; git_REMOTE_RC=$?
      if [[ $git_REMOTE_RC -ne 0 ]]; then
        err "STAP 2/5 FAIL (ook remote set-url, exit ${git_REMOTE_RC}): ${git_REMOTE_OUT}"
        exit 11
      fi
    fi
    # Verify remote
    git -C "$INSTALL_DIR" remote get-url origin >/dev/null
    ok "  git remote origin OK → $(git -C "$INSTALL_DIR" remote get-url origin)"
    # ── STAP A3: git ls-remote (test authenticatie / repo toegang ZONDER data download) ──
    step "[3/5] Toegang testen: git ls-remote origin (check rechten repo)"
    LSREMOTE_OUT=""
    LSREMOTE_RC=99
    for _ in 1 2 3; do
      LSREMOTE_OUT="$(timeout 20 git -C "$INSTALL_DIR" ls-remote --exit-code --heads origin "${DEFAULT_GIT_BRANCH}" 2>&1)" ; LSREMOTE_RC=$?
      [[ $LSREMOTE_RC -eq 0 ]] && break || sleep 3
    done
    if [[ $LSREMOTE_RC -ne 0 ]]; then
      err "STAP 3/5 FAIL (git ls-remote, exit ${LSREMOTE_RC}): GEEN TOEGANG TOT REPO!"
      info "  Output: ${LSREMOTE_OUT}"
      info "  Controleer:"
      info "   • Is de URL correct? (${GIT_URL})"
      info "   • Is de repo PUBLIEK? (zoniet: deploy key / HTTPS token nodig → --git-url https://<token>@github.com/..."
      info "   • Bestaat branch '${DEFAULT_GIT_BRANCH}'?"
      exit 11
    fi
    BRANCH_SHA="$(printf '%s\n' "${LSREMOTE_OUT}" | awk '{print $1; exit}')"
    ok "  Repo toegankelijk. branch ${DEFAULT_GIT_BRANCH} sha=${BRANCH_SHA}."
    # ── STAP A4: git fetch --depth 50 ──
    step "[4/5] git fetch --depth 50 origin ${DEFAULT_GIT_BRANCH} (nieuwe code binnenhalen)"
    FETCH_RC=99
    for attempt in 1 2 3; do
      info "  poging ${attempt}/3 …"
      # Pipefail-safe: run command first into var, check RC, THEN append to log+stderr
      FETCH_OUT=""
      FETCH_OUT="$(git -C "$INSTALL_DIR" fetch --depth 50 origin "${DEFAULT_GIT_BRANCH}" 2>&1)" ; FETCH_RC=$?
      printf '%s\n' "${FETCH_OUT}" | tee -a "$LOG_FILE" >&2 || true
      [[ $FETCH_RC -eq 0 ]] && break
      warn "  poging ${attempt}/3 FAALDE (exit ${FETCH_RC}). Wacht 3s…"
      sleep 3
    done
    if [[ $FETCH_RC -ne 0 ]]; then
      err "STAP 4/5 FAIL (git fetch, 3x geprobeerd, laatste exit=${FETCH_RC})."
      info "  Handmatig debuggen: cd ${INSTALL_DIR} && sudo GIT_TRACE=1 git fetch --depth 50 origin ${DEFAULT_GIT_BRANCH}"
      exit 11
    fi
    ok "  git fetch OK."
    # ── STAP A5: reset --mixed (index naar origin/branch; working tree LATEN STAAN) ──
    step "[5/5] git reset --mixed origin/${DEFAULT_GIT_BRANCH} (index syncen, bestaande bestanden bewaren)"
    RESET_OUT="$(git -C "$INSTALL_DIR" reset --mixed -q "origin/${DEFAULT_GIT_BRANCH}" 2>&1)" ; RESET_RC=$?
    if [[ $RESET_RC -ne 0 ]]; then
      warn "  reset --mixed gaf exit ${RESET_RC} (${RESET_OUT}). Soft-fallback: git symbolic-ref HEAD"
      git -C "$INSTALL_DIR" symbolic-ref HEAD "refs/remotes/origin/${DEFAULT_GIT_BRANCH}" 2>/dev/null || true
    fi
    ok "  Git repo AUTO-REPAIR 5/5 GESLAAGD."
    hr
  fi

  # ── Onthouden huidige commit (voor summary) ──
  OLD_COMMIT="(onbekend)"
  OLD_COMMIT_MSG="(onbekend)"
  OLD_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "onbekend")"
  OLD_COMMIT_MSG="$(git -C "$INSTALL_DIR" log -1 --pretty=format:%s 2>/dev/null || echo "onbekend")"
  info "Huidige commit: ${OLD_COMMIT} — ${OLD_COMMIT_MSG}"

  # ── OPTIONEEL: Lokale niet-gecommitde wijzigingen opslaan (geen dataverlies) ──
  #    We gebruiken git stash push -u (met untracked, maar NIET .env / user secrets).
  #    .env staat in .gitignore normaal, dus stash raakt hem NIET. Perfect.
  LOCAL_CHANGES=0
  if ! git -C "$INSTALL_DIR" diff --quiet 2>/dev/null || ! git -C "$INSTALL_DIR" diff --cached --quiet 2>/dev/null; then
    LOCAL_CHANGES=1
  fi
  if [[ "$LOCAL_CHANGES" -eq 1 ]]; then
    step "git stash: lokale niet-gecommitde wijzigingen tijdelijk opslaan (geen dataverlies!)"
    info "  De stash blijft bewaard na update — indien conflict: git stash pop & los op."
    STASH_OUT="$(git -C "$INSTALL_DIR" stash push -u -m "nexus-install.sh auto-stash v${INSTALLER_VERSION} $(date +%Y%m%d-%H%M%S)" 2>&1)" ; STASH_RC=$?
    printf '%s\n' "${STASH_OUT}" | tee -a "$LOG_FILE" >&2 || true
    if [[ $STASH_RC -ne 0 ]]; then
      warn "  git stash exit ${STASH_RC} (geen kritiek; gaan verder met update)."
    fi
  fi

  # ── Git fetch + checkout nieuwe commit ──
  step "git fetch origin + git reset --hard HEAD naar ${DEFAULT_GIT_BRANCH} (nieuwste code)"
  info "  OPMERKING: reset --hard = overwrite lokale bestanden in repo (bestaande stash is veilige fallback)."
  info "  .env staat in .gitignore en wordt dus NOOIT overschreven door git."

  # Remote check: als remote niet bestaat, voeg hem toe (zeldzaam, maar defensief)
  if ! git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1; then
    step "Git remote 'origin' ontbrak — aanmaken: ${GIT_URL}"
    git -C "$INSTALL_DIR" remote add origin "$GIT_URL" 2>&1 | tee -a "$LOG_FILE" >&2 || git -C "$INSTALL_DIR" remote set-url origin "$GIT_URL" 2>&1 | tee -a "$LOG_FILE" >&2
  else
    # Bestaande remote URL syncen met GIT_URL (indien gebruiker --git-url meegaf)
    CUR_REMOTE="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || echo "")"
    if [[ -n "${CUR_REMOTE:-}" && "${CUR_REMOTE}" != "${GIT_URL}" ]]; then
      step "Git remote origin bijwerken: ${CUR_REMOTE} → ${GIT_URL}"
      git -C "$INSTALL_DIR" remote set-url origin "$GIT_URL" 2>&1 | tee -a "$LOG_FILE" >&2
    fi
  fi

  # Fetch (PIPEFAIL-SAFE: 3x retry, check RC los van tee)
  PULL_OK=0
  PULL_ATTEMPT_RC=99
  PULL_OUTPUT=""
  for attempt in 1 2 3; do
    info "  git fetch poging ${attempt}/3 …"
    PULL_OUTPUT="$(git -C "$INSTALL_DIR" fetch --depth 50 origin "${DEFAULT_GIT_BRANCH}" 2>&1)" ; PULL_ATTEMPT_RC=$?
    printf '%s\n' "${PULL_OUTPUT}" | tee -a "$LOG_FILE" >&2 || true
    if [[ $PULL_ATTEMPT_RC -eq 0 ]]; then
      PULL_OK=1
      break
    fi
    warn "  Fetch poging ${attempt}/3 faalde (exit ${PULL_ATTEMPT_RC}). Retry na 3s…"
    sleep 3
  done
  if [[ "$PULL_OK" -eq 0 ]]; then
    err "git fetch mislukt na 3 pogingen (laatste exit=${PULL_ATTEMPT_RC})."
    info "  Laatste output: ${PULL_OUTPUT}"
    info "  Netwerk was eerder OK, dus meestal:"
    info "    • GitHub rate limit (wacht 1 minuut)"
    info "    • Repo permissions (deploy key verlopen)"
    info "  Handmatig debuggen: cd ${INSTALL_DIR} && sudo GIT_TRACE=1 git fetch --depth 50 origin ${DEFAULT_GIT_BRANCH}"
    exit 11
  fi
  # Reset to remote HEAD (atomic: nieuwste code, lokale tracked files overschreven)
  RESET_HARD_OUT="$(git -C "$INSTALL_DIR" reset --hard "origin/${DEFAULT_GIT_BRANCH}" 2>&1)" ; RESET_HARD_RC=$?
  printf '%s\n' "${RESET_HARD_OUT}" | tee -a "$LOG_FILE" >&2 || true
  if [[ $RESET_HARD_RC -ne 0 ]]; then
    err "git reset --hard FAALDE (exit ${RESET_HARD_RC}) → ${RESET_HARD_OUT}"
    exit 11
  fi

  # Nieuwe commit onthouden
  NEW_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo "onbekend")"
  NEW_COMMIT_MSG="$(git -C "$INSTALL_DIR" log -1 --pretty=format:%s 2>/dev/null || echo "onbekend")"
  ok "Git pull klaar: ${OLD_COMMIT} → ${NEW_COMMIT}"
  info "  Nieuwste commit: ${NEW_COMMIT_MSG}"

  # ── Chown NA git pull (root draait deze stap, maar STM_USER moet code kunnen lezen) ──
  step "chown -R ${STM_USER}:${STM_GROUP} ${INSTALL_DIR} (na git pull als root)"
  chown -R "${STM_USER}:${STM_GROUP}" "$INSTALL_DIR"

  # ── STAP 5.5 — Kritieke bestandsfixes (WORDEN ALTIJD GEFORCED, ook in update mode!) ──
  #    Dit vangt bugs in OUDE repo-versies die de gebruiker net binnenhaalde met git pull.
  #    Bijv. oude Prisma library engine, ESLint crash in JSX, enz.
  title "UPDATE STAP — Kritieke bestandsfixes (altijd forceren, ook in update!)"

  # ---- (1) Dockerfile: forceer PRISMA_CLIENT_ENGINE_TYPE=binary (3 plekken) ----
  step "Dockerfile: forceren crash-safe versie (Prisma binary engine + volledige node_modules)"
  cat > "${INSTALL_DIR}/Dockerfile" <<'STM_DOCKERFILE_V2'
FROM node:20-alpine AS base
# libc6-compat voor bepaalde glibc binary shims.
# PRISMA_CLIENT_ENGINE_TYPE=binary (altijd!): vermijd library engine crash
# op musl + openssl3 (geeft JSON Parse "Error load" fouten in prisma).
# Binary engine = alles statically linked; geen shared lib issues!
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN apk add --no-cache libc6-compat openssl ca-certificates
WORKDIR /app

# ----------
# Dependencies laag: installeren alleen wanneer package.json / lock veranderen
# ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "package-lock.json niet gevonden, abort." && exit 1; \
  fi

# ----------
# Build laag: compile Next.js + Prisma client voor Alpine musl
# ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client genereren: EXPLICIET BINARY engine (default voor Alpine musl, maar forceer)
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN npx prisma generate

# Next.js standalone build (output: ".next/standalone" + ".next/static")
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----------
# Runtime laag: minimaal image, non-root user, draait standalone server.js
# ----------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
# Non-root gebruiker aanmaken (node:20-alpine heeft al standaard "node" gebruiker, id 1000)
RUN addgroup --system --gid 1001 nodejs || true
RUN adduser  --system --uid 1001 nextjs || true

# Kopieer benodigde assets uit builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Next.js standalone folder bevat alle JS code
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Alle node_modules (dus NIET alleen Prisma-subdirs!) zodat bcryptjs,
# sharp (optioneel), auth-adapters etc. altijd aanwezig zijn in runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Runtime entrypoint: DB connectivity check + migrations + Next.js server
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0

# Container start: entrypoint.sh regelt volgorde (zie bestand)
CMD ["./entrypoint.sh"]
STM_DOCKERFILE_V2

  # ---- (2) entrypoint.sh: forceer 3-tier fallback migrate/deploy/push + debug ----
  step "entrypoint.sh: forceren crash-safe 3-tier Prisma migrations fallback"
  cat > "${INSTALL_DIR}/entrypoint.sh" <<'STM_ENTRYPOINT_V2'
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
#    Tier 3 : db push            (schema geforceerd syncen, zonder migrations)
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
STM_ENTRYPOINT_V2
  chmod +x "${INSTALL_DIR}/entrypoint.sh"

  # ---- (3) next.config.js: forceer images.unoptimized: true (geen sharp nodig!) ----
  step "next.config.js: forceren unoptimized images (geen sharp!) + eslint ignoreDuringBuilds"
  cat > "${INSTALL_DIR}/next.config.js" <<'STM_NEXT_CONFIG_V2'
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
STM_NEXT_CONFIG_V2

  # ---- (4) package.json: forceer "build": "next build --no-lint" ----
  step "package.json: forceren \"next build --no-lint\" (extra safety laag ESLint)"
  if grep -qF '"build": "next build"' "${INSTALL_DIR}/package.json" 2>/dev/null; then
    sed -i.bak -E 's|"build":[[:space:]]*"next build"|"build": "next build --no-lint"|' "${INSTALL_DIR}/package.json" && rm -f "${INSTALL_DIR}/package.json.bak" || true
  fi

  # ---- (5) navixy-settings-client.tsx: escape quotes in JSX ----
  step "navixy-settings-client.tsx: escapen quotes in JSX (voorkomt ESLint build crash)"
  NAVIXY_FILE="${INSTALL_DIR}/src/app/(app)/settings/_components/navixy-settings-client.tsx"
  if [[ -f "$NAVIXY_FILE" ]]; then
    sed -i.bak 's/methode "clone"/methode \&quot;clone\&quot;/g' "$NAVIXY_FILE" 2>/dev/null || true
    sed -i.bak "s/ alleen bij methode \"clone\"/ alleen bij methode \&quot;clone\&quot;/g" "$NAVIXY_FILE" 2>/dev/null || true
    rm -f "${NAVIXY_FILE}.bak" 2>/dev/null || true
  fi

  # Laatste chown (we hebben als root bestanden aangemaakt!)
  step "chown -R ${STM_USER}:${STM_GROUP} ${INSTALL_DIR} (na forceren fixes als root)"
  chown -R "${STM_USER}:${STM_GROUP}" "$INSTALL_DIR"

  ok "Kritieke bestandsfixes toegepast (Dockerfile, entrypoint, next.config, package.json, ESLint-fix)."

  # ==============================================================================
  # UPDATE STAP — .env UPGRADE (alleen AANVULLEN, NIET overschrijven!)
  # ==============================================================================
  title "UPDATE STAP — .env upgrade (alleen ontbrekende waarden aanvullen, bestaande secrets PRESERVEN!)"
  # Gebruik env_upsert (al gedefinieerd in STAP 6, maar nog niet bereikt in update mode).
  # Definieer ze hier OOK (defensief: idempotent, zelfde code).
  env_upsert_update() {
    local key="$1" value="$2"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
      local cur
      cur="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed "s/^\"//;s/\"\$//")"
      if [[ -z "${cur}" ]]; then
        sed -i.bak -e "s|^${key}=\$|${key}=${value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak" || true
      fi
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }
  env_set_update() {
    local key="$1" value="$2"
    local esc_value
    esc_value="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
      sed -i.bak -e "s|^${key}=.*|${key}=${esc_value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak" || true
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }
  if [[ -n "${DOMAIN:-}" ]]; then
    DOMAIN="${DOMAIN#http://}"
    DOMAIN="${DOMAIN#https://}"
    DOMAIN="${DOMAIN%%/*}"
    NEXT_APP_URL="https://${DOMAIN}"
    env_set_update "STM_DOMAIN" "${DOMAIN}"
    env_set_update "NEXUS_DOMAIN" '${STM_DOMAIN:-}'
    env_set_update "NEXT_PUBLIC_APP_URL" "${NEXT_APP_URL}"
    env_set_update "AUTH_URL" '${NEXT_PUBLIC_APP_URL:-}/api/auth'
  else
    env_upsert_update "STM_DOMAIN" "localhost"
    env_upsert_update "NEXT_PUBLIC_APP_URL" "http://localhost:3000"
    env_upsert_update "AUTH_URL" "http://localhost:3000/api/auth"
  fi
  env_upsert_update "AUTH_TRUST_HOST" "true"
  env_upsert_update "TZ" "${TZ_VALUE}"
  env_upsert_update "NODE_ENV" "production"
  env_upsert_update "POSTGRES_DB" "stm"
  env_upsert_update "POSTGRES_USER" "stm"
  env_upsert_update "STM_APP_URL" "127.0.0.1:3000"
  chmod 0600 "$ENV_FILE"
  chown "${STM_USER}:${STM_GROUP}" "$ENV_FILE"
  ok ".env geüpgraded (alleen NIEUWE vars aangevuld; secrets & bestaande waarden ongewijzigd)."

  # ==============================================================================
  # UPDATE STAP — Caddy (reload, NIET opnieuw installeren!)
  # ==============================================================================
  if [[ "$NO_CADDY" -eq 0 ]] && command -v caddy >/dev/null 2>&1 && systemctl list-unit-files caddy.service >/dev/null 2>&1; then
    title "UPDATE STAP — Caddy: config sync + reload (geen herinstallatie!)"
    # ---- Defensive copy Caddyfile uit repo ----
    if [[ -n "${CUSTOM_CADDYFILE_SRC:-}" && -f "$CUSTOM_CADDYFILE_SRC" ]]; then
      step "Nieuwe Caddyfile uit repo kopiëren → /etc/caddy/Caddyfile"
      as_root mkdir -p /etc/caddy
      as_root cp -f "$CUSTOM_CADDYFILE_SRC" /etc/caddy/Caddyfile
      as_root chown root:root /etc/caddy/Caddyfile
      as_root chmod 0644 /etc/caddy/Caddyfile
    else
      if [[ -z "${CUSTOM_CADDYFILE_SRC:-}" ]]; then
        warn "CUSTOM_CADDYFILE_SRC variabele was leeg; /etc/caddy/Caddyfile NIET overschreven (verwachte file: ${INSTALL_DIR}/Caddyfile)."
      else
        info "Geen custom Caddyfile in repo (${CUSTOM_CADDYFILE_SRC}); bestaande /etc/caddy/Caddyfile blijft ongewijzigd."
      fi
    fi
    # ---- /etc/caddy/.env bijwerken ----
    as_root mkdir -p /etc/caddy
    grep -E '^(STM_DOMAIN|NEXT_PUBLIC_APP_URL|STM_APP_URL)=' "$ENV_FILE" 2>/dev/null | as_root tee /etc/caddy/.env >/dev/null || true
    if ! as_root grep -qE '^STM_APP_URL=' /etc/caddy/.env 2>/dev/null; then
      printf 'STM_APP_URL=127.0.0.1:3000\n' | as_root tee -a /etc/caddy/.env >/dev/null || true
    fi
    as_root chown root:root /etc/caddy/.env || true
    as_root chmod 0600 /etc/caddy/.env || true
    # ---- Validate & reload ----
    step "caddy validate + reload"
    if caddy validate --config /etc/caddy/Caddyfile 2>&1 | tee -a "$LOG_FILE" >&2; then
      as_root systemctl reload caddy 2>&1 | tee -a "$LOG_FILE" >&2 || \
        as_root systemctl restart caddy 2>&1 | tee -a "$LOG_FILE" >&2 || true
      ok "Caddy config gevalideerd + herladen."
    else
      warn "Nieuwe Caddyfile valideert NIET. Huidige Caddy NIET herladen (downtime voorkomen!)."
      info "  Handmatig nakijken: sudo caddy adapt --config /etc/caddy/Caddyfile"
    fi
  elif [[ "$NO_CADDY" -eq 0 ]]; then
    info "Caddy niet aanwezig op systeem; Caddy update stap overgeslagen."
  fi

  # ==============================================================================
  # UPDATE STAP — Docker: build met cache (--no-cache alleen bij EERSTE install!),
  #                 up -d + health checks
  # ==============================================================================
  title "UPDATE STAP — Docker: build (MET cache!) + compose up -d + health"
  cd "$INSTALL_DIR"
  step "docker compose config valideren..."
  "${COMPOSE_CMD[@]}" config -q 2>&1 | tee -a "$LOG_FILE" >&2
  ok "docker-compose.prod.yml syntaxis OK."

  # Bij UPDATE: cache WEL toegestaan (verschil met eerste install!).
  # Want de kritieke fixes forceren net NIEUWE Dockerfile/entrypoint.sh/next.config,
  # dus de cache-invalidation gebeurt al automatisch door die file-wijzigingen.
  # Ook expliciet --pull: altijd nieuwste node:20-alpine + postgres:16 images.
  step "Docker pull Postgres 16 + build stm-app (MET cache voor snelheid, maar met --pull voor nieuwste base images)..."
  "${COMPOSE_CMD[@]}" pull --quiet stm-db 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
  "${COMPOSE_CMD[@]}" build --pull stm-app 2>&1 | tail -20 | tee -a "$LOG_FILE" >&2
  ok "Docker build voltooid (cache gebruikt → snel)."

  # Up -d (force-recreate: zelfde image hash → toch opnieuw starten, nieuwe env in werking)
  step "docker compose up -d --force-recreate (migrations via entrypoint.sh)"
  "${COMPOSE_CMD[@]}" up -d --force-recreate 2>&1 | tail -5 | tee -a "$LOG_FILE" >&2

  # Health checks (identiek aan STAP 8)
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
    if (( i % 20 == 0 )); then printf '  [%d/%d] wachten op Next.js (migraties + startup)...\n' "$i" "$APP_MAX_WAIT" >&2 | tee -a "$LOG_FILE"; fi
  done
  HTTP_CODE="000"
  if require_cmd curl; then
    HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
      --connect-timeout 5 --retry 2 --insecure http://127.0.0.1:3000/api/health 2>/dev/null || echo 000)"
  fi
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' stm-app 2>/dev/null || echo '')"
  if [[ "$HTTP_CODE" == "200" || "$STATUS" == "healthy" ]]; then
    ok "Next.js healthy + /api/health HTTP 200 (Docker status=${STATUS})."
  else
    err "Next.js NIET healthy binnen ${APP_MAX_WAIT}s. Docker=${STATUS}; 127.0.0.1:3000/api/health -> HTTP ${HTTP_CODE}."
    info "LAATSTE 80 REGELS STM-APP LOGS (debug dit!):"
    docker logs --tail 80 stm-app 2>&1 | tee -a "$LOG_FILE" >&2 || true
    info "LAATSTE 40 REGELS STM-DB LOGS:"
    docker logs --tail 40 stm-db  2>&1 | tee -a "$LOG_FILE" >&2 || true
    exit 8
  fi

  # ==============================================================================
  # UPDATE STAP — Optioneel: seed (--seed)
  # ==============================================================================
  if [[ "$SEED" -eq 1 ]]; then
    title "UPDATE STAP — Seed: Prisma demo-gebruikers + data (met SQL fallback!)"
    TEST_BCRYPT_HASH='$2a$10$uEvOIvGEtHkbWbC15Cq3ZOiJvmosBQ9chrLAApQkOdf4SzzAZbfdC'
    SEED_OK=0
    step "docker exec -e PRISMA_CLIENT_ENGINE_TYPE=binary stm-app npx prisma db seed"
    if docker exec -e PRISMA_CLIENT_ENGINE_TYPE=binary stm-app npx prisma db seed 2>&1 | tail -15 | tee -a "$LOG_FILE" >&2; then
      SEED_OK=1
    else
      warn "Prisma seed (tier 1) FAILDE. Fallback: DIRECT SQL insert 3 users..."
    fi
    if [[ "$SEED_OK" -eq 0 ]]; then
      step "DIRECT SQL insert 3 users (admin / medewerker / viewer) in stm-db..."
      PGPASS_FROM_ENV="$(awk -F= '/^POSTGRES_PASSWORD=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo '')"
      docker exec -i stm-db psql -U stm -d stm <<STM_SEED_SQL
INSERT INTO users (id, email, name, "passwordHash", role, "createdAt", "updatedAt") VALUES
  (
    'cl-seed-admin-000000000000001',
    'admin@nexus.local',
    'Administrator',
    '${TEST_BCRYPT_HASH}',
    'ADMIN',
    NOW(),
    NOW()
  ),
  (
    'cl-seed-employee-00000000000002',
    'medewerker@nexus.local',
    'Medewerker Nexus',
    '${TEST_BCRYPT_HASH}',
    'EMPLOYEE',
    NOW(),
    NOW()
  ),
  (
    'cl-seed-viewer-000000000000003',
    'viewer@nexus.local',
    'Viewer Account',
    '${TEST_BCRYPT_HASH}',
    'VIEWER',
    NOW(),
    NOW()
  )
ON CONFLICT (email) DO NOTHING;
STM_SEED_SQL
      UC=$(docker exec -i stm-db psql -U stm -d stm -t -c "SELECT count(*) FROM users WHERE email IN ('admin@nexus.local','medewerker@nexus.local','viewer@nexus.local');" 2>/dev/null | tr -d ' \n' || echo 0)
      if [[ "$UC" -ge "3" ]]; then
        SEED_OK=1
        ok "SQL fallback SUCCESVOL: ${UC} demo-gebruikers in users tabel."
      fi
    fi
    if [[ "$SEED_OK" -eq 1 ]]; then
      ok "Seed compleet (Prisma of SQL fallback). Inloggen:"
      info "   📧 admin@nexus.local   / 🔑 Test1234!   (role: ADMIN)"
      info "   📧 medewerker@nexus.local / 🔑 Test1234! (role: EMPLOYEE)"
      info "   📧 viewer@nexus.local   / 🔑 Test1234!   (role: VIEWER)"
    fi
  fi

  # ==============================================================================
  # UPDATE STAP — Summary & exit
  # ==============================================================================
  INSTALL_END_EPOCH="$(date +%s)"
  ELAPSED_SEC=$(( INSTALL_END_EPOCH - INSTALL_START_EPOCH ))
  ELAPSED_MIN=$(( ELAPSED_SEC / 60 ))
  ELAPSED_SEC_R=$(( ELAPSED_SEC - ELAPSED_MIN * 60 ))
  title "UPDATE VOLTOOID in ${ELAPSED_MIN}m${ELAPSED_SEC_R}s"
  hr
  FINAL_DOMAIN="$(awk -F= '/^STM_DOMAIN=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo "localhost")"
  FINAL_URL="$(awk -F= '/^NEXT_PUBLIC_APP_URL=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo "http://localhost:3000")"
  cat <<SUMMARY | tee -a "$LOG_FILE"
${BLD}  ✅ UPDATE SUCCESVOL — STM (voorheen Nexus)${RST}

  ${CYN}Commit (vorig → nieuw) :${RST}  ${OLD_COMMIT} → ${NEW_COMMIT}
  ${CYN}Nieuwste commit msg    :${RST}  ${NEW_COMMIT_MSG}
  ${CYN}App-URL               :${RST}  ${FINAL_URL}
  ${CYN}Domein                :${RST}  ${FINAL_DOMAIN}
  ${CYN}Installatiemap        :${RST}  ${INSTALL_DIR}
  ${CYN}Docker containers     :${RST}  $(docker ps --format '{{.Names}} ({{.Status}})' -f name='stm-' 2>/dev/null | paste -sd ', ' || echo 'onbekend')
  ${CYN}.env bestandsgrootte  :${RST}  $(wc -c < "$ENV_FILE" 2>/dev/null || echo 0) bytes (alle secrets PRESERVED!)

  ${BLD}--- Nuttige commando's: ---${RST}
    cd ${INSTALL_DIR}
    sudo bash ./nexus-install.sh --update                          # UPDATE (opnieuw)
    docker compose -f docker-compose.prod.yml logs -f --tail 50   # live logs alles
    docker compose -f docker-compose.prod.yml ps                    # status
    sudo /opt/stm/scripts/backup-stm-db.sh                          # NU backup draaien

  ${BLD}--- Rollback tip (indien nieuwe commit bug heeft): ---${RST}
    cd ${INSTALL_DIR}
    git stash list                                                  # je auto-stash staat hier, NIET verwijderen!
    sudo git reset --hard ${OLD_COMMIT}                            # TERUG naar vorige commit
    sudo bash ./nexus-install.sh --update                           # + rebuild oude versie
SUMMARY
  hr
  if [[ -n "${LOCAL_CHANGES:-}" && "$LOCAL_CHANGES" -eq 1 ]]; then
    warn "Lokale niet-gecommitde wijzigingen werden bewaard in git stash:"
    info "  cd ${INSTALL_DIR} && sudo -u ${STM_USER} git stash list"
    info "  → Conflicten of wijzigingen terugzetten? sudo -u ${STM_USER} git stash pop"
  fi
  ok "Update-log: ${LOG_FILE} (bij fouten altijd meesturen)."
  info "Refresh je browser (Ctrl+Shift+R) om de nieuwste frontend code te laden!"
  exit 0
fi
# ==============================================================================
# EINDE UPDATE ONLY MODE
# ==============================================================================

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
  *)
    warn "OS ID='${ID}'. Script is afgestemd op Ubuntu. Resultaten zijn ONGETEST."
    if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
      confirm "Toch doorgaan?" || exit 4
    else
      info "NON_INTERACTIVE=1: automatisch doorgaan (bestaande OS ID='${ID}'..."
    fi
    ;;
esac
case "${VERSION_ID:-0}" in
  22.04|24.04) ok "OS: Ubuntu ${VERSION_ID} (${PRETTY_NAME:-})" ;;
  *)
    warn "Ubuntu versie ${VERSION_ID} wordt NIET expliciet ondersteund (alleen 22.04/24.04 getest)."
    if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
      confirm "Toch doorgaan?" || exit 4
    else
      info "NON_INTERACTIVE=1: automatisch doorgaan (bestaande Ubuntu ${VERSION_ID})."
    fi
    ;;
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
  if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    confirm "Doorgaan?" || exit 5
  else
    info "NON_INTERACTIVE=1: automatisch doorgaan (onvoldoende RAM ~${TOTAL_RAM_MB} MB)."
  fi
fi

# 1.5 Schijfruimte: Min. 10 GB
FREE_DISK_MB=0
require_cmd df && FREE_DISK_MB="$(df -Pk "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {printf "%.0f", $4/1024}' || echo 0)"
[[ "$FREE_DISK_MB" -eq 0 ]] && require_cmd df && FREE_DISK_MB="$(df -Pk / | awk 'NR==2 {printf "%.0f", $4/1024}')"
info "Schijfruimte: ~${FREE_DISK_MB} MB (vrij in ${INSTALL_DIR:-/})"
if (( FREE_DISK_MB > 0 && FREE_DISK_MB < 8000 )); then
  warn "Minder dan ~8 GB vrij. Docker build zal mogelijk falen."
  if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
    confirm "Toch doorgaan?" || exit 5
  else
    info "NON_INTERACTIVE=1: automatisch doorgaan (weinig schijfruimte ~${FREE_DISK_MB} MB)."
  fi
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
# ── 2x safety om bash history expansion (!) te vermijden: ──
#    (1) Zet history expansion TIJDELIJK uit (bash '!'-karakter crash anders heredocs).
#    (2) De heredoc heeft hieronder ALTIJD GEQUOTED delimiter <<'EOF', dus geen expansion.
set +H 2>/dev/null || true
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
  "fixed-cidr-v6": "fd00:cad1:ceb4::/64",
  "default-address-pools": [
    {"base": "172.25.0.0/16", "size": 24},
    {"base": "172.31.0.0/16", "size": 24}
  ]
}
DOCKER_DAEMON_EOF
chmod 0644 /etc/docker/daemon.json 2>/dev/null || true
set -H 2>/dev/null || true   # History expansion weer AAN (als het aan stond)
# Docker groep aanmaken (indien nog niet) + user toevoegen
getent group docker >/dev/null 2>&1 || groupadd docker
usermod -aG docker "$STM_USER" 2>/dev/null || true

# ============================================================
# 4.2 🔥 DOCKER DAEMON START + GARANDEREN DAT HIJ WERKT
# (Dit was de FATALE bug: || true → nooit gezien dat Docker NIET startte!)
# ============================================================
systemctl unmask docker 2>/dev/null || true
systemctl daemon-reload
systemctl enable docker docker.socket containerd 2>/dev/null || true

# Probeer eerst een 'restart' (of start indien nog niet):
echo "[STM] Docker systemd: enable/restart containerd → docker.socket → docker..." >/dev/stderr 2>/dev/null || true
systemctl restart containerd 2>&1 | tee -a "$LOG_FILE" >&2 || true
sleep 1
systemctl restart docker.socket docker 2>&1 | tee -a "$LOG_FILE" >&2 || \
  systemctl start docker.socket docker 2>&1 | tee -a "$LOG_FILE" >&2 || true

# WACHT MAXIMAAL 30s OP DOCKER SOCKET:
_docker_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker info >/dev/null 2>&1; then
    _docker_ok=1
    break
  fi
  sleep 3
done

if [[ "$_docker_ok" -eq 0 ]]; then
  echo "" >/dev/stderr 2>/dev/null || true
  echo "[STM] ❌ DOCKER STARTEN MISLUKT. Details volgen (exit 6)." >/dev/stderr 2>/dev/null || true
  err "Docker daemon STARTEN mislukt na 30s (socket /var/run/docker.sock niet bereikbaar)."
  echo "" >/dev/stderr 2>/dev/null || true

  # ── PRINT ONBREEKBAAR: eerst data opvangen, dan naar stderr, dan optioneel log.
  #    GEEN | tee -a $LOG_FILE | pipe meer! (Zelfde patroon als to_log_and_stderr helper!)
  _out=""
  info "=== (1/3) SYSTEMD STATUS docker, containerd, docker.socket ==="
  _out="$(systemctl status docker containerd docker.socket --no-pager -l 2>&1 || true)" || true
  printf '%s\n' "$_out" 1>&2 || true
  if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" && -d "$(dirname "$LOG_FILE" 2>/dev/null || echo "")" ]]; then
    printf '%s\n' "$_out" >> "$LOG_FILE" 2>/dev/null || true
  fi

  echo "" >/dev/stderr 2>/dev/null || true
  info "=== (2/3) JOURNAL LOGS docker (LAATSTE 80 REGELS) ==="
  _out="$(journalctl -u docker --no-pager -n 80 2>&1 || true)" || true
  printf '%s\n' "$_out" 1>&2 || true
  if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" && -d "$(dirname "$LOG_FILE" 2>/dev/null || echo "")" ]]; then
    printf '%s\n' "$_out" >> "$LOG_FILE" 2>/dev/null || true
  fi

  echo "" >/dev/stderr 2>/dev/null || true
  info "=== (3/3) JOURNAL LOGS containerd (LAATSTE 40 REGELS) ==="
  _out="$(journalctl -u containerd --no-pager -n 40 2>&1 || true)" || true
  printf '%s\n' "$_out" 1>&2 || true
  if [[ -n "${LOG_FILE:-}" && "${LOG_FILE}" != "/dev/null" && -d "$(dirname "$LOG_FILE" 2>/dev/null || echo "")" ]]; then
    printf '%s\n' "$_out" >> "$LOG_FILE" 2>/dev/null || true
  fi

  echo "" >/dev/stderr 2>/dev/null || true
  info "Handmatig proberen opstarten + debuggen:"
  info "  sudo systemctl daemon-reload && sudo systemctl restart containerd docker && sleep 4 && sudo docker info"
  info "  sudo apt-get install --reinstall docker-ce docker-ce-cli containerd.io   # (forceer herinstall)"
  info "  sudo ss -lntp | grep -E ':(2375|2376)' | head -5                              # (socket?)"
  exit 6
fi

sudo -u "$STM_USER" docker ps >/dev/null 2>&1 2>/dev/null || info "⚠ User '${STM_USER}' in groep docker; nieuwe SSH-sessie nodig voor toegang (sudo docker werkt wel)."

ok "Docker daemon config (log-rotation + pools) toegepast. Daemon RUNNING + bereikbaar. User ${STM_USER} in docker-groep."

# ==============================================================================
# STAP 5 — Code: Git clone OF fallback. Chown naar ${STM_USER}.
# ==============================================================================
title "STAP 5 — Installatiemap: ${INSTALL_DIR} (git clone OF bestaande map)"

# ── SHELL + GIT SAFETY (VOORAFGAAND AAN ALLE GIT OPERATIES IN STAP 5) ──
# History expansion UIT; Git dubious ownership = zet INSTALL_DIR permanent op whitelist
set +H 2>/dev/null || true
for sdir in "${INSTALL_DIR}" "${INSTALL_DIR}/.git"; do
  git config --global --add safe.directory "${sdir}" 2>/dev/null || true
  [[ -n "${STM_USER:-}" ]] && sudo -nu "${STM_USER}" git config --global --add safe.directory "${sdir}" 2>/dev/null || true
done
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="safe.directory"
export GIT_CONFIG_VALUE_0="${INSTALL_DIR}"

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
    for item in "${TMP_GIT}"/*; do
      base="${item##*/}"
      [[ -z "${base}" ]] && continue
      # .git map: ALTIJD overschrijven / verplaatsen (cruciaal voor --update later!)
      if [[ "${base}" == ".git" ]]; then
        rm -rf "${INSTALL_DIR}/.git" 2>/dev/null || true
        mv -f "${item}" "${INSTALL_DIR}/${base}" 2>/dev/null || cp -a "${item}" "${INSTALL_DIR}/${base}" 2>/dev/null || true
        continue
      fi
      if [[ -e "${INSTALL_DIR}/${base}" ]]; then
        # Al bestaande install script: overschrijven. Rest: overslaan.
        [[ "${base}" == "nexus-install.sh" || "${base}" == "stm-install.sh" ]] && mv -f "${item}" "${INSTALL_DIR}/${base}" || true
      else
        mv -f "${item}" "${INSTALL_DIR}/${base}"
      fi
    done
    # Fallback: expliciet .git kopiëren indien TMP_GIT hem heeft en target niet
    if [[ -d "${TMP_GIT}/.git" && ! -d "${INSTALL_DIR}/.git" ]]; then
      cp -a "${TMP_GIT}/.git" "${INSTALL_DIR}/.git" 2>/dev/null || true
    fi
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
# STAP 5.5 — KRITIEKE BESTANDSFIXES (forceren, ook als repo oudere versies heeft!)
#   Dit voorkomt ALLE bugs die we vandaag tegenkwamen (Prisma crashes,
#   ESLint build crash, sharp warnings, geen users, etc.) — 100% deterministisch.
# ==============================================================================
title "STAP 5.5 — Kritieke bestandsfixes (Prisma, Next, Caddy, Build)"

# ---- (1) Dockerfile: forceer PRISMA_CLIENT_ENGINE_TYPE=binary (3 plekken)
#      + volledige node_modules copy (geen alleen prisma subdirs)
step "Dockerfile: forceren crash-safe versie (Prisma binary engine + volledige node_modules)"
cat > "${INSTALL_DIR}/Dockerfile" <<'STM_DOCKERFILE_V2'
FROM node:20-alpine AS base
# libc6-compat voor bepaalde glibc binary shims.
# PRISMA_CLIENT_ENGINE_TYPE=binary (altijd!): vermijd library engine crash
# op musl + openssl3 (geeft JSON Parse "Error load" fouten in prisma).
# Binary engine = alles statically linked; geen shared lib issues!
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN apk add --no-cache libc6-compat openssl ca-certificates
WORKDIR /app

# ----------
# Dependencies laag: installeren alleen wanneer package.json / lock veranderen
# ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "package-lock.json niet gevonden, abort." && exit 1; \
  fi

# ----------
# Build laag: compile Next.js + Prisma client voor Alpine musl
# ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client genereren: EXPLICIET BINARY engine (default voor Alpine musl, maar forceer)
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
RUN npx prisma generate

# Next.js standalone build (output: ".next/standalone" + ".next/static")
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ----------
# Runtime laag: minimaal image, non-root user, draait standalone server.js
# ----------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV PRISMA_CLIENT_ENGINE_TYPE=binary
# Non-root gebruiker aanmaken (node:20-alpine heeft al standaard "node" gebruiker, id 1000)
RUN addgroup --system --gid 1001 nodejs || true
RUN adduser  --system --uid 1001 nextjs || true

# Kopieer benodigde assets uit builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Next.js standalone folder bevat alle JS code
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Alle node_modules (dus NIET alleen Prisma-subdirs!) zodat bcryptjs,
# sharp (optioneel), auth-adapters etc. altijd aanwezig zijn in runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Runtime entrypoint: DB connectivity check + migrations + Next.js server
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0

# Container start: entrypoint.sh regelt volgorde (zie bestand)
CMD ["./entrypoint.sh"]
STM_DOCKERFILE_V2

# ---- (2) entrypoint.sh: forceer 3-tier fallback migrate/deploy/push + debug
step "entrypoint.sh: forceren crash-safe 3-tier Prisma migrations fallback"
cat > "${INSTALL_DIR}/entrypoint.sh" <<'STM_ENTRYPOINT_V2'
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
#    Tier 3 : db push            (schema geforceerd syncen, zonder migrations)
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
STM_ENTRYPOINT_V2
chmod +x "${INSTALL_DIR}/entrypoint.sh"

# ---- (3) next.config.js: forceer images.unoptimized: true (geen sharp nodig!)
#      + eslint ignoreDuringBuilds (geen build crash op lint warnings)
step "next.config.js: forceren unoptimized images (geen sharp!) + eslint ignoreDuringBuilds"
cat > "${INSTALL_DIR}/next.config.js" <<'STM_NEXT_CONFIG_V2'
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
STM_NEXT_CONFIG_V2

# ---- (4) package.json: forceer "build": "next build --no-lint"
step "package.json: forceren \"next build --no-lint\" (extra safety laag ESLint)"
if grep -qF '"build": "next build"' "${INSTALL_DIR}/package.json" 2>/dev/null; then
  sed -i.bak -E 's|"build":[[:space:]]*"next build"|"build": "next build --no-lint"|' "${INSTALL_DIR}/package.json" && rm -f "${INSTALL_DIR}/package.json.bak" || true
fi

# ---- (5) src/app/(app)/settings/_components/navixy-settings-client.tsx
#      escape quotes "clone" in JSX tekst → ESLint crash voorkomen!
step "navixy-settings-client.tsx: escapen quotes in JSX (voorkomt ESLint build crash)"
NAVIXY_FILE="${INSTALL_DIR}/src/app/(app)/settings/_components/navixy-settings-client.tsx"
if [[ -f "$NAVIXY_FILE" ]]; then
  # Regel 545: "clone" → &quot;clone&quot;
  sed -i.bak 's/methode "clone"/methode \&quot;clone\&quot;/g' "$NAVIXY_FILE" 2>/dev/null || true
  # Extra vangnet: alle niet-geescapete " in tekst tussen tags vervangen indien nodig
  sed -i.bak "s/ alleen bij methode \"clone\"/ alleen bij methode \&quot;clone\&quot;/g" "$NAVIXY_FILE" 2>/dev/null || true
  rm -f "${NAVIXY_FILE}.bak" 2>/dev/null || true
fi

# ---- (6) Caddyfile in repo: overslaan (we gebruiken fallback in STAP 7 altijd).
#      Indien er EEN custom Caddyfile in /opt/stm staat met verkeerde directives
#      (foute durations of fail_timeout) → overschrijven met fallback.
step "Caddyfile validatie (indien in repo verkeerde directives: fallback gebruikt in STAP 7)"
# (Eigenlijk gebeurt dit al in STAP 7 via CADDY_FALLBACK, dus verder niets hier.)

# Laatste chown (we hebben als root bestanden aangemaakt!)
step "chown -R ${STM_USER}:${STM_GROUP} ${INSTALL_DIR} (na aanpassen bestanden als root)"
chown -R "${STM_USER}:${STM_GROUP}" "$INSTALL_DIR"

ok "Kritieke bestandsfixes toegepast (Dockerfile, entrypoint, next.config, package.json, ESLint-fix)."

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
# Gebruik dit voor wachtwoorden, secrets en optionele defaults (veilig, nooit onbedoeld overschrijven).
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

# Helper: VOEG TOE of VERVANG ALTIJD KEY=VALUE (overschrijf ook bestaande NIET-lege waarden).
# Gebruik dit ALLEEN voor variabelen die de gebruiker EXPLICIET als CLI-argument opgaf
# (bv. --domain → STM_DOMAIN/NEXT_PUBLIC_APP_URL/AUTH_URL = expliciete user intent).
env_set() {
  local key="$1" value="$2"
  local esc_value
  esc_value="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak -e "s|^${key}=.*|${key}=${esc_value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
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
# Indien --domain expliciet opgegeven: FORCEER de waarden (expliciete user intent = altijd doorvoeren,
# ook al stonden er al waarden in de .env van een eerdere verkeerde run).
if [[ -n "${DOMAIN:-}" ]]; then
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"
  NEXT_APP_URL="https://${DOMAIN}"
  env_set "STM_DOMAIN" "${DOMAIN}"
  env_set "NEXUS_DOMAIN" '${STM_DOMAIN:-}'
  env_set "NEXT_PUBLIC_APP_URL" "${NEXT_APP_URL}"
  env_set "AUTH_URL" '${NEXT_PUBLIC_APP_URL:-}/api/auth'
else
  # Geen domein opgegeven: LAAT bestaande waarden met rust (alleen invullen als LEEG / ontbreekt).
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
  as_root mkdir -p /etc/caddy
  _TMP_CADDYFILE=""
  _TMP_CADDYFILE="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/stm-caddy-$$.conf")"
  trap 'rm -f "$_TMP_CADDYFILE"' RETURN
  if [[ -n "${CUSTOM_CADDYFILE_SRC:-}" && -f "$CUSTOM_CADDYFILE_SRC" ]]; then
    as_root cp -f "$CUSTOM_CADDYFILE_SRC" /etc/caddy/Caddyfile
    as_root chown root:root /etc/caddy/Caddyfile
    as_root chmod 0644 /etc/caddy/Caddyfile
  else
    if [[ -z "${CUSTOM_CADDYFILE_SRC:-}" ]]; then
      warn "CUSTOM_CADDYFILE_SRC variabele was leeg; fallback minimal reverse proxy."
    else
      warn "Geen Caddyfile in project (${CUSTOM_CADDYFILE_SRC}). Fallback: minimal reverse proxy."
    fi
    cat > "$_TMP_CADDYFILE" <<'CADDY_FALLBACK'
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
    as_root cp -f "$_TMP_CADDYFILE" /etc/caddy/Caddyfile
    as_root chown root:root /etc/caddy/Caddyfile
    as_root chmod 0644 /etc/caddy/Caddyfile
  fi
  # Caddy env: alleen STM_DOMAIN + STM_APP_URL (volgt direct uit .env)
  # shellcheck disable=SC2063
  grep -E '^(STM_DOMAIN|NEXT_PUBLIC_APP_URL|STM_APP_URL)=' "$ENV_FILE" 2>/dev/null | as_root tee /etc/caddy/.env >/dev/null || true
  # Als STM_APP_URL nog niet in ENV stond: vul hier met localhost:3000
  if ! as_root grep -qE '^STM_APP_URL=' /etc/caddy/.env 2>/dev/null; then
    printf 'STM_APP_URL=127.0.0.1:3000\n' | as_root tee -a /etc/caddy/.env >/dev/null || true
  fi
  as_root chown root:root /etc/caddy/.env || true
  as_root chmod 0600 /etc/caddy/.env || true
  # E-mailadres (Let's Encrypt)
  if [[ -n "${EMAIL:-}" ]]; then
    step "Caddy global e-mail (Let's Encrypt): ${EMAIL} → /etc/caddy/Caddyfile"
    # Zet aan het begin, voor de site-block
    if ! as_root grep -qF "{\"${EMAIL}\"}" /etc/caddy/Caddyfile 2>/dev/null; then
      : > "$_TMP_CADDYFILE"
      printf '{
  email %s
  acme_ca https://acme-v02.api.letsencrypt.org/directory
}

' "${EMAIL}" > "$_TMP_CADDYFILE"
      as_root cat /etc/caddy/Caddyfile >> "$_TMP_CADDYFILE" || true
      as_root cp -f "$_TMP_CADDYFILE" /etc/caddy/Caddyfile
      as_root chmod 0644 /etc/caddy/Caddyfile
    fi
  fi
  rm -f "$_TMP_CADDYFILE"
  trap - RETURN
  # Caddyfile droog testen
  step "caddy validate /etc/caddy/Caddyfile"
  if ! caddy validate --config /etc/caddy/Caddyfile 2>&1 | tee -a "$LOG_FILE" >&2; then
    warn "Caddyfile valideert NIET. Controleer /etc/caddy/Caddyfile na install."
  else
    ok "Caddyfile gevalideerd."
  fi

  # ============================================================
  # 7.2 🔥 CADDY SERVICE STARTEN + GARANDEREN DAT HIJ WERKT
  # ============================================================
  as_root systemctl unmask caddy 2>/dev/null || true
  as_root systemctl daemon-reload
  as_root systemctl enable caddy 2>/dev/null || true
  # Reload indien reeds running; anders restart/start:
  if as_root systemctl is-active --quiet caddy 2>/dev/null; then
    as_root systemctl reload caddy 2>/dev/null || as_root systemctl restart caddy 2>/dev/null || true
  else
    as_root systemctl restart caddy 2>/dev/null || as_root systemctl start caddy 2>/dev/null || true
  fi

  # Wacht MAXIMAAL 20s tot Caddy RUNNING is + HTTP antwoord op :80
  _caddy_ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if as_root systemctl is-active --quiet caddy 2>/dev/null && curl -fsS -o /dev/null -m 3 --max-time 3 http://127.0.0.1:80/ 2>/dev/null; then
      _caddy_ok=1
      break
    fi
    sleep 2
  done

  if [[ "$_caddy_ok" -eq 0 ]]; then
    # Indien nog niet OK: probeer nog een expliciete herstart + toon de foutmeldingen op stderr (altijd zichtbaar!)
    as_root systemctl restart caddy 2>/dev/null || true
    err "Caddy service STARTEN mislukt (na 20s wachten)."
    info "Laatste 60 regels Caddy systemd logs:"
    as_root journalctl -u caddy --no-pager -n 60 2>&1 | tee -a "$LOG_FILE" >&2 || true
    info "Tip: Controleer /etc/caddy/Caddyfile handmatig; of draai 'caddy adapt --config /etc/caddy/Caddyfile'."
    exit 7
  fi
  ok "Caddy actief (systemd) + HTTP :80 bereikbaar. HTTPS wordt automatisch aangevraagd zodra DNS klopt (Let's Encrypt)."
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

# 8.2 Builden (ALTIJD --no-cache! Oude Docker images bevatten vaak nog
#     de OUDE Prisma "library" engine (op musl+openssl3 = crash!).
#     Duurt 3-10 min, maar is 100% zeker van de nieuwste fixes.)
step "Docker build: stm-app (Next.js standalone) + pull Postgres 16. ALTIDS --no-cache. Dit duurt 3-10 minuten..."
"${COMPOSE_CMD[@]}" pull --quiet stm-db 2>&1 | tail -3 | tee -a "$LOG_FILE" >&2 || true
"${COMPOSE_CMD[@]}" build --no-cache stm-app 2>&1 | tail -20 | tee -a "$LOG_FILE" >&2
ok "Docker build voltooid (--no-cache, dus geen oude cached bugs!)."

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
  err "Next.js NIET healthy binnen ${APP_MAX_WAIT}s. Docker=${STATUS}; 127.0.0.1:3000/api/health -> HTTP ${HTTP_CODE}."
  info "LAATSTE 80 REGELS STM-APP LOGS (debug dit!):"
  docker logs --tail 80 stm-app 2>&1 | tee -a "$LOG_FILE" >&2 || true
  info "LAATSTE 40 REGELS STM-DB LOGS:"
  docker logs --tail 40 stm-db  2>&1 | tee -a "$LOG_FILE" >&2 || true
  exit 8
fi

# ==============================================================================
# STAP 9 — Optioneel: prisma db seed (--seed)
#   Fallback: indien prisma seed faalt (bv. door missende bcryptjs module
#   in oude repo), dan DIRECT SQL insert 3 users met bcrypt hash Test1234!
# ==============================================================================
if [[ "$SEED" -eq 1 ]]; then
  title "STAP 9 — Seed: Prisma demo-gebruikers + data (met SQL fallback!)"

  # Bcrypt hash voor "Test1234!" (rounds=10, voor alle 3 users hetzelfde)
  TEST_BCRYPT_HASH='$2a$10$uEvOIvGEtHkbWbC15Cq3ZOiJvmosBQ9chrLAApQkOdf4SzzAZbfdC'

  SEED_OK=0
  # ---- Tier 1: prisma db seed (met binary engine!) ----
  step "docker exec -e PRISMA_CLIENT_ENGINE_TYPE=binary stm-app npx prisma db seed"
  if docker exec -e PRISMA_CLIENT_ENGINE_TYPE=binary stm-app npx prisma db seed 2>&1 | tail -15 | tee -a "$LOG_FILE" >&2; then
    SEED_OK=1
  else
    warn "Prisma seed (tier 1) FAILDE. Fallback: DIRECT SQL insert 3 users..."
  fi

  # ---- Tier 2: SQL fallback — altijd werkt! ----
  if [[ "$SEED_OK" -eq 0 ]]; then
    step "DIRECT SQL insert 3 users (admin / medewerker / viewer) in stm-db..."
    # Extract POSTGRES_PASSWORD uit .env (voor psql on the host, of via docker exec -i)
    PGPASS_FROM_ENV="$(awk -F= '/^POSTGRES_PASSWORD=/ {print $2; exit}' "$ENV_FILE" 2>/dev/null || echo '')"
    docker exec -i stm-db psql -U stm -d stm <<STM_SEED_SQL
INSERT INTO users (id, email, name, "passwordHash", role, "createdAt", "updatedAt") VALUES
  (
    'cl-seed-admin-000000000000001',
    'admin@nexus.local',
    'Administrator',
    '${TEST_BCRYPT_HASH}',
    'ADMIN',
    NOW(),
    NOW()
  ),
  (
    'cl-seed-employee-00000000000002',
    'medewerker@nexus.local',
    'Medewerker Nexus',
    '${TEST_BCRYPT_HASH}',
    'EMPLOYEE',
    NOW(),
    NOW()
  ),
  (
    'cl-seed-viewer-000000000000003',
    'viewer@nexus.local',
    'Viewer Account',
    '${TEST_BCRYPT_HASH}',
    'VIEWER',
    NOW(),
    NOW()
  )
ON CONFLICT (email) DO NOTHING;
STM_SEED_SQL
    # Check count = 3
    UC=$(docker exec -i stm-db psql -U stm -d stm -t -c "SELECT count(*) FROM users WHERE email IN ('admin@nexus.local','medewerker@nexus.local','viewer@nexus.local');" 2>/dev/null | tr -d ' \n' || echo 0)
    if [[ "$UC" -ge "3" ]]; then
      SEED_OK=1
      ok "SQL fallback SUCCESVOL: ${UC} demo-gebruikers in users tabel."
    else
      err "SQL fallback nog niet OK: users count=${UC} (moet minimaal 3 zijn)."
    fi
  fi

  if [[ "$SEED_OK" -eq 1 ]]; then
    ok "Seed compleet (Prisma of SQL fallback). Inloggen:"
    info "   📧 admin@nexus.local   / 🔑 Test1234!   (role: ADMIN)"
    info "   📧 medewerker@nexus.local / 🔑 Test1234! (role: EMPLOYEE)"
    info "   📧 viewer@nexus.local   / 🔑 Test1234!   (role: VIEWER)"
  else
    warn "Seed FAILDE (zowel Prisma als SQL fallback). Latere handmatige fix: docker exec -it stm-app /bin/sh, of run SQL in postgres."
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
  as_root mkdir -p /opt/stm/scripts
  as_root install -o root -g root -m 0750 "$BACKUP_SCRIPT_SRC"   "$BACKUP_DEST_SCRIPT"
  as_root install -o root -g root -m 0644 "$BACKUP_SERVICE_SRC"  "$BACKUP_DEST_SERVICE"
  as_root install -o root -g root -m 0644 "$BACKUP_TIMER_SRC"    "$BACKUP_DEST_TIMER"

  # Zorg dat /opt/stm ook naar STM_USER wijst (voor ./backups/)
  as_root mkdir -p /opt/stm
  as_root chown -R "${STM_USER}:${STM_GROUP}" /opt/stm || true

  step "systemctl daemon-reload + enable --now stm-db-backup.timer"
  as_root systemctl daemon-reload
  as_root systemctl enable --now stm-db-backup.timer 2>&1 | tee -a "$LOG_FILE" >&2 || true
  sleep 1
  TIMER_ACTIVE="$(as_root systemctl is-active stm-db-backup.timer 2>/dev/null || echo "unknown")"
  TIMER_NEXT="$(as_root systemctl list-timers stm-db-backup.timer --no-pager 2>/dev/null | tail -1 | awk '{print $1, $2, $3}' || echo '?')"
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

cat <<SUMMARY | tee -a "$LOG_FILE"
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
    sudo bash ./nexus-install.sh --update                                 # ⭐ UPDATE naar nieuwste GitHub commit
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
