"use client";

import { useState, useTransition, useMemo } from "react";
import { useFormState } from "react-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  BellRing,
  Info,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Globe2,
  Send,
  Clock,
  TrendingUp,
} from "lucide-react";
import {
  saveNotificationSettingsAction,
  sendTestNotificationEmailAction,
} from "../actions";
import { toast } from "sonner";

const USAGE_ALERT_CHECK_INTERVAL_OPTIONS: Array<{
  value: number;
  label: string;
}> = [
  { value: 15, label: "Elke 15 minuten" },
  { value: 30, label: "Elke 30 minuten" },
  { value: 60, label: "Elk uur" },
  { value: 120, label: "Elke 2 uur" },
  { value: 240, label: "Elke 4 uur" },
  { value: 360, label: "Elke 6 uur" },
  { value: 720, label: "Elke 12 uur" },
  { value: 1440, label: "Eenmaal per dag" },
];

type ThresholdLevelValue =
  | "WARNING_70"
  | "WARNING_80"
  | "WARNING_90"
  | "CRITICAL_100";

const THRESHOLD_OPTIONS: Array<{
  value: ThresholdLevelValue;
  percent: number;
  label: string;
  description: string;
  severity: "info" | "warning" | "high" | "critical";
}> = [
  {
    value: "WARNING_70",
    percent: 70,
    label: "70%",
    description: "Vroege waarschuwing — 70% van de limiet verbruikt.",
    severity: "info",
  },
  {
    value: "WARNING_80",
    percent: 80,
    label: "80%",
    description: "Standaard — 80% van de limiet verbruikt (aanbevolen).",
    severity: "warning",
  },
  {
    value: "WARNING_90",
    percent: 90,
    label: "90%",
    description: "Ernstig — 90% van de limiet verbruikt.",
    severity: "high",
  },
  {
    value: "CRITICAL_100",
    percent: 100,
    label: "100%",
    description: "Kritiek — data-limiet volledig bereikt.",
    severity: "critical",
  },
];

function percentForLevel(v: ThresholdLevelValue): number {
  return THRESHOLD_OPTIONS.find((t) => t.value === v)?.percent ?? 80;
}

type InitialSettings = {
  enabledEmail: boolean;
  notificationEmail: string | null;
  enabledDataThresholdAlert: boolean;
  dataThresholdPercent: number;
  thresholdLevels: ThresholdLevelValue[];
  usageAlertCheckIntervalMinutes: number;
  notifyAllSims: boolean;
  lastNotificationAt: Date | null;
  _roleScope: "INTERNAL" | "CUSTOMER" | "RESELLER" | "PARTNER" | null;
};

type Props = {
  initialSettings: InitialSettings;
  isAdmin: boolean;
  customerCount: number;
};

type FormState =
  | { ok: true; message?: string; settings?: any }
  | { ok: false; message: string }
  | null;

async function submitAction(
  state: FormState,
  form: FormData
): Promise<NonNullable<FormState>> {
  try {
    const result = await saveNotificationSettingsAction(form);
    toast.success("Notificatie-instellingen opgeslagen.");
    return { ok: true, settings: result.settings };
  } catch (e: any) {
    const msg = e?.message || "Er ging iets mis met opslaan.";
    toast.error(msg);
    return { ok: false, message: msg };
  }
}

