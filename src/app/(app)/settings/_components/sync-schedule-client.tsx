"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  saveSyncScheduleAction,
  resetSyncScheduleAction,
  triggerSyncJobAction,
  getSyncSchedulesAction,
  type SchedulerFullState,
  type SyncScheduleSaveState,
  type SyncScheduleResetState,
  type SyncScheduleTriggerState,
} from "../actions";
import {
  SyncFrequency,
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
} from "@/types/enums";
import type { SyncJobConfig, SyncJobRun } from "@prisma/client";

const JOB_LABELS: Record<SyncJobId, { title: string; desc: string }> = {
  [SyncJobId.SIMHUIS_USAGE]: {
    title: "Simhuis Verbruiksdata",
    desc: "Verbruik per SIM (MB/SMS/Voice) automatisch importeren.",
  },
  [SyncJobId.SIMHUIS_USAGE_ALERT_NOTIFY]: {
    title: "SIM Datadrempel Notificaties",
    desc: "E-mail notificaties sturen wanneer SIM(s) 80% van de data-limiet bereiken.",
  },
  [SyncJobId.SIMHUIS_SIMS]: {
    title: "Simhuis SIM-voorraad",
    desc: "Beschikbare SIMs (inventory) automatisch bijwerken vanuit Simhuis.",
  },
  [SyncJobId.INSERVE]: {
    title: "Inserve Abonnementen + Facturen",
    desc: "Inserve administratie synchroniseren (contracten + facturen).",
  },
};

function naturalLanguageSchedule(cfg: SyncJobConfig): string {
  const hh = String(cfg.hour).padStart(2, "0");
  const mm = String(cfg.minute).padStart(2, "0");
  switch (cfg.frequency) {
    case SyncFrequency.HOURLY:
      return `Elk uur op :${mm}`;
    case SyncFrequency.DAILY:
      return `Dagelijks om ${hh}:${mm}`;
    case SyncFrequency.WEEKLY: {
      const dag = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"][cfg.dayOfWeek ?? 1];
      return `Wekelijks op ${dag} ${hh}:${mm}`;
    }
    case SyncFrequency.MONTHLY: {
      const d = cfg.dayOfMonth ?? 1;
      const suffix = d >= 31 ? " (laatste dag van de maand)" : "";
      return `Maandelijks dag ${d}${suffix} om ${hh}:${mm}`;
    }
    default:
      return "";
  }
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("nl-NL", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Europe/Amsterdam",
    });
  } catch {
    return String(d);
  }
}

function duration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const STATUS_VARIANT: Record<SyncJobStatus, "default" | "secondary" | "outline" | "success" | "destructive" | "warning"> = {
  [SyncJobStatus.QUEUED]: "secondary",
  [SyncJobStatus.RUNNING]: "default",
  [SyncJobStatus.SUCCESS]: "success",
  [SyncJobStatus.FAILED]: "destructive",
  [SyncJobStatus.SKIPPED]: "outline",
  [SyncJobStatus.TIMEOUT]: "warning",
};

const TRIGGER_LABEL: Record<SyncJobTrigger, string> = {
  [SyncJobTrigger.MANUAL_ADMIN]: "Handmatig (ADMIN)",
  [SyncJobTrigger.SYSTEMD_TIMER]: "Systemd timer",
  [SyncJobTrigger.FALLBACK_POLLING]: "Fallback polling",
  [SyncJobTrigger.API_TOKEN]: "Externe API-token",
};

function StatusBadge({ status }: { status: SyncJobStatus }) {
  return <Badge variant={STATUS_VARIANT[status] as any}>{status}</Badge>;
}

/* ===================================== SUBMIT BUTTONS (Pending state) ===================================== */

function SubmitButton({ label, loading = "Opslaan…", variant = "default" as any }: any) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? loading : label}
    </Button>
  );
}

/* ===================================== HEALTH BANNER ===================================== */

