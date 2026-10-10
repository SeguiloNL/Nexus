/**
 * Lightweight in-memory registry for real-time sync progress.
 *
 * Design goals:
 *  - Zero DB writes for intermediate progress (no migration needed).
 *  - Max ~32 progress events per Inserve import run (12 step boundaries +
 *    max 20 sub-percent updates for processRecords) → tiny network cost.
 *  - Automatic cleanup (TTL + size cap) so it never leaks memory across runs.
 *  - Safe to import from both server (route handlers, services) and client
 *    components (type-only). No side effects on import except a single
 *    singleton cleanup timer (started lazily, 1 interval per process).
 *
 * Exports:
 *   - Type exports `SyncStepStatus`, `SyncProgressStep`, `SyncProgressState`,
 *     `ImportManagementStatus` (shared browser / node union).
 *   - `STEPS_INSERVE_CUSTOMER_IMPORT` — step definitions used by the engine.
 *   - State mutations: `initProgress / setStepActive / setStepSubPercent /
 *     setStepDone / setStepFailed / setStepSkipped / finalizeProgress`.
 *   - Queries: `getCurrentState`, `subscribe(runId, listener) => unsubscribe`.
 *
 * All setters are idempotent and safe to call without `initProgress` first
 * (they create a minimal state if missing, so progress won't crash the main
 * sync run if `initProgress` was skipped).
 */

import type { ImportSummary } from "@/server/services/inserve-customer-import.service";

export type SyncStepStatus =
  | "PENDING"
  | "ACTIVE"
  | "DONE"
  | "FAILED"
  | "SKIPPED";

export interface SyncProgressStep {
  /** 0-based step index; matches `SyncProgressState.currentStepIdx`. */
  idx: number;
  /** Short title (shown in step list). */
  title: string;
  /** Human readable description (1 line). Can change while ACTIVE via detail. */
  description: string;
  status: SyncStepStatus;
  /** ISO date when step transitioned to ACTIVE. */
  startedAt?: string;
  /** ISO date when step transitioned out of ACTIVE. */
  endedAt?: string;
  durationMs?: number;
  /** Present if status === "FAILED". Single sentence. */
  error?: string;
  /** Extra debug info; optional. Keep small (<1kB) to avoid SSE bloat. */
  errorDetail?: unknown;
  /** Arbitrary step-specific counters (pages, records fetched, etc). */
  detail?: Record<string, unknown>;
}

export type SyncOverallStatus =
  | "PENDING"
  | "RUNNING"
  | "PARTIAL_SUCCESS"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED";

export interface SyncProgressState {
  runId: string;
  /** Matches `steps.length`. */
  totalSteps: number;
  /** 0-based. `-1` if no step started yet (pre-init RUNNING state). */
  currentStepIdx: number;
  /** 0..100 integer. Combined step-percent + sub-percent of the active step. */
  percent: number;
  steps: SyncProgressStep[];
  startedAt: string;
  endedAt?: string;
  overallStatus: SyncOverallStatus;
  /** Errors aggregated (also present per step if FAILED). */
  errors: string[];
  /** Populated only on the final `finalized` SSE event / finalized state. */
  finalSummary?: ImportSummary;
}

/** Human-readable 12-step plan for the Inserve customer import sync. */
export const STEPS_INSERVE_CUSTOMER_IMPORT: ReadonlyArray<Omit<SyncProgressStep, "status">> = Object.freeze([
  {
    idx: 0,
    title: "Rechten en gebruikers-scope controleren",
    description: "Controleren of de ingelogde gebruiker toestemming heeft en tot de interne scope behoort.",
  },
  {
    idx: 1,
    title: "Inserve API configuratie valideren",
    description: "Controleren of de Inserve subdomein en API-key juist zijn ingesteld (uit DB of omgevingsvariabelen).",
  },
  {
    idx: 2,
    title: "Mutex controleren",
    description: "Controleren of er niet reeds een andere Inserve klantimport bezig is (10-min venster).",
  },
  {
    idx: 3,
    title: "Synchronisatie-run aanmaken",
    description: "SyncJobRun aanmaken in de database zodat de run ook achteraf terug te vinden is.",
  },
  {
    idx: 4,
    title: "Bedrijven ophalen uit Inserve",
    description: "Gepagineerd alle bedrijven met custom values uit Inserve inladen.",
  },
  {
    idx: 5,
    title: "Pre-scan Nexus-vrij veld",
    description: "Per bedrijf bepalen of het in scope valt voor Nexus-import (Nexus=Actief) en of contactpersonen opgehaald moeten worden.",
  },
  {
    idx: 6,
    title: "Contactpersonen ophalen",
    description: "Alleen voor Nexus=Actief bedrijven de bijbehorende contactpersonen uit Inserve laden (rate limit beveiligd).",
  },
  {
    idx: 7,
    title: "Bestaande Nexus-klanten inladen",
    description: "Reeds gekoppelde Nexus-klanten en Inserve-koppelingen inladen zodat updates plaatsvinden in plaats van duplicaten.",
  },
  {
    idx: 8,
    title: "Bedrijven verwerken (CRUD)",
    description: "Alle bedrijven doorlopen: aanmaken, bijwerken, ongewijzigd, deactiveren of heractiveren inclusief bijbehorende contactpersonen.",
  },
  {
    idx: 9,
    title: "Mogelijke ongekppelde matches zoeken",
    description: "Na de CRUD-pass zoeken naar potentiele matches die niet automatisch gekoppeld konden worden (handmatige beoordeling).",
  },
  {
    idx: 10,
    title: "SIM-actief-klant koppeling",
    description: "Inserve SIM-actief-asset-koppeling uitvoeren indien ingeschakeld.",
  },
  {
    idx: 11,
    title: "Afronden en samenstellen rapport",
    description: "Auditlog schrijven, SyncJobRun status afwerken en het eindrapport samenstellen.",
  },
]);

