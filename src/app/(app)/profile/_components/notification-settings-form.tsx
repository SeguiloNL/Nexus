"use client";

import { useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  BellRing,
  Info,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Globe2,
} from "lucide-react";
import { saveNotificationSettingsAction } from "../actions";
import { toast } from "sonner";

type InitialSettings = {
  enabledEmail: boolean;
  enabledDataThresholdAlert: boolean;
  dataThresholdPercent: number;
  notifyAllSims: boolean;
  lastNotificationAt: Date | null;
  _roleScope: "INTERNAL" | "CUSTOMER" | "RESELLER" | "PARTNER" | null;
};

type Props = {
  initialSettings: InitialSettings;
  isInternal: boolean;
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
  isInternal,
  customerCount,
}: Props) {
  const [state, formAction, isPending] = useFormState(submitAction, null as FormState);
  const [enabledEmail, setEnabledEmail] = useState(initialSettings.enabledEmail);
  const [enabledThreshold, setEnabledThreshold] = useState(
    initialSettings.enabledDataThresholdAlert
  );
  const [notifyAllSims, setNotifyAllSims] = useState(
    initialSettings.notifyAllSims
  );
  const [pct] = useState(initialSettings.dataThresholdPercent);

  const scopeText = isInternal
    ? notifyAllSims
      ? "Alle SIM-kaarten in Nexus (volledige scope)."
      : customerCount > 0
      ? `Alleen SIM-kaarten binnen uw klant-scope (${customerCount} klant${customerCount === 1 ? "" : "en"}).`
      : "Als interne gebruiker zonder vinkje 'Alle SIMs' ontvangt u geen notificaties (geen gekoppelde klanten)."
    : customerCount > 0
    ? `Alleen SIM-kaarten binnen uw klant-scope (${customerCount} klant${customerCount === 1 ? "" : "en"}).`
    : "Geen SIM-kaarten in uw scope — u ontvangt geen notificaties.";

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
                  Ontvang notificaties op het e-mailadres van uw account.
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
                <div className="font-medium flex items-center gap-2">
                  Waarschuw bij datadrempel
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                    {pct}%
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Zodra een SIM in uw bereik {pct}% of meer van de data-limiet
                  verbruikt heeft, ontvangt u per e-mail 1 overzicht per
                  notificatiecyclus.
                </div>
              </div>
              <div
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  enabledThreshold && enabledEmail
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {enabledThreshold && enabledEmail ? "Aan" : "Uit"}
              </div>
            </label>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs space-y-2">
              <input
                type="hidden"
                name="dataThresholdPercent"
                value={pct}
              />
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
            </div>
          </div>

          {isInternal && (
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
