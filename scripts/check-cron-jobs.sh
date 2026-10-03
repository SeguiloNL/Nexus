#!/usr/bin/env bash
# ============================================================
# STM — Cron/systemd TIMER controlescript (wekelijks of handmatig)
#
# Doel:
#   1) Controleert of alle STM systemd timers ACTIVE+ENABLED zijn
#   2) Controleert of de JUISTE schedule (OnCalendar) is ingesteld
#   3) Controleert of alle onderliggende .sh scripts bestaan + uitvoerbaar zijn
#   4) Controleert logboeken / journalctl op recente fouten
#   5) Optioneel: Voert een DRY-RUN uit van alle scripts (--dry-run)
#   6) Optioneel: Exporteert een cron-snapshot als backup
#
# Gebruik:
#   sudo bash /opt/stm/scripts/check-cron-jobs.sh
#   sudo bash /opt/stm/scripts/check-cron-jobs.sh --dry-run
#   sudo bash /opt/stm/scripts/check-cron-jobs.sh --backup
# ============================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/stm}"
DRY_RUN=0
BACKUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --backup)  BACKUP=1; shift ;;
    -h|--help) echo "Gebruik: sudo bash $0 [--dry-run] [--backup]"; exit 0 ;;
    *) echo "Onbekende optie: $1" >&2; exit 2 ;;
  esac
done

STM_TIMERS=(
  "stm-db-backup.timer"
  "stm-simhuis-usage-sync.timer"
  "stm-simhuis-sims-sync.timer"
  "stm-inserve-sync.timer"
  "stm-cleanup.timer"
  "stm-healthcheck.timer"
)

# Elke timer -> verwachte scripts en service
declare -A TIMER_SCRIPT
TIMER_SCRIPT[stm-db-backup.timer]="${INSTALL_DIR}/scripts/backup-stm-db.sh"
TIMER_SCRIPT[stm-simhuis-usage-sync.timer]="${INSTALL_DIR}/scripts/sync-simhuis-usage.sh"
TIMER_SCRIPT[stm-simhuis-sims-sync.timer]="${INSTALL_DIR}/scripts/sync-simhuis-sims.sh"
TIMER_SCRIPT[stm-inserve-sync.timer]="${INSTALL_DIR}/scripts/sync-inserve-invoices.sh"
TIMER_SCRIPT[stm-cleanup.timer]="${INSTALL_DIR}/scripts/cleanup-stm.sh"
TIMER_SCRIPT[stm-healthcheck.timer]="${INSTALL_DIR}/scripts/health-check-stm.sh"

OK=0
WARN=0
FAIL=0