// ------------------------ Singleton state storage --------------------------

type Listener = (nextState: SyncProgressState) => void;

interface RunEntry {
  state: SyncProgressState;
  listeners: Set<Listener>;
  /** ISO string; cleanup reference for finalized runs. */
  lastTouched: string;
}

const STORAGE = new Map<string, RunEntry>();
const MAX_RUNS = 100;
const CLEANUP_INTERVAL_MS = 10_000;
const TTL_AFTER_FINALIZE_MS = 60 * 60 * 1000; // 60 minutes
const TTL_ABANDONED_RUNNING_MS = 45 * 60 * 1000; // 45 minutes

let cleanupStarted = false;
function ensureCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  try {
    // setInterval is a Web API in browser, but this file also gets imported by
    // the browser for types only. The runtime block below only runs on the
    // server. Use typeof guard to prevent bundler errors on the client.
    if (typeof setInterval !== "undefined") {
      setInterval(runCleanup, CLEANUP_INTERVAL_MS).unref?.();
    }
  } catch {
    /* ignore */
  }
}

function runCleanup() {
  const now = Date.now();
  for (const [runId, entry] of STORAGE.entries()) {
    const age = now - new Date(entry.lastTouched).getTime();
    const finished =
      entry.state.overallStatus === "SUCCESS" ||
      entry.state.overallStatus === "PARTIAL_SUCCESS" ||
      entry.state.overallStatus === "FAILED" ||
      entry.state.overallStatus === "SKIPPED";
    if (
      (finished && age > TTL_AFTER_FINALIZE_MS) ||
      (!finished && age > TTL_ABANDONED_RUNNING_MS)
    ) {
      entry.listeners.clear();
      STORAGE.delete(runId);
    }
  }
  // LRU size cap: if still > MAX_RUNS evict oldest finalized ones, then oldest
  // by lastTouched.
  if (STORAGE.size > MAX_RUNS) {
    const sorted = Array.from(STORAGE.entries()).sort(
      (a, b) => new Date(a[1].lastTouched).getTime() - new Date(b[1].lastTouched).getTime()
    );
    let toRemove = STORAGE.size - MAX_RUNS;
    for (const [rid, entry] of sorted) {
      if (toRemove <= 0) break;
      entry.listeners.clear();
      STORAGE.delete(rid);
      toRemove--;
    }
  }
}

function cloneState(s: SyncProgressState): SyncProgressState {
  // Cheap structural clone that survives JSON round-tripping through SSE.
  // ImportSummary within finalSummary is always JSON-serialisable by design.
  return {
    ...s,
    steps: s.steps.map((st) => ({ ...st })),
    errors: s.errors.slice(),
    finalSummary: s.finalSummary === undefined ? undefined : structuredCloneSafe(s.finalSummary),
  };
}

function structuredCloneSafe<T>(v: T): T {
  try {
    if (typeof (globalThis as any).structuredClone === "function") {
      return (globalThis as any).structuredClone(v);
    }
  } catch {
    /* fallthrough */
  }
  // JSON fallback for Node < 17 / edge runtimes without structuredClone.
  return JSON.parse(JSON.stringify(v));
}

function touch(runId: string) {
  const entry = STORAGE.get(runId);
  if (entry) entry.lastTouched = new Date().toISOString();
}

