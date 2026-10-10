"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  MinusCircle,
  AlertCircle,
  Circle,
  Timer,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  SyncProgressState,
  SyncProgressStep,
  SyncStepStatus,
  SyncOverallStatus,
} from "@/lib/progress/sync-progress-registry";

type InlineAlertVariant = "default" | "destructive" | "warning";

type Props = {
  runId: string;
  onFinalize?: (summary: unknown | null, finalState: SyncProgressState) => void;
  onConnectionLost?: (tries: number) => void;
  autoCloseAfterMs?: number;
  onClose?: () => void;
  className?: string;
};

function InlineAlert({
  variant = "default",
  title,
  description,
  className = "",
}: {
  variant?: InlineAlertVariant;
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  const styles: Record<InlineAlertVariant, string> = {
    default: "border-slate-200 bg-slate-50 text-slate-900",
    destructive: "border-red-200 bg-red-50 text-red-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  const iconColor = variant === "destructive" ? "text-red-600" : variant === "warning" ? "text-amber-600" : "text-slate-600";
  return (
    <div role="alert" className={`rounded-md border p-3 text-sm ${styles[variant]} ${className}`}>
      <div className="flex items-start gap-2">
        <AlertCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0">
          {title ? (
            <h5 className="font-semibold mb-0.5 leading-snug">{title}</h5>
          ) : null}
          <div className="leading-snug [&>p]:leading-snug">{description}</div>
        </div>
      </div>
    </div>
  );
}

function overallBadge(status: SyncOverallStatus | undefined) {
  switch (status) {
    case "RUNNING":
      return <Badge variant="secondary" className="gap-1 bg-sky-50 text-sky-700 border border-sky-200"><Loader2 className="h-3 w-3 animate-spin" />Bezig</Badge>;
    case "PENDING":
      return <Badge variant="outline" className="gap-1 text-slate-600"><Circle className="h-3 w-3" />Wachten</Badge>;
    case "SUCCESS":
      return <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Voltooid</Badge>;
    case "PARTIAL_SUCCESS":
      return <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800"><AlertCircle className="h-3 w-3" />Gedeeltelijk geslaagd</Badge>;
    case "FAILED":
      return <Badge variant="outline" className="gap-1 border-red-300 bg-red-50 text-red-700"><XCircle className="h-3 w-3" />Mislukt</Badge>;
    case "SKIPPED":
      return <Badge variant="outline" className="gap-1 border-slate-300 bg-slate-100 text-slate-700"><MinusCircle className="h-3 w-3" />Overgeslagen</Badge>;
    default:
      return <Badge variant="outline">Onbekend</Badge>;
  }
}

function StepStatusIcon({ status }: { status: SyncStepStatus }) {
  switch (status) {
    case "PENDING":
      return <Circle className="h-5 w-5 text-slate-300 flex-shrink-0" aria-hidden />;
    case "ACTIVE":
      return <Loader2 className="h-5 w-5 animate-spin text-sky-600 flex-shrink-0" aria-hidden />;
    case "DONE":
      return <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" aria-hidden />;
    case "FAILED":
      return <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" aria-hidden />;
    case "SKIPPED":
      return <MinusCircle className="h-5 w-5 text-slate-400 flex-shrink-0" aria-hidden />;
  }
}

function stepRowClass(status: SyncStepStatus): string {
  switch (status) {
    case "ACTIVE":
      return "border border-sky-200 bg-sky-50";
    case "FAILED":
      return "border border-red-200 bg-red-50";
    case "DONE":
      return "border border-transparent bg-transparent";
    case "SKIPPED":
      return "border border-transparent bg-slate-50/50";
    case "PENDING":
    default:
      return "border border-transparent bg-transparent opacity-80";
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ${s}s`;
}

const OVERALL_FINAL: SyncOverallStatus[] = [
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "FAILED",
  "SKIPPED",
];

export function SyncProgress({
  runId,
  onFinalize,
  onConnectionLost,
  autoCloseAfterMs,
  onClose,
  className = "",
}: Props) {
  const [state, setState] = useState<SyncProgressState | null>(null);
  const [connectionLostTries, setConnectionLostTries] = useState(0);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "open" | "lost"
  >("connecting");
  const closedFinalizedRef = useRef(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const clearRetryTimers = useCallback(() => {
    retryTimersRef.current.forEach((t) => clearTimeout(t));
    retryTimersRef.current = [];
  }, []);

  const clearAutoClose = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }, []);

  const closeEventSource = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.close();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
    }
  }, []);

  const attemptOpenSSE = useCallback(
    (tryNum: number) => {
      closeEventSource();
      // SSE url
      const src = new EventSource(`/api/sync/${encodeURIComponent(runId)}/progress`);
      sourceRef.current = src;

      src.addEventListener("progress", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as SyncProgressState;
          setState(data);
          setConnectionState("open");
          setConnectionLostTries(0);
        } catch {
          /* invalid */
        }
      });
      src.addEventListener("finalized", () => {
        // state update volgt via laatste progress event;
      });
      src.addEventListener("error", (_e) => {
        if (state && OVERALL_FINAL.includes(state.overallStatus)) {
          return;
        }
        try {
          src.close();
        } catch {
          /* noop */
        }
        sourceRef.current = null;
        const nextTry = tryNum + 1;
        setConnectionState("lost");
        setConnectionLostTries(nextTry);
        onConnectionLost?.(nextTry);
        // Exponential backoff: 500ms, 2s, 5s, 8s, 12s, dan 15s repeat
        const delays = [500, 2000, 5000, 8000, 12_000];
        const delay = delays[Math.min(nextTry - 1, delays.length - 1)];
        const t = setTimeout(() => attemptOpenSSE(nextTry), delay);
        retryTimersRef.current.push(t);
      });
    },
    [runId, state, closeEventSource, onConnectionLost]
  );

  // initial connect
  useEffect(() => {
    if (!runId) return undefined;
    closedFinalizedRef.current = false;
    attemptOpenSSE(0);
    return () => {
      closeEventSource();
      clearRetryTimers();
      clearAutoClose();
    };
  }, [runId, attemptOpenSSE, closeEventSource, clearRetryTimers, clearAutoClose]);

  // finalize callback + auto-close timer
  useEffect(() => {
    if (!state) return;
    const finalized = OVERALL_FINAL.includes(state.overallStatus);
    if (finalized && !closedFinalizedRef.current) {
      closedFinalizedRef.current = true;
      clearRetryTimers();
      closeEventSource();
      onFinalize?.(state.finalSummary ?? null, state);
      if (autoCloseAfterMs != null && autoCloseAfterMs > 0 && onClose) {
        clearAutoClose();
        autoCloseRef.current = setTimeout(() => onClose(), autoCloseAfterMs);
      }
    }
  }, [state, onFinalize, onClose, autoCloseAfterMs, closeEventSource, clearRetryTimers, clearAutoClose]);

  const fallbackState: SyncProgressState = useMemo(
    () => ({
      runId,
      totalSteps: 12,
      currentStepIdx: 0,
      percent: 0,
      steps: [],
      startedAt: new Date().toISOString(),
      overallStatus: "PENDING",
      errors: [],
    }),
    [runId]
  );
  const displayState: SyncProgressState = state ?? fallbackState;

  const currentTitle = useMemo(() => {
    const s = displayState.steps.find((x) => x.idx === displayState.currentStepIdx);
    return s?.title ?? "Initialiseren…";
  }, [displayState]);

  const currentStepNum = displayState.currentStepIdx + 1;
  const overallPercent = displayState.percent;
  const isFinal = OVERALL_FINAL.includes(displayState.overallStatus);
  const hasErrors = (displayState.errors?.length ?? 0) > 0;

  const reconnectNow = () => {
    clearRetryTimers();
    attemptOpenSSE(0);
  };

  const elapsedMs = useMemo(() => {
    if (!displayState.startedAt) return 0;
    const end = displayState.endedAt ? new Date(displayState.endedAt).getTime() : Date.now();
    const diff = end - new Date(displayState.startedAt).getTime();
    return Number.isFinite(diff) && diff >= 0 ? diff : 0;
  }, [displayState.startedAt, displayState.endedAt]);
  // Re-render tick elke seconde als het proces RUNNING is voor weergave tijdsduur
  const [, setTick] = useState(0);
  useEffect(() => {
    if (isFinal) return undefined;
    const i = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(i);
  }, [isFinal]);

  return (
    <Card className={`w-full ${className}`} aria-live="polite">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle className="text-base md:text-lg font-semibold truncate">
              Synchronisatie voortgang
            </CardTitle>
            {overallBadge(displayState.overallStatus)}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Timer className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">
              {formatDuration(elapsedMs) || "…"}
            </span>
            {runId ? (
              <span className="ml-2 hidden sm:inline text-slate-400 truncate max-w-[12ch]" title={runId}>
                #{runId.slice(0, 8)}
              </span>
            ) : null}
            {connectionState === "lost" && (
              <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 bg-amber-50 ml-2">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Verbindingsverlies {connectionLostTries > 1 ? `(${connectionLostTries})` : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Overall foutmeldingen */}
        {hasErrors && isFinal && (
          <InlineAlert
            variant="destructive"
            title="Er zijn fouten opgetreden tijdens de synchronisatie"
            description={
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                {displayState.errors.slice(0, 3).map((e, i) => (
                  <li key={i} className="break-words">
                    {String(e)}
                  </li>
                ))}
                {displayState.errors.length > 3 && (
                  <li className="text-red-700/80">
                    Nog {displayState.errors.length - 3} fout(en) — zie per stap hieronder.
                  </li>
                )}
              </ul>
            }
          />
        )}

        {connectionState === "lost" && !isFinal && (
          <InlineAlert
            variant="warning"
            title="Verbinding met server is verbroken"
            description={
              <div className="space-y-2">
                <p>
                  Automatisch opnieuw verbinden… Lukt dit niet, klik op
                  handmatig opnieuw verbinden.
                </p>
                <Button size="sm" variant="outline" onClick={reconnectNow}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Opnieuw verbinden
                </Button>
              </div>
            }
          />
        )}

        {/* Huidige stap + grote percent + progress bar */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 md:gap-6 items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge variant="outline" className="gap-1 tabular-nums">
                Stap {currentStepNum} / {displayState.totalSteps}
              </Badge>
              {!isFinal && <StepStatusIcon status="ACTIVE" />}
            </div>
            <p className="font-medium text-slate-900 truncate">{currentTitle}</p>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
              {(() => {
                const s = displayState.steps.find(
                  (x) => x.idx === displayState.currentStepIdx
                );
                return s?.description ?? "";
              })()}
            </p>
          </div>
          <div className="flex items-baseline gap-2 md:justify-end">
            <span className="text-3xl md:text-4xl font-bold tabular-nums text-slate-900 leading-none">
              {Math.min(100, Math.max(0, overallPercent))}
            </span>
            <span className="text-lg font-semibold text-slate-500 leading-none">
              %
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div
          className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.max(0, overallPercent))}
          aria-label="Synchronisatie voortgang"
        >
          <div
            className={
              "h-full rounded-full transition-all duration-700 ease-out " +
              (displayState.overallStatus === "FAILED"
                ? "bg-red-500"
                : displayState.overallStatus === "PARTIAL_SUCCESS"
                  ? "bg-amber-500"
                  : displayState.overallStatus === "SKIPPED"
                    ? "bg-slate-400"
                    : displayState.overallStatus === "SUCCESS"
                      ? "bg-emerald-500"
                      : "bg-blue-600")
            }
            style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
          />
        </div>

        {/* Staplijst */}
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Stappen</h4>
          <div className="max-h-96 overflow-auto border border-slate-200 rounded-md divide-y divide-slate-100 pr-1">
            {displayState.steps.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">
                Initialiseren… (voortgang wordt zo dadelijk zichtbaar)
              </div>
            ) : (
              displayState.steps.map((step) => (
                <StepRow key={step.idx} step={step} />
              ))
            )}
          </div>
        </div>

        {isFinal && onClose && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Sluiten
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: SyncProgressStep }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (step.status !== "ACTIVE") return undefined;
    const i = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(i);
  }, [step.status]);

  const durationMs = step.durationMs != null
    ? step.durationMs
    : step.startedAt && step.status === "ACTIVE"
      ? Date.now() - new Date(step.startedAt).getTime()
      : null;

  const detailText = useMemo(() => {
    if (!step.detail || typeof step.detail !== "object") return null;
    const entries = Object.entries(step.detail as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("_"))
      .slice(0, 5);
    if (entries.length === 0) return null;
    return entries;
  }, [step.detail]);

  return (
    <div className={`p-3 md:p-3.5 rounded-md ${stepRowClass(step.status)}`}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <StepStatusIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className={
                "truncate min-w-0 " +
                (step.status === "ACTIVE" || step.status === "DONE"
                  ? "font-semibold text-slate-900"
                  : step.status === "FAILED"
                    ? "font-semibold text-red-900"
                    : "font-medium text-slate-700")
              }
            >
              <span className="text-slate-400 font-mono text-xs mr-2 tabular-nums">
                {step.idx + 1}.
              </span>
              {step.title}
            </p>
            {durationMs != null && durationMs > 0 ? (
              <span className="text-[11px] md:text-xs text-slate-500 tabular-nums flex-shrink-0">
                {formatDuration(durationMs)}
              </span>
            ) : null}
          </div>
          {step.description ? (
            <p className="mt-0.5 text-xs md:text-sm text-slate-500 line-clamp-2">
              {step.description}
            </p>
          ) : null}
          {detailText ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] md:text-xs text-slate-600">
              {detailText.map(([k, v]) => (
                <li key={k} className="tabular-nums">
                  <span className="text-slate-400">{labelizeKey(k)}:</span>{" "}
                  <span className="font-medium">{formatDetail(v)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {step.status === "FAILED" && step.error ? (
            <div className="mt-2">
              <InlineAlert
                variant="destructive"
                title={step.error}
                description={step.errorDetail ? <p className="break-words">{String(step.errorDetail).slice(0, 600)}</p> : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function labelizeKey(k: string): string {
  // CamelCase / snake_case → natuurlijk NL label (kort, beste effort)
  const map: Record<string, string> = {
    totalFetched: "opgehaald",
    pagesProcessed: "pagina's",
    totalExpected: "verwacht",
    activeCompanies: "actief",
    relevantCompanies: "relevant",
    fetched: "contacten",
    pages: "pagina's",
    processed: "verwerkt",
    created: "aangemaakt",
    updated: "bijgewerkt",
    unchanged: "ongewijzigd",
    failed: "mislukt",
    skipped: "overgeslagen",
    matches: "matches",
    newlyLinked: "nieuw gekoppeld",
    errors: "fouten",
    dryRun: "dry run",
    previouslyLinked: "reeds gekoppeld",
    totalCompanies: "bedrijven",
    source: "bron",
    statusCode: "status code",
    rateLimit: "rate limit",
    remainingMs: "wachttijd ms",
  };
  if (map[k]) return map[k];
  return k
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

function formatDetail(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "boolean") return v ? "ja" : "nee";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v).slice(0, 120);
  }
}
