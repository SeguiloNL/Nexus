"use client";

import { useState, useTransition, useEffect } from "react";
import {
  DownloadCloud,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Users,
  PlusCircle,
  RefreshCw,
  MinusCircle,
  AlertCircle,
  Loader2,
  ShieldAlert,
  Link2,
  Database,
  Layers,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { startInserveCustomerImportAction } from "../../actions";
import type { ImportSummary } from "@/server/services/inserve-customer-import.service";

type ActionResult =
  | { ok: true; summary: ImportSummary; error?: undefined }
  | { ok: false; error: string; summary?: ImportSummary };

export function InserveCustomerImportClient() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  const onConfirmRun = () => {
    setConfirmOpen(false);
    setLastResult(null);
    startTransition(async () => {
      const res = (await startInserveCustomerImportAction()) as ActionResult;
      setLastResult(res);
      if (res.ok) {
        toast.success("Inserve klantimport voltooid.");
      } else if (res.summary?.status === "SKIPPED") {
        toast.info(res.error ?? "Import is overgeslagen.");
      } else {
        toast.error(res.error ?? "Import is (gedeeltelijk) mislukt.");
      }
    });
  };

  const summary = lastResult?.summary;
  const busy = isPending;

  return (
    <div className="space-y-6" aria-live="polite">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DownloadCloud className="h-5 w-5" /> Klanten importeren uit Inserve
          </CardTitle>
          <CardDescription>
            Lees bedrijven uit Inserve in waarvan het vrije veld <code className="bg-slate-100 px-1 rounded">Nexus</code> de waarde <code className="bg-slate-100 px-1 rounded">Actief</code> heeft. Nieuwe klanten worden aangemaakt; reeds gekoppelde klanten worden bijgewerkt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Let op</p>
                <ul className="list-disc list-inside space-y-0.5 mt-1 text-amber-700">
                  <li>Alleen bedrijven met <code>Nexus = Actief</code> worden geïmporteerd.</li>
                  <li>Eerder gekoppelde klanten worden alleen bijgewerkt op Inserve-velden; lokale notities, status en type blijven behouden.</li>
                  <li>Bedrijven die later <em>Inactief</em> worden of ontbreken, worden NIET automatisch verwijderd of gedeactiveerd.</li>
                  <li>Bestaande Nexus-klanten worden NIET automatisch gekoppeld op alleen bedrijfsnaam; mogelijke overeenkomsten worden achteraf gerapporteerd.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 justify-start pt-2">
            <Button
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              aria-busy={busy}
              className="gap-2"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {busy ? "Importeren…" : "Start import"}
            </Button>
            {lastResult?.ok && !busy && (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                Laatste import: {new Date(summary!.endedAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}
              </Badge>
            )}
            {!lastResult?.ok && lastResult?.error && !busy && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                {lastResult.error.length > 80 ? lastResult.error.slice(0, 80) + "…" : lastResult.error}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="space-y-4">
          <Card aria-busy={busy}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {summary.status === "SUCCESS" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : summary.status === "SKIPPED" ? (
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                Resultaat
                {summary.status !== "SUCCESS" && summary.status !== "SKIPPED" && (
                  <Badge variant="destructive" className="ml-2">Gedeeltelijk mislukt</Badge>
                )}
              </CardTitle>
              {summary.errorMessage && (
                <CardDescription className="text-red-600">
                  {summary.errorMessage}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard title="Opgehaald" value={summary.fetched} icon={<FileText className="h-4 w-4" />} tone="neutral" />
                <StatCard title="Voldoet aan Nexus = Actief" value={summary.activeFilterPassed} icon={<CheckCircle2 className="h-4 w-4 text-sky-600" />} tone="info" />
                <StatCard title="Aangemaakt" value={summary.created} icon={<PlusCircle className="h-4 w-4 text-emerald-600" />} tone="success" />
                <StatCard title="Bijgewerkt" value={summary.updated} icon={<RefreshCw className="h-4 w-4 text-blue-600" />} tone="info" />
                <StatCard title="Ongewijzigd" value={summary.unchanged} icon={<MinusCircle className="h-4 w-4 text-slate-500" />} tone="neutral" />
                <StatCard
                  title="Overgeslagen"
                  value={
                    summary.skipped.inactive_or_missing_nexus_field +
                    summary.skipped.missing_required_fields +
                    summary.skipped.fetch_error_nexus +
                    summary.skipped.other
                  }
                  icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                  tone="warning"
                />
                <StatCard title="Mislukt" value={summary.failed} icon={<XCircle className="h-4 w-4 text-red-600" />} tone="error" />
                <StatCard title="Duur (ms)" value={summary.durationMs} icon={<Timer className="h-4 w-4" />} tone="neutral" />
                <StatCard title="API pagina's" value={summary.pagesProcessed} icon={<Layers className="h-4 w-4" />} tone="info" />
                <StatCard title="API-totaal (volgens Inserve)" value={summary.totalExpected} icon={<Database className="h-4 w-4" />} tone="neutral" />
              </div>

              <div className="mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-slate-600" /> Diagnostiek
                      {summary.status === "SUCCESS" ? (
                        <Badge variant="outline" className="ml-2 bg-emerald-50 text-emerald-700 border-emerald-200">Geslaagd</Badge>
                      ) : summary.status === "SKIPPED" ? (
                        <Badge variant="outline" className="ml-2 bg-amber-50 text-amber-700 border-amber-200">Overgeslagen</Badge>
                      ) : (
                        <Badge variant="destructive" className="ml-2">Mislukt</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                        <p className="font-semibold mb-2 text-slate-700">Inserve configuratie</p>
                        <ul className="space-y-1 text-slate-600">
                          <li className="flex items-center justify-between">
                            <span>Status:</span>
                            <span className={`font-semibold ${summary.inserveCredentials?.configured ? "text-emerald-600" : "text-red-600"}`}>
                              {summary.inserveCredentials?.configured ? "✅ Geconfigureerd" : "❌ Niet geconfigureerd"}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Bron:</span>
                            <span className="font-mono">
                              {summary.inserveCredentials?.source === "db"
                                ? "Database (AppSetting)"
                                : summary.inserveCredentials?.source === "env"
                                ? "Omgevingsvariabelen"
                                : "Geen"}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Subdomein key:</span>
                            <span className={summary.inserveCredentials?.subdomainSet ? "text-emerald-600" : "text-red-600"}>
                              {summary.inserveCredentials?.subdomainSet ? "Aanwezig" : "Ontbreekt"}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>API-key:</span>
                            <span className={summary.inserveCredentials?.apiKeySet ? "text-emerald-600" : "text-red-600"}>
                              {summary.inserveCredentials?.apiKeySet ? "Aanwezig" : "Ontbreekt"}
                            </span>
                          </li>
                          {summary.inserveCredentials?.configured && "subdomainPrefix" in summary.inserveCredentials && summary.inserveCredentials.subdomainPrefix && (
                            <li className="flex items-center justify-between">
                              <span>Subdomein prefix:</span>
                              <span className="font-mono">{summary.inserveCredentials.subdomainPrefix}…</span>
                            </li>
                          )}
                        </ul>
                      </div>

                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                        <p className="font-semibold mb-2 text-slate-700">Timing per fase (ms) — 0ms = mogelijke short-circuit</p>
                        <ul className="space-y-1 text-slate-600 font-mono">
                          {[
                            { label: "RoleScope check", key: "roleScopeCheck" as const },
                            { label: "Mutex check", key: "mutexCheck" as const },
                            { label: "Config + SyncJobRun aanmaken", key: "createConfigAndRun" as const },
                            { label: "Inserve client initialisatie", key: "inserveInit" as const },
                            { label: "Bedrijven ophalen (API)", key: "fetchCompanies" as const },
                            { label: "Bestaande klanten laden", key: "fetchPreExisting" as const },
                            { label: "Records verwerken", key: "processRecords" as const },
                            { label: "Ongekoppelde matches zoeken", key: "findMatches" as const },
                            { label: "Afronden (audit + DB)", key: "finalize" as const },
                            { label: "Totaal", key: "total" as const },
                          ].map(({ label, key }) => {
                            const value = summary.timingMs?.[key] ?? 0;
                            const isSuspicious = value === 0 && key !== "finalize" && key !== "findMatches" && key !== "fetchPreExisting";
                            return (
                              <li key={key} className="flex items-center justify-between">
                                <span className={isSuspicious ? "text-red-600 font-semibold" : ""}>{label}:</span>
                                <span className={isSuspicious ? "text-red-600 font-bold" : "text-slate-900 font-semibold"}>
                                  {value}{isSuspicious ? " ⚠️" : ""}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-md border p-3">
                  <p className="font-semibold mb-1 text-slate-700">Redenen overgeslagen</p>
                  <ul className="space-y-0.5 text-slate-600">
                    <li>Nexus veld niet Actief / ontbreekt: <span className="font-mono">{summary.skipped.inactive_or_missing_nexus_field}</span></li>
                    <li>Verplichte velden ontbreken: <span className="font-mono">{summary.skipped.missing_required_fields}</span></li>
                    <li>Ophaalfout vrij veld: <span className="font-mono">{summary.skipped.fetch_error_nexus}</span></li>
                    <li>Overig: <span className="font-mono">{summary.skipped.other}</span></li>
                  </ul>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-semibold mb-1 text-slate-700">Eerder actief, nu Inactief</p>
                  <p className="text-slate-600">
                    <span className="font-mono text-lg">{summary.previouslyActiveNowInactive?.length ?? 0}</span>
                    {" "}klanten overgeslagen (geen automatische deactivering).
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-semibold mb-1 text-slate-700">Mogelijke ongekoppelde matches</p>
                  <p className="text-slate-600">
                    <span className="font-mono text-lg">{summary.possibleUnlinkedMatches?.length ?? 0}</span>
                    {" "}overeenkomsten voor handmatige beoordeling.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {summary.skippedDetails && summary.skippedDetails.length > 0 && (
            <DetailsCard
              title={`Overgeslagen bedrijven (${summary.skippedDetails.length})`}
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              rows={summary.skippedDetails.slice(0, 200).map((d) => ({
                id: `${d.companyId ?? "?"}-${d.reason}`,
                title: d.companyName ?? `Bedrijf #${d.companyId ?? "?"}`,
                subtitle: d.reason,
              }))}
              total={summary.skippedDetails.length}
              tone="warning"
            />
          )}

          {summary.failedDetails && summary.failedDetails.length > 0 && (
            <DetailsCard
              title={`Mislukte records (${summary.failedDetails.length})`}
              icon={<XCircle className="h-4 w-4 text-red-600" />}
              rows={summary.failedDetails.slice(0, 200).map((d) => ({
                id: `${d.companyId ?? "?"}-${d.error}`,
                title: d.companyName ?? `Bedrijf #${d.companyId ?? "?"}`,
                subtitle: d.error,
              }))}
              total={summary.failedDetails.length}
              tone="error"
            />
          )}

          {summary.previouslyActiveNowInactive && summary.previouslyActiveNowInactive.length > 0 && (
            <DetailsCard
              title={`Eerder actief, nu Inactief (${summary.previouslyActiveNowInactive.length})`}
              icon={<Link2 className="h-4 w-4 text-slate-600" />}
              rows={summary.previouslyActiveNowInactive.slice(0, 200).map((d) => ({
                id: d.customerId,
                title: `${d.companyName} (Inserve #${d.inserveCompanyId})`,
                subtitle: `Nexus klant ID: ${d.customerId} — handmatig controleren.`,
              }))}
              total={summary.previouslyActiveNowInactive.length}
              tone="neutral"
            />
          )}

          {summary.possibleUnlinkedMatches && summary.possibleUnlinkedMatches.length > 0 && (
            <DetailsCard
              title={`Mogelijke ongekppelde overeenkomsten (${summary.possibleUnlinkedMatches.length})`}
              icon={<Link2 className="h-4 w-4 text-blue-600" />}
              rows={summary.possibleUnlinkedMatches.slice(0, 200).map((d) => ({
                id: `${d.inserveCompanyId}-${d.reason}-${d.nexusCustomerId ?? "?"}`,
                title: `Inserve: ${d.inserveName} (#${d.inserveCompanyId}) ↔ Nexus: ${d.nexusCompanyName ?? "?"} (${d.nexusCustomerId ?? "?"})`,
                subtitle: `Reden: ${d.reason}${d.inserveKvkNr ? ` | KvK: ${d.inserveKvkNr}` : ""}${d.inserveEmail ? ` | E-mail: ${d.inserveEmail}` : ""}${d.inservePostalCode ? ` | Postcode: ${d.inservePostalCode}` : ""}`,
              }))}
              total={summary.possibleUnlinkedMatches.length}
              tone="info"
            />
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inserve klantimport starten?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Je staat op het punt om bedrijven uit Inserve te importeren. Alleen bedrijven met het vrije veld
                {" "}<code className="bg-slate-100 px-1 rounded">Nexus = Actief</code>{" "}
                worden verwerkt.
              </p>
              <ul className="list-disc list-inside text-slate-600">
                <li>Nieuwe klanten worden aangemaakt.</li>
                <li>Gekoppelde klanten worden alleen op Inserve-velden bijgewerkt.</li>
                <li>Lokale gegevens (notities, status, type) blijven behouden.</li>
                <li>Er vindt GEEN automatische verwijdering of deactivering plaats.</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <DialogClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">Annuleren</Button>
            </DialogClose>
            <Button
              onClick={onConfirmRun}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Play className="mr-2 h-4 w-4" /> Ja, start import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "error" | "info";

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50";
    case "warning":
      return "border-amber-200 bg-amber-50";
    case "error":
      return "border-red-200 bg-red-50";
    case "info":
      return "border-sky-200 bg-sky-50";
    default:
      return "border-slate-200 bg-slate-50";
  }
}

function StatCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: Tone;
}) {
  return (
    <div className={`rounded-md border p-3 ${toneClasses(tone)}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">{title}</span>
        {icon}
      </div>
      <p className="mt-1 text-2xl font-bold font-mono text-slate-900">{value}</p>
    </div>
  );
}

function DetailsCard({
  title,
  icon,
  rows,
  total,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ id: string; title: string; subtitle: string }>;
  total: number;
  tone: Tone;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        {total > rows.length && (
          <CardDescription className="text-xs">
            Toont eerste {rows.length} van {total} items.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className={`rounded-md border overflow-hidden ${toneClasses(tone)}`}>
          <div className="max-h-80 overflow-auto bg-white">
            <ul className="divide-y text-sm">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <p className="font-medium text-slate-800">{r.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5 break-words">{r.subtitle}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