function emit(runId: string) {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  entry.lastTouched = new Date().toISOString();
  // Clone once per emission; every listener receives the same snapshot to
  // guarantee they can't mutate each other's data (prevents cross-tab /
  // cross-request bugs).
  const snapshot = cloneState(entry.state);
  for (const listener of entry.listeners) {
    try {
      listener(snapshot);
    } catch {
      /* swallow: listeners must not crash the sync engine */
    }
  }
}

// ---------------------------- Public API -----------------------------------

export function getCurrentState(runId: string): SyncProgressState | null {
  const entry = STORAGE.get(runId);
  return entry ? cloneState(entry.state) : null;
}

export function hasState(runId: string): boolean {
  return STORAGE.has(runId);
}

/**
 * Initialize progress state for a run. Idempotent: if a state already exists
 * it is preserved (to avoid losing partial progress when a call-site
 * re-initialises). Typically called right after creating the SyncJobRun.
 */
export function initProgress(
  runId: string,
  stepsDef: ReadonlyArray<Omit<SyncProgressStep, "status">> = STEPS_INSERVE_CUSTOMER_IMPORT
): SyncProgressState {
  ensureCleanup();
  const existing = STORAGE.get(runId);
  if (existing) {
    return cloneState(existing.state);
  }
  const startedAt = new Date().toISOString();
  const steps: SyncProgressStep[] = stepsDef.map((s) => ({
    ...s,
    status: "PENDING",
  }));
  const state: SyncProgressState = {
    runId,
    totalSteps: steps.length,
    currentStepIdx: -1,
    percent: 0,
    steps,
    startedAt,
    overallStatus: "RUNNING",
    errors: [],
  };
  STORAGE.set(runId, {
    state,
    listeners: new Set(),
    lastTouched: startedAt,
  });
  emit(runId);
  return cloneState(state);
}

export function subscribe(runId: string, listener: Listener): () => void {
  ensureCleanup();
  let entry = STORAGE.get(runId);
  if (!entry) {
    // Allow subscribing before init; create a placeholder PENDING state so
    // the client sees something (avoids CONNECTION_LOST flash).
    const startedAt = new Date().toISOString();
    const steps: SyncProgressStep[] = STEPS_INSERVE_CUSTOMER_IMPORT.map((s) => ({
      ...s,
      status: "PENDING",
    }));
    entry = {
      state: {
        runId,
        totalSteps: steps.length,
        currentStepIdx: -1,
        percent: 0,
        steps,
        startedAt,
        overallStatus: "PENDING",
        errors: [],
      },
      listeners: new Set(),
      lastTouched: startedAt,
    };
    STORAGE.set(runId, entry);
  }
  entry.listeners.add(listener);
  touch(runId);
  // Fire immediately with latest snapshot so SSE streams have a first frame.
  try {
    listener(cloneState(entry.state));
  } catch {
    /* swallow */
  }
  return () => {
    const e = STORAGE.get(runId);
    if (!e) return;
    e.listeners.delete(listener);
    if (e.listeners.size === 0 && isFinalized(e.state)) {
      // Keep state; let TTL evict so late-comers (e.g. re-subscribe after
      // reload) still see final summary for a while.
    }
  };
}

function isFinalized(s: SyncProgressState): boolean {
  return (
    s.overallStatus === "SUCCESS" ||
    s.overallStatus === "PARTIAL_SUCCESS" ||
    s.overallStatus === "FAILED" ||
    s.overallStatus === "SKIPPED"
  );
}

// -------------------------- State mutators ---------------------------------

function recalcPercent(state: SyncProgressState) {
  // Once finalized, do NOT lower percent (finalizeProgress has set it to 100
  // or explicit value, and late replay-calls (setStepDone e.g.) must not
  // overwrite with a possibly lower computed value.
  if (
    state.overallStatus === "SUCCESS" ||
    state.overallStatus === "PARTIAL_SUCCESS" ||
    state.overallStatus === "FAILED" ||
    state.overallStatus === "SKIPPED"
  ) {
    state.percent = Math.max(state.percent, 100);
    return;
  }
  const total = state.totalSteps || 1;
  if (state.currentStepIdx < 0) {
    state.percent = 0;
    return;
  }
  const completedFullSteps = Math.max(0, state.currentStepIdx);
  const base = (completedFullSteps / total) * 100;
  // Step 8 (processRecords) and step 4/6 (big API loops) may report a
  // sub-percent via setStepSubPercent → stored on the step as
  // `detail._subPercent`. Others are assumed 100% complete when DONE.
  const active = state.steps[state.currentStepIdx];
  let sub = 0;
  if (active?.status === "ACTIVE") {
    const v = (active.detail as any)?._subPercent;
    if (typeof v === "number") sub = Math.max(0, Math.min(1, v));
  } else if (active && (active.status === "DONE" || active.status === "SKIPPED" || active.status === "FAILED")) {
    sub = 1;
  }
  const pct = base + (sub / total) * 100;
  state.percent = Math.max(state.percent, Math.max(0, Math.min(100, Math.round(pct))));
}