export function NotificationSettingsForm({
  initialSettings,
  isAdmin,
  customerCount,
}: Props) {
  const [state, formAction, isPending] = useFormState(submitAction, null as FormState);
  const [enabledEmail, setEnabledEmail] = useState(initialSettings.enabledEmail);
  const [notificationEmail, setNotificationEmail] = useState<string>(
    initialSettings.notificationEmail ?? ""
  );
  const [enabledThreshold, setEnabledThreshold] = useState(
    initialSettings.enabledDataThresholdAlert
  );
  const [notifyAllSims, setNotifyAllSims] = useState(
    initialSettings.notifyAllSims
  );
  const [selectedLevels, setSelectedLevels] = useState<ThresholdLevelValue[]>(
    Array.isArray(initialSettings.thresholdLevels) &&
      initialSettings.thresholdLevels.length > 0
      ? initialSettings.thresholdLevels
      : ["WARNING_80"]
  );
  const [checkInterval, setCheckInterval] = useState<number>(
    initialSettings.usageAlertCheckIntervalMinutes ?? 60
  );
  const [isTestPending, startTestTransition] = useTransition();
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const effectiveLevels = useMemo(() => {
    if (selectedLevels.length > 0) return selectedLevels;
    return ["WARNING_80"] as ThresholdLevelValue[];
  }, [selectedLevels]);

  const maxPercent = useMemo(
    () => Math.max(...effectiveLevels.map((l) => percentForLevel(l))),
    [effectiveLevels]
  );

  const hasAnyLevelsSelected = selectedLevels.length > 0;

  async function handleSendTestEmail() {
    setTestResult(null);
    startTestTransition(async () => {
      try {
        const res = await sendTestNotificationEmailAction();
        setTestResult({ ok: res.ok, message: res.message });
        if (res.ok) {
          toast.success(res.message);
        } else {
          toast.error(res.message);
        }
      } catch (e: any) {
        const msg = e?.message || "Er ging iets mis met de test e-mail.";
        setTestResult({ ok: false, message: msg });
        toast.error(msg);
      }
    });
  }

  function toggleLevel(level: ThresholdLevelValue) {
    setSelectedLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  }

  const scopeText = isAdmin
    ? notifyAllSims
      ? "Alle SIM-kaarten in Nexus (volledige scope)."
      : customerCount > 0
      ? `Alleen SIM-kaarten binnen uw klant-scope (${customerCount} klant${customerCount === 1 ? "" : "en"}).`
      : "Als beheerder zonder vinkje 'Alle SIMs' ontvangt u geen notificaties (geen gekoppelde klanten)."
    : customerCount > 0
    ? `Alleen SIM-kaarten binnen uw klant-scope (${customerCount} klant${customerCount === 1 ? "" : "en"}).`
    : "Geen SIM-kaarten in uw scope — u ontvangt geen notificaties.";

  const severityBadgeClass = (s: string) => {
    switch (s) {
      case "info":
        return "bg-sky-100 text-sky-800 border-sky-200";
      case "warning":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-slate-500" />
              Notificatie-instellingen
            </CardTitle>
            <CardDescription>
              Bepaal wanneer en op welk kanaal u notificaties wilt ontvangen.
            </CardDescription>
          </div>
          {initialSettings.lastNotificationAt ? (
            <Badge variant="outline" className="text-[11px]">
              Laatste melding:{" "}
              {initialSettings.lastNotificationAt.toLocaleDateString("nl-NL", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[11px]">
              Nog geen meldingen verstuurd
            </Badge>
          )}
        </div>
      </CardHeader>

      <form action={formAction}>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-500" />
              Kanalen
            </h3>
            <label
              htmlFor="enabledEmail"
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 cursor-pointer"
            >
              <input
                id="enabledEmail"
                name="enabledEmail"
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={enabledEmail}
                onChange={(e) => setEnabledEmail(e.target.checked)}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium">E-mail</div>
                  <Badge variant="outline" className="text-[11px]">
                    Aanbevolen
                  </Badge>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Ontvang notificaties per e-mail. Standaard op het e-mailadres
                  van uw account, of op een apart notificatie-adres (zie onder).
                </div>
              </div>
              <div
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  enabledEmail
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {enabledEmail ? "Aan" : "Uit"}
              </div>
            </label>

            <div
              className={`rounded-lg border border-slate-200 p-4 space-y-2 ${
                !enabledEmail ? "opacity-60" : ""
              }`}
              aria-disabled={!enabledEmail}
            >
              <input
                type="hidden"
                name="notificationEmail"
                value={notificationEmail}
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="notificationEmailVisible"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    Afwijkend notificatie-e-mailadres
                    <span className="ml-1 text-xs text-slate-400">
                      (optioneel)
                    </span>
                  </label>
                  <Input
                    id="notificationEmailVisible"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="Laat leeg om uw account-e-mail te gebruiken"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    disabled={!enabledEmail}
                    className="w-full"
                  />
                </div>
              </div>
              <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                <div>
                  Wordt dit veld leeggelaten, dan worden notificaties en
                  testberichten verstuurd naar het e-mailadres van uw account.
                  Sla de wijzigingen eerst op voordat u een testbericht
                  verstuurt.
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Test e-mail verzending</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Verstuur een testbericht naar{" "}
                    <span className="font-medium text-slate-700">
                      {initialSettings.notificationEmail
                        ? `${initialSettings.notificationEmail} (notificatie-adres)`
                        : "uw account-e-mailadres"}
                    </span>
                    {notificationEmail !== (initialSettings.notificationEmail ?? "") && (
                      <span className="block text-amber-700 mt-0.5">
                        Let op: u heeft het notificatie-adres gewijzigd. Sla
                        eerst op voordat het nieuwe adres gebruikt wordt.
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSendTestEmail}
                  disabled={isTestPending || !enabledEmail}
                  className="gap-2 whitespace-nowrap"
                  aria-busy={isTestPending}
                >
                  {isTestPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Versturen…
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Verstuur test e-mail
                    </>
                  )}
                </Button>
              </div>
              {testResult ? (
                <div
                  className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs ${
                    testResult.ok
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-amber-50 border-amber-200 text-amber-800"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  )}
                  <div>{testResult.message}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Datadrempel SIM-kaarten
            </h3>

            <label
              htmlFor="enabledDataThresholdAlert"
              className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50 cursor-pointer"
            >
              <input
                id="enabledDataThresholdAlert"
                name="enabledDataThresholdAlert"
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300"
                checked={enabledThreshold}
                onChange={(e) => setEnabledThreshold(e.target.checked)}
                disabled={!enabledEmail}
              />
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  Waarschuw bij datadrempel
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                    {selectedLevels.length > 0
                      ? selectedLevels
                          .map((l) => `${percentForLevel(l)}%`)
                          .join(", ")
                      : "geen"}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Zodra een SIM in uw bereik een van de geselecteerde
                  drempelwaardes bereikt, ontvangt u per e-mail 1 overzicht per
                  notificatiecyclus. Elke drempel wordt per bundelperiode
                  maximaal 1 keer per SIM gerapporteerd (anti-spam guard).
                </div>
              </div>
              <div
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  enabledThreshold && enabledEmail && hasAnyLevelsSelected
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {enabledThreshold && enabledEmail && hasAnyLevelsSelected
                  ? "Aan"
                  : "Uit"}
              </div>
            </label>

            <div
              className={`space-y-3 rounded-lg border border-slate-200 p-4 ${
                !enabledThreshold || !enabledEmail ? "opacity-60" : ""
              }`}
              aria-disabled={!enabledThreshold || !enabledEmail}
            >
              <div className="flex items-start gap-2 text-sm">
                <TrendingUp className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-500" />
                <div className="flex-1">
                  <div className="font-medium text-slate-700">
                    Drempelwaardes
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Selecteer een of meerdere drempels waarop u gewaarschuwd
                    wilt worden. U kunt per SIM meerdere notificaties ontvangen
                    (één per bereikte drempel, per bundelperiode).
                  </div>
                </div>
              </div>
              <input
                type="hidden"
                name="dataThresholdPercent"
                value={maxPercent}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {THRESHOLD_OPTIONS.map((opt) => {
                  const checked = selectedLevels.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      htmlFor={`level-${opt.value}`}
                      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 transition ${
                        checked
                          ? `border-2 ${severityBadgeClass(opt.severity)}`
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      } ${
                        !enabledThreshold || !enabledEmail
                          ? "pointer-events-none opacity-60"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <input
                            id={`level-${opt.value}`}
                            name="thresholdLevels"
                            type="checkbox"
                            value={opt.value}
                            checked={checked}
                            onChange={() => toggleLevel(opt.value)}
                            disabled={!enabledThreshold || !enabledEmail}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-sm font-semibold">
                            {opt.label}
                          </span>
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 leading-snug min-h-[28px]">
                        {opt.description}
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedLevels.length === 0 && (enabledThreshold && enabledEmail) ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    Selecteer minimaal 1 drempel. Als u niets selecteert, wordt
                    automatisch 80% aangehouden.
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className={`space-y-3 rounded-lg border border-slate-200 bg-slate-50/40 p-4 ${
                !enabledThreshold || !enabledEmail ? "opacity-60" : ""
              }`}
              aria-disabled={!enabledThreshold || !enabledEmail}
            >
              <div className="flex items-start gap-2 text-sm">
                <Clock className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-500" />
                <div className="flex-1">
                  <div className="font-medium text-slate-700 flex items-center gap-2">
                    Controle-interval
                    <Badge variant="outline" className="text-[10px]">
                      Frequentie
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Hoe vaak wilt u dat uw SIM-kaarten worden gecontroleerd
                    op drempeloverschrijdingen? Kortere intervallen geven
                    snellere waarschuwingen, maar resulteren in meer e-mails.
                  </div>
                </div>
              </div>

              <input
                type="hidden"
                name="usageAlertCheckIntervalMinutes"
                value={checkInterval}
              />

              <Select
                value={String(checkInterval)}
                onValueChange={(v) => setCheckInterval(Number(v))}
                disabled={!enabledThreshold || !enabledEmail}
              >
                <SelectTrigger
                  id="check-interval"
                  className="w-full sm:max-w-xs text-sm"
                >
                  <SelectValue placeholder="Kies interval" />
                </SelectTrigger>
                <SelectContent>
                  {USAGE_ALERT_CHECK_INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={String(opt.value)}
                      className="text-sm"
                    >
                      {opt.label}
                      {opt.value <= 30 ? (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px] border-indigo-200 text-indigo-700 bg-indigo-50"
                        >
                          Snel
                        </Badge>
                      ) : opt.value <= 60 ? (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50"
                        >
                          Standaard
                        </Badge>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="text-[11px] text-slate-500">
                Let op: de werkelijke minimum resolutie wordt bepaald door de
                globale sync-taak (admin-instellingen). Om intervallen korter
                dan 1 uur te gebruiken, moet de beheerder de taak{" "}
                <code className="rounded bg-slate-200 px-1 py-0.5 font-mono">
                  SIMHUIS_USAGE_ALERT_NOTIFY
                </code>{" "}
                op een kortere frequentie ingesteld hebben.
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs space-y-2">
              <div className="flex items-start gap-2 text-slate-600">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
                <div>
                  <div className="font-medium text-slate-700">
                    Welke SIM-kaarten ontvangt u?
                  </div>
                  <div className="mt-0.5">{scopeText}</div>
                </div>
              </div>
              {!enabledEmail && (
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    E-mail kanaal staat uit. Zet &ldquo;E-mail&rdquo; aan om
                    drempel-notificaties te ontvangen.
                  </div>
                </div>
              )}
              {enabledEmail && enabledThreshold && !hasAnyLevelsSelected && (
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    Geen drempels geselecteerd — standaard 80% wordt aangehouden
                    bij opslaan.
                  </div>
                </div>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-indigo-600" />
                Beheerder-opties
              </h3>
              <label
                htmlFor="notifyAllSims"
                className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4 hover:bg-indigo-50 cursor-pointer"
              >
                <input
                  id="notifyAllSims"
                  name="notifyAllSims"
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                  checked={notifyAllSims}
                  onChange={(e) => setNotifyAllSims(e.target.checked)}
                />
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-2">
                    Ontvang notificaties van alle SIM-kaarten
                    <Badge
                      variant="outline"
                      className="text-[11px] border-indigo-200 text-indigo-700"
                    >
                      Alleen beheerders
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Overschrijft de klant-scope. U ontvangt dan meldingen van
                    elke SIM-kaart in het systeem (alle klanten, resellers en
                    partners).
                  </div>
                </div>
                <div
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    notifyAllSims
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {notifyAllSims ? "Alle SIMs" : "Alleen scope"}
                </div>
              </label>
            </div>
          )}

          {state?.ok === true && state.message ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              {state.message}
            </div>
          ) : null}
          {state?.ok === false ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4" />
              {state.message}
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="justify-end gap-3 border-t pt-4">
          <Button
            type="submit"
            disabled={isPending}
            className="gap-2"
            aria-busy={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opslaan…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Instellingen opslaan
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
