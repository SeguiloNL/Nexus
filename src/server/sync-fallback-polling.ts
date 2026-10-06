import { getSchedulerHealth } from "./services/sync-schedule.service";

const INTERVAL_MS = 15 * 60 * 1000; // 15 min
const HEALTH_WINDOW_MS = 30 * 60 * 1000; // 30 min zonder systemd runs = unhealthy

let intervalRef: ReturnType<typeof setInterval> | null = null;
let started = false;

const JOBS: Array<{ id: string; path: string }> = [
  { id: "SIMHUIS_USAGE", path: "/api/integrations/simhuis/sync-usage" },
  { id: "SIMHUIS_USAGE_ALERT_NOTIFY", path: "/api/integrations/simhuis/notify-usage-alerts" },
  { id: "SIMHUIS_SIMS", path: "/api/integrations/simhuis/sync-sims" },
  { id: "INSERVE", path: "/api/integrations/inserve/sync" },
];

function appOrigin(): string {
  return (
    process.env.STM_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://127.0.0.1:3000"
  );
}

async function runFallbackCycle() {
  try {
    const health = await getSchedulerHealth();
    const lastSeen = health.lastRunAt.SYSTEMD_TIMER?.getTime() ?? 0;
    const delta = Date.now() - lastSeen;
    const needFallback = delta > HEALTH_WINDOW_MS;

    if (!needFallback) return;

    const origin = appOrigin();
    const token = (process.env.SIMHUIS_SYNC_API_TOKEN ?? "").trim();
    if (!token) {
      console.warn(
        "[fallback-polling] Geen SIMHUIS_SYNC_API_TOKEN geconfigureerd; fallback cyclus wordt overgeslagen."
      );
      return;
    }

    for (const job of JOBS) {
      try {
        const url = `${origin.replace(/\/+$/, "")}${job.path}`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Sync-Triggered-By": "fallback-polling",
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          console.warn(
            `[fallback-polling] ${job.id} HTTP ${res.status}: ${await res.text()}`
          );
        } else {
          const body = await res.json().catch(() => ({}));
          if ((body as any)?.skipped) {
            console.info(
              `[fallback-polling] ${job.id} skipped (Schedule Guard).`
            );
          } else {
            console.info(
              `[fallback-polling] ${job.id} ok: ${(body as any)?.summary ?? "succes"}`
            );
          }
        }
      } catch (e: any) {
        console.error(
          `[fallback-polling] ${job.id} faalde: ${e?.message ?? String(e)}`
        );
      }
    }
  } catch (e: any) {
    console.error(
      "[fallback-polling] Fout in gezondheidscontrole:",
      e?.message ?? e
    );
  }
}

export function startFallbackPolling(options?: { immediate?: boolean }) {
  if (started) return;
  started = true;
  if (options?.immediate) {
    setTimeout(() => runFallbackCycle(), 5000);
  }
  intervalRef = setInterval(runFallbackCycle, INTERVAL_MS);
  console.info(
    `[fallback-polling] Gestart, interval ${INTERVAL_MS / 60000} min.`
  );
}

export function stopFallbackPolling() {
  if (intervalRef) clearInterval(intervalRef);
  intervalRef = null;
  started = false;
  console.info("[fallback-polling] Gestopt.");
}

export function ensureFallbackPollingStarted() {
  if (typeof window !== "undefined") return; // never in browser
  if (!started) startFallbackPolling({ immediate: true });
}