hdr()  { printf '\n\e[1m─── %s ───\e[0m\n' "$*"; }
ok()   { OK=$((OK+1));   printf '  \e[32m✔\e[0m %s\n' "$*"; }
warn() { WARN=$((WARN+1)); printf '  \e[33m⚠\e[0m %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); printf '  \e[31m✖\e[0m %s\n' "$*"; }

hdr "STM Cron/Timer statuscontrole — $(date '+%Y-%m-%d %H:%M:%S')"
echo "Install dir: ${INSTALL_DIR}"
echo ""

# 1) Alle timers controleren
hdr "STAP 1/5 — Systemd timers actief + enabled?"
if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemctl NIET gevonden. Dit script vereist Ubuntu 22.04/24.04 met systemd."
else
  for T in "${STM_TIMERS[@]}"; do
    if systemctl list-unit-files "${T}" >/dev/null 2>&1; then
      ENABLED=$(systemctl is-enabled "${T}" 2>/dev/null || echo "not-installed")
      ACTIVE=$(systemctl is-active "${T}" 2>/dev/null || echo "inactive")
      NEXT=$(systemctl list-timers "${T}" --no-pager 2>/dev/null | awk 'NR==2 {print $1, $2, $3}' || echo "?")
      if [[ "${ENABLED}" == "enabled" && "${ACTIVE}" == "active" ]]; then
        ok "TIMER ${T}  (enabled=${ENABLED}, active=${ACTIVE}, volgende: ${NEXT})"
      else
        fail "TIMER ${T}  (enabled=${ENABLED}, active=${ACTIVE})"
      fi
      # schedule
      ONCAL=$(systemctl show -p TimersCalendar "${T}" 2>/dev/null | cut -d= -f2- || echo "")
      [[ -n "${ONCAL}" ]] && echo "         schedule: ${ONCAL}" || true
    else
      fail "TIMER ${T} NIET GEÏNSTALLEERD (draai eerst: sudo bash ${INSTALL_DIR}/nexus-install.sh --setcronjobs)"
    fi
  done
fi

# 2) Scripts bestaan en executable
hdr "STAP 2/5 — Onderliggende scripts aanwezig + uitvoerbaar?"
for T in "${STM_TIMERS[@]}"; do
  SCRIPT="${TIMER_SCRIPT[${T}]:-}"
  [[ -z "${SCRIPT}" ]] && continue
  if [[ -f "${SCRIPT}" ]]; then
    if [[ -x "${SCRIPT}" ]]; then
      ok "SCRIPT ${SCRIPT} aanwezig en uitvoerbaar"
    else
      fail "SCRIPT ${SCRIPT} NIET uitvoerbaar (chmod +x nodig)"
    fi
  else
    fail "SCRIPT ${SCRIPT} ONTBREEKT!"
  fi
done

# 3) Recente fouten in journal
hdr "STAP 3/5 — Journalctl: fouten in de laatste 24 uur per service?"
if command -v journalctl >/dev/null 2>&1; then
  for T in "${STM_TIMERS[@]}"; do
    SVC="${T%.timer}.service"
    RAW_ERR=$(journalctl -u "${SVC}" --since "24 hours ago" -p warning --no-pager 2>/dev/null || true)
    # Filter false positives:
    #   - Regels die eindigen op: "[ OK ] ..." (healthcheck script progress op stderr)
    #   - "Warning: some journal files were not opened due to insufficient permissions"
    #   - "-- No entries --"
    #   - "systemd[1]: Starting STM ..."
    #   - "systemd[1]: Finished STM ..."
    #   - "systemd[1]: stm-*.service: Deactivated successfully."
    # Alleen echte fouten tellen: Failed/ERROR/Exception/Panic/failed/mislukt/Error/exit-code 1/2/HTTP 5/HTTP 40/401/403/Can't/No such
    FILTERED_ERR=$(printf '%s\n' "${RAW_ERR}" | grep -vE '^\s*$|^\s*--.*--\s*$|journal files were not opened|\[ OK \]|systemd\[1\]: (Starting|Finished|Consumed)|Deactivated successfully' || true)
    FAILED_LINES=0
    if [[ -n "${FILTERED_ERR}" ]]; then
      FAILED_LINES=$(printf '%s\n' "${FILTERED_ERR}" | grep -cE 'Fail|fail|mislukt|Error|ERROR|Exception|panic|exit[- ]?code|HTTP [45][0-9]{2}|Can'\''t|No such|unreachable|not found|timed?[ -]?out' || true)
    fi
    LAST_STATUS=$(journalctl -u "${SVC}" -o short-iso -n 10 --no-pager 2>/dev/null \
      | grep -vE '^\s*$|journal files were not opened' \
      | tail -1 || echo "")
    if [[ "${FAILED_LINES}" -eq 0 ]]; then
      ok "SERVICE ${SVC}: geen echte fouten de laatste 24 uur"
    else
      warn "SERVICE ${SVC}: ${FAILED_LINES} echte fout-regels in journal de laatste 24 uur"
      echo "         laatste status-regel: ${LAST_STATUS}"
      echo "         (Tip: debug met: sudo journalctl -u ${SVC} -n 100 --no-pager)"
    fi
  done
else
  warn "journalctl NIET gevonden; logcontrole overgeslagen."
fi

# 4) Mapstructuur logs/backups
hdr "STAP 4/5 — Log/backup mappen aanwezig + schrijfbaar?"
REQUIRED_DIRS=(
  "/var/log/stm-install"
  "${INSTALL_DIR}/backups"
  "${INSTALL_DIR}/backups/daily"
  "${INSTALL_DIR}/backups/weekly"
  "${INSTALL_DIR}/backups/monthly"
)
CREATED_ANY=0
for D in "${REQUIRED_DIRS[@]}"; do
  if [[ ! -d "${D}" ]]; then
    if mkdir -p "${D}" 2>/dev/null; then
      CREATED_ANY=1
      ok "MAP ${D} AANGEMAAKT (ontbrak en is nu hersteld)."
    else
      warn "MAP ${D} ONTBREEKT en kon NIET aangemaakt worden (sudo nodig?)."
    fi
  fi
  if [[ -d "${D}" ]]; then
    if [[ -w "${D}" ]]; then
      ok "MAP ${D} aanwezig en schrijfbaar"
    else
      warn "MAP ${D} aanwezig maar NIET schrijfbaar voor $(whoami)."
    fi
  fi
done
[[ "${CREATED_ANY}" -eq 1 ]] && echo "         (Backups-structuur was leeg; nu aangelegd.)"

# 5) Optioneel Dry-run (elke script --help of exit 0 call, GEEN echte sync)
if [[ "${DRY_RUN}" -eq 1 ]]; then
  hdr "STAP 5/5 — DRY-RUN: scripts syntax controleren (bash -n)"
  for T in "${STM_TIMERS[@]}"; do
    SCRIPT="${TIMER_SCRIPT[${T}]:-}"
    [[ -z "${SCRIPT}" || ! -f "${SCRIPT}" ]] && continue
    if bash -n "${SCRIPT}" 2>/dev/null; then
      ok "SYNTAX OK: ${SCRIPT}"
    else
      fail "SYNTAX FOUT in ${SCRIPT} (bash -n gefaald)"
    fi
  done
else
  hdr "STAP 5/5 — (DRY-RUN overgeslagen; gebruik --dry-run om syntax te checken)"
fi

# Optioneel: backup van crontab + timers
if [[ "${BACKUP}" -eq 1 ]]; then
  hdr "EXTRA: Backup maken van systemd timers + root crontab"
  BDIR="${INSTALL_DIR}/backups/cron-backup-$(date '+%Y%m%d-%H%M%S')"
  mkdir -p "${BDIR}"
  ( command -v crontab >/dev/null 2>&1 && crontab -l -u root 2>/dev/null || echo "(geen root crontab)" ) > "${BDIR}/root-crontab.txt" 2>/dev/null || true
  for T in "${STM_TIMERS[@]}"; do
    SVC="${T%.timer}.service"
    ( systemctl cat "${T}"   2>/dev/null || echo "(timer ${T} niet gevonden)" ) > "${BDIR}/${T}"   2>/dev/null || true
    ( systemctl cat "${SVC}" 2>/dev/null || echo "(service ${SVC} niet gevonden)" ) > "${BDIR}/${SVC}" 2>/dev/null || true
  done
  ok "Backups geschreven naar: ${BDIR}"
  chmod -R 0640 "${BDIR}" 2>/dev/null || true
fi

# Summary
hdr "SAMENVATTING"
printf '  OK:   %s\n' "${OK}"
printf '  WARN: %s\n' "${WARN}"
printf '  FAIL: %s\n' "${FAIL}"
echo ""
if [[ "${FAIL}" -eq 0 ]]; then
  printf '\e[1;32m  ✅  Alle CRON/timer processen correct geconfigureerd.\e[0m\n'
  exit 0
else
  printf '\e[1;33m  ⚠  %s fouten geconstateerd.\e[0m\n' "${FAIL}"
  echo   "   • Herstel de fouten en her-run: sudo bash ${INSTALL_DIR}/scripts/check-cron-jobs.sh"
  echo   "   • Nieuwe installatie?   sudo bash ${INSTALL_DIR}/nexus-install.sh --setcronjobs"
  exit 3
fi