function HealthBanner({ state }: { state: SchedulerFullState["health"] }) {
  const kind = state.healthy
    ? "ok"
    : state.fallbackActive
      ? "warn"
      : "err";

  const border =
    kind === "ok"
      ? "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-200"
      : kind === "warn"
        ? "border-amber-600/40 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
        : "border-red-600/40 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200";

  const title = kind === "ok" ? "Scheduler gezond" : kind === "warn" ? "Scheduler gedeeltelijk actief" : "Scheduler mogelijk niet actief";

  return (
    <div className={`rounded-lg border p-3 text-sm ${border}`} role="status" aria-live="polite">
      <div className="font-semibold mb-1">{title}</div>
      {state.warnings.length > 0 ? (
        <ul className="list-disc pl-5 space-y-1 mb-2">
          {state.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
          Herstel-instructies (als timers niet werken)
        </summary>
        <ol className="mt-2 pl-5 list-decimal space-y-1 text-xs">
          <li>Log in op de VPS en controleer: <code>sudo systemctl list-timers &apos;stm-*&apos; --all</code></li>
          <li>Controleer cron-daemon (referentie): <code>systemctl status cron</code></li>
          <li>Controleer user/system crontab: <code>crontab -l</code> en <code>sudo ls /etc/cron.* /var/spool/cron/crontabs/ 2&gt;/dev/null || echo &quot;geen legacy cron&quot;</code></li>
          <li>Status STM timers: <code>sudo bash /opt/stm/scripts/check-cron-jobs.sh --dry-run</code></li>
          <li>Forceer eenmalige run per taak: <code>sudo systemctl start stm-simhuis-usage-sync.service</code></li>
        </ol>
      </details>
    </div>
  );
}

/* ===================================== PER-JOB CARD ===================================== */

interface JobCardProps {
  cfg: SyncJobConfig;
  initialState: SchedulerFullState;
  canEdit: boolean;
  viewerIsInternal: boolean;
  refresh: () => Promise<void>;
  recentByJob: Map<string, (SyncJobRun & { user: { name: string | null; email: string } | null })[]>;
}

function JobCard({ cfg, initialState, canEdit, viewerIsInternal, refresh, recentByJob }: JobCardProps) {
  const label = JOB_LABELS[cfg.jobId as SyncJobId];
  const [expanded, setExpanded] = React.useState(false);
  const [saveState, saveAction] = useFormState<SyncScheduleSaveState | undefined, FormData>(
    saveSyncScheduleAction,
    undefined
  );
  const [resetState, resetAction] = useFormState<SyncScheduleResetState | undefined, FormData>(
    resetSyncScheduleAction,
    undefined
  );
  const [triggerState, triggerAction] = useFormState<SyncScheduleTriggerState | undefined, FormData>(
    triggerSyncJobAction,
    undefined
  );

  const [freq, setFreq] = React.useState(cfg.frequency as SyncFrequency);
  const [enabled, setEnabled] = React.useState(Boolean(cfg.enabled));
  const [hour, setHour] = React.useState(String(cfg.hour));
  const [minute, setMinute] = React.useState(String(cfg.minute));
  const [dow, setDow] = React.useState(String(cfg.dayOfWeek ?? 1));
  const [dom, setDom] = React.useState(String(cfg.dayOfMonth ?? 1));
  const [tz, setTz] = React.useState(cfg.timezone);

  React.useEffect(() => {
    setFreq(cfg.frequency as SyncFrequency);
    setEnabled(Boolean(cfg.enabled));
    setHour(String(cfg.hour));
    setMinute(String(cfg.minute));
    setDow(String(cfg.dayOfWeek ?? 1));
    setDom(String(cfg.dayOfMonth ?? 1));
    setTz(cfg.timezone);
  }, [cfg]);

  React.useEffect(() => {
    if (!saveState) return;
    if (saveState.success) {
      toast.success(saveState.message ?? "Schedule opgeslagen.");
      refresh();
    } else if (saveState.errors || saveState.message) {
      toast.error(saveState.message ?? "Opslaan mislukt.");
    }
  }, [saveState, refresh]);

  React.useEffect(() => {
    if (!resetState) return;
    if (resetState.success) {
      toast.success(resetState.message ?? "Schedule gereset.");
      refresh();
    } else if (resetState.errors || resetState.message) {
      toast.error(resetState.message ?? "Reset mislukt.");
    }
  }, [resetState, refresh]);

  React.useEffect(() => {
    if (!triggerState) return;
    if (triggerState.success) {
      toast.success(triggerState.summary ?? "Handmatige run voltooid.");
      refresh();
    } else if (triggerState.errors || triggerState.message) {
      toast.error(triggerState.message ?? "Handmatige run mislukt.");
    }
  }, [triggerState, refresh]);

  const runs = recentByJob.get(cfg.jobId) ?? [];
  const editable = canEdit && viewerIsInternal;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-lg">{label.title}</CardTitle>
              <Badge variant={enabled ? "success" : "secondary"}>
                {enabled ? "Actief" : "Uitgeschakeld"}
              </Badge>
              <Badge variant="outline" className="ml-1">
                {naturalLanguageSchedule(cfg)}
              </Badge>
            </div>
            <CardDescription className="mt-1">{label.desc}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              aria-controls={`job-${cfg.jobId}-body`}
            >
              {expanded ? "Inklappen" : "Uitklappen"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded ? (
        <CardContent id={`job-${cfg.jobId}-body`} className="space-y-6">
          {/* EDIT FORM */}
          <form action={saveAction} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="hidden" name="jobId" value={cfg.jobId} />
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id={`en-${cfg.jobId}`}
                type="checkbox"
                name="enabled"
                checked={enabled}
                value="1"
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!editable}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor={`en-${cfg.jobId}`} className="font-semibold">
                Automatisch synchroniseren inschakelen
              </Label>
            </div>

            <div>
              <Label htmlFor={`freq-${cfg.jobId}`} className="mb-1 block">Frequentie</Label>
              <Select
                name="frequency"
                value={freq}
                onValueChange={(v) => setFreq(v as SyncFrequency)}
                disabled={!editable}
              >
                <SelectTrigger id={`freq-${cfg.jobId}`}>
                  <SelectValue placeholder="Kies frequentie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SyncFrequency.HOURLY}>Per uur</SelectItem>
                  <SelectItem value={SyncFrequency.DAILY}>Dagelijks</SelectItem>
                  <SelectItem value={SyncFrequency.WEEKLY}>Wekelijks</SelectItem>
                  <SelectItem value={SyncFrequency.MONTHLY}>Maandelijks</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {freq !== SyncFrequency.HOURLY ? (
              <div>
                <Label htmlFor={`h-${cfg.jobId}`} className="mb-1 block">Uur (0–23)</Label>
                <Input
                  id={`h-${cfg.jobId}`}
                  type="number"
                  min={0}
                  max={23}
                  name="hour"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  disabled={!editable}
                />
              </div>
            ) : (
              <input type="hidden" name="hour" value={hour} />
            )}

            <div>
              <Label htmlFor={`m-${cfg.jobId}`} className="mb-1 block">Minuut (0–59)</Label>
              <Input
                id={`m-${cfg.jobId}`}
                type="number"
                min={0}
                max={59}
                name="minute"
                value={minute}
                onChange={(e) => setMinute(e.target.value)}
                disabled={!editable}
              />
            </div>

            {freq === SyncFrequency.WEEKLY ? (
              <div>
                <Label htmlFor={`dow-${cfg.jobId}`} className="mb-1 block">Dag van de week (0=Zo, 1=Ma, …)</Label>
                <Select name="dayOfWeek" value={dow} onValueChange={setDow} disabled={!editable}>
                  <SelectTrigger id={`dow-${cfg.jobId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"].map((n, i) => (
                      <SelectItem key={i} value={String(i)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <input type="hidden" name="dayOfWeek" value={dow} />
            )}

            {freq === SyncFrequency.MONTHLY ? (
              <div>
                <Label htmlFor={`dom-${cfg.jobId}`} className="mb-1 block">Dag van de maand (1–31; 31 = laatste dag)</Label>
                <Input
                  id={`dom-${cfg.jobId}`}
                  type="number"
                  min={1}
                  max={31}
                  name="dayOfMonth"
                  value={dom}
                  onChange={(e) => setDom(e.target.value)}
                  disabled={!editable}
                />
              </div>
            ) : (
              <input type="hidden" name="dayOfMonth" value={dom} />
            )}

            <div className="md:col-span-2">
              <Label htmlFor={`tz-${cfg.jobId}`} className="mb-1 block">Tijdzone</Label>
              <Input
                id={`tz-${cfg.jobId}`}
                type="text"
                name="timezone"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                disabled={!editable}
              />
            </div>

            {saveState?.errors ? (
              <div className="md:col-span-2 text-sm text-red-700 dark:text-red-300">
                {Object.entries(saveState.errors).map(([k, v]) => (
                  <div key={k}><strong>{k}:</strong> {v?.join("; ")}</div>
                ))}
              </div>
            ) : null}
            {saveState?.message ? (
              <div className={`md:col-span-2 text-sm ${saveState.success ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                {saveState.message}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 md:col-span-2 items-center">
              {editable ? (
                <>
                  <SubmitButton label="Opslaan" loading="Opslaan…" />
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" type="button" size="sm">Reset naar standaard</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Schedule resetten?</DialogTitle>
                        <DialogDescription>
                          Hiermee wordt de configuratie voor <strong>{label.title}</strong> teruggezet naar de standaardwaarden.
                        </DialogDescription>
                      </DialogHeader>
                      <form action={resetAction} className="contents">
                        <input type="hidden" name="jobId" value={cfg.jobId} />
                        <DialogFooter>
                          <Button variant="outline" type="button" className="DialogClose-marker hidden">
                            Annuleren
                          </Button>
                          <SubmitButton label="Bevestig reset" loading="Resetten…" variant="destructive" />
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Separator orientation="vertical" className="h-6" />
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button type="button" size="sm" variant="secondary">
                        Handmatig nu synchroniseren
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Handmatige run starten?</DialogTitle>
                        <DialogDescription>
                          Start <strong>{label.title}</strong> direct, onafhankelijk van de geplande frequentie.
                        </DialogDescription>
                      </DialogHeader>
                      <form action={triggerAction} className="contents">
                        <input type="hidden" name="jobId" value={cfg.jobId} />
                        <input type="hidden" name="force" value="1" />
                        <DialogFooter>
                          <SubmitButton label="Start synchronisatie" loading="Synchroniseren…" />
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Alleen interne ADMINs kunnen de planning wijzigen of handmatig starten.
                </p>
              )}
            </div>
          </form>

          {/* RECENT RUNS PER JOB */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Recente uitvoeringen (deze taak)</h4>
              <Badge variant="outline">{runs.length} van laatste 50</Badge>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Gestart</TableHead>
                    <TableHead>Duur</TableHead>
                    <TableHead>Door</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        Nog geen uitvoeringen gelogd.
                      </TableCell>
                    </TableRow>
                  ) : (
                    runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell><StatusBadge status={r.status as SyncJobStatus} /></TableCell>
                        <TableCell>{TRIGGER_LABEL[r.triggeredBy as SyncJobTrigger]}</TableCell>
                        <TableCell>{fmtDate(r.startedAt)}</TableCell>
                        <TableCell>{duration(r.durationMs)}</TableCell>
                        <TableCell>
                          {r.user ? (r.user.name ?? r.user.email) : "systeem"}
                        </TableCell>
                        <TableCell className="max-w-xs text-xs text-muted-foreground">
                          {r.errorMessage || (
                            r.recordsAffected
                              ? JSON.stringify(r.recordsAffected)
                                  .slice(0, 120)
                              : "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ===================================== ROOT COMPONENT ===================================== */

export function SyncScheduleCard({
  initialState,
}: {
  initialState: SchedulerFullState | null;
}) {
  const [state, setState] = React.useState<SchedulerFullState | null>(initialState);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSyncSchedulesAction();
      setState(next);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setState(initialState);
  }, [initialState]);

  const recentByJob = React.useMemo(() => {
    const m = new Map<string, (SyncJobRun & { user: { name: string | null; email: string } | null })[]>();
    for (const jobId of Object.values(SyncJobId)) m.set(jobId, []);
    if (!state) return m;
    for (const r of state.runs.rows) {
      const arr = m.get(r.jobId) ?? [];
      if (arr.length < 10) arr.push(r);
      m.set(r.jobId, arr);
    }
    return m;
  }, [state]);

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Automatische synchronisatie (planning)</CardTitle>
          <CardDescription>
            Je hebt geen toegang om de instellingen te bekijken (setting/view recht vereist).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { configs, health, runs, canEdit, viewerIsInternal } = state;

  return (
    <div aria-busy={loading} aria-live="polite">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Automatische synchronisatie (planning)</CardTitle>
              <CardDescription>
                Beheer frequentie en tijdstippen voor het automatisch binnenhalen van verbruiksdata, SIM-voorraad en Inserve-sync.
                Alleen interne ADMINs kunnen wijzigen.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? "Vernieuwen…" : "Ververs"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <HealthBanner state={health} />

          {configs.map((cfg) => (
            <JobCard
              key={cfg.id}
              cfg={cfg}
              initialState={state}
              canEdit={canEdit}
              viewerIsInternal={viewerIsInternal}
              refresh={refresh}
              recentByJob={recentByJob}
            />
          ))}

          {/* Globale Recente Runs tabel */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Algemene uitvoeringslog</CardTitle>
                  <CardDescription>
                    Laatste {runs.rows.length} van in totaal {runs.total} runs.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Taak</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Gestart</TableHead>
                      <TableHead>Duur</TableHead>
                      <TableHead>Door</TableHead>
                      <TableHead>Foutmelding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                          Nog geen uitvoeringen.
                        </TableCell>
                      </TableRow>
                    ) : (
                      runs.rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{JOB_LABELS[r.jobId as SyncJobId]?.title ?? r.jobId}</TableCell>
                          <TableCell><StatusBadge status={r.status as SyncJobStatus} /></TableCell>
                          <TableCell>{TRIGGER_LABEL[r.triggeredBy as SyncJobTrigger]}</TableCell>
                          <TableCell>{fmtDate(r.startedAt)}</TableCell>
                          <TableCell>{duration(r.durationMs)}</TableCell>
                          <TableCell>
                            {r.user ? (r.user.name ?? r.user.email) : "systeem"}
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-red-700 dark:text-red-300 break-words">
                            {r.errorMessage || "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

export default SyncScheduleCard;