export function setStepActive(runId: string, idx: number, detail?: Record<string, unknown>): void {
  const entry = STORAGE.get(runId);
  if (!entry) {
    initProgress(runId);
    return setStepActive(runId, idx, detail);
  }
  const step = entry.state.steps[idx];
  if (!step) return;
  // Mark previous step DONE if it was still ACTIVE (caller forgot to close).
  if (
    entry.state.currentStepIdx >= 0 &&
    entry.state.currentStepIdx !== idx &&
    entry.state.steps[entry.state.currentStepIdx]?.status === "ACTIVE"
  ) {
    closeStep(entry.state.steps[entry.state.currentStepIdx]);
  }
  step.status = "ACTIVE";
  step.startedAt = new Date().toISOString();
  step.detail = detail ?? step.detail ?? {};
  if (detail) {
    step.detail = { ...(step.detail ?? {}), ...detail };
    if (detail.description && typeof detail.description === "string") {
      step.description = detail.description;
    }
  }
  entry.state.currentStepIdx = idx;
  entry.state.overallStatus = "RUNNING";
  recalcPercent(entry.state);
  emit(runId);
}

function closeStep(step: SyncProgressStep, finalStatus: SyncStepStatus = "DONE") {
  if (step.status === "ACTIVE" && step.startedAt) {
    step.endedAt = new Date().toISOString();
    step.durationMs = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
  }
  step.status = finalStatus;
}

export function setStepDone(runId: string, idx: number, detail?: Record<string, unknown>): void {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  const step = entry.state.steps[idx];
  if (!step) return;
  closeStep(step, "DONE");
  if (detail) {
    step.detail = { ...(step.detail ?? {}), ...detail };
    if (detail.description && typeof detail.description === "string") {
      step.description = detail.description;
    }
  }
  recalcPercent(entry.state);
  emit(runId);
}

export function setStepSkipped(runId: string, idx: number, reason?: string): void {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  const step = entry.state.steps[idx];
  if (!step) return;
  closeStep(step, "SKIPPED");
  if (reason) step.detail = { ...(step.detail ?? {}), reason };
  recalcPercent(entry.state);
  emit(runId);
}

export function setStepFailed(
  runId: string,
  idx: number,
  error: string,
  errorDetail?: unknown
): void {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  const step = entry.state.steps[idx];
  if (!step) return;
  closeStep(step, "FAILED");
  step.error = error.slice(0, 600);
  if (errorDetail !== undefined) step.errorDetail = errorDetail;
  if (!entry.state.errors.includes(step.error)) {
    entry.state.errors.push(step.error);
  }
  recalcPercent(entry.state);
  emit(runId);
}

/**
 * Update sub-progress of the currently ACTIVE step (or given idx). `sub0_1`
 * must be in the 0..1 range. Used for long-running steps like processRecords
 * so we avoid emitting per-iteration events (max 20 sub-events per run).
 */
export function setStepSubPercent(runId: string, sub0_1: number, idxHint?: number): void {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  const idx = idxHint ?? entry.state.currentStepIdx;
  if (idx < 0) return;
  const step = entry.state.steps[idx];
  if (!step) return;
  const v = Math.max(0, Math.min(1, sub0_1));
  step.detail = { ...(step.detail ?? {}), _subPercent: v };
  recalcPercent(entry.state);
  emit(runId);
}

export function finalizeProgress(
  runId: string,
  finalStatus: Exclude<SyncOverallStatus, "PENDING" | "RUNNING">,
  opts?: { errorMessage?: string; summary?: ImportSummary }
): void {
  const entry = STORAGE.get(runId);
  if (!entry) return;
  // Close any step still ACTIVE.
  for (const step of entry.state.steps) {
    if (step.status === "ACTIVE") closeStep(step, finalStatus === "SUCCESS" || finalStatus === "PARTIAL_SUCCESS" ? "DONE" : "FAILED");
  }
  if (opts?.errorMessage && !entry.state.errors.includes(opts.errorMessage)) {
    entry.state.errors.push(opts.errorMessage.slice(0, 600));
  }
  entry.state.overallStatus = finalStatus;
  entry.state.endedAt = new Date().toISOString();
  entry.state.percent = 100;
  entry.state.currentStepIdx = entry.state.steps.length - 1;
  if (opts?.summary) entry.state.finalSummary = opts.summary;
  emit(runId);
  touch(runId);
}
