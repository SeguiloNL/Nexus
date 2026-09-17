"use client";

import { useFormState } from "react-dom";
import { useEffect, useState, useTransition } from "react";
import {
  saveInserveSettingsAction,
  type InserveSettingsActionState,
  testInserveConnectionAction,
  type ConnectionTestResult,
} from "../actions";
import type { InserveSettingsMasked } from "@/server/validators/setting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Cloud, Eye, EyeOff, CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InserveSettingsFormProps {
  initial: InserveSettingsMasked;
  readOnly: boolean;
}

const initialState: InserveSettingsActionState = {};

export function InserveSettingsForm({ initial, readOnly }: InserveSettingsFormProps) {
  const [state, formAction, isPending] = useFormState(
    saveInserveSettingsAction,
    initialState
  );
  const [isTestPending, startTestTransition] = useTransition();
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  const [subdomain, setSubdomain] = useState(initial.subdomain ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (state?.success) {
      setApiKey("");
    }
  }, [state?.success]);

  const handleTestConnection = () => {
    setConnectionResult(null);
    startTestTransition(async () => {
      const result = await testInserveConnectionAction();
      setConnectionResult(result);
    });
  };

  const sourceLabel =
    initial.source === "db"
      ? { text: "Database (WebGUI)", variant: "default" as const, className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" }
      : initial.source === "env"
        ? { text: "Omgevingsvariabelen (.env)", variant: "outline" as const, className: "bg-blue-50 text-blue-700" }
        : { text: "Niet geconfigureerd", variant: "outline" as const, className: "bg-slate-50 text-slate-500" };

  return (
    <Card>
      <form action={formAction} className="contents">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
            <Cloud className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">Inserve API-koppeling</CardTitle>
              <Badge variant={sourceLabel.variant} className={cn("text-xs font-normal", sourceLabel.className)}>
                {sourceLabel.text}
              </Badge>
            </div>
            <CardDescription>
              Configureer hier de API-verbinding met Inserve voor factuur- en
              klantensynchronisatie. Alleen beheerders kunnen deze waarden
              aanpassen.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {state?.message && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-sm",
                state.success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              )}
              role="status"
            >
              {state.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>{state.message}</span>
            </div>
          )}

          {initial.source === "env" && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"
              role="note"
            >
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                De Inserve-verbinding is nu ingesteld via omgevingsvariabelen
                (<code className="rounded bg-amber-100 px-1">INSERVE_SUBDOMAIN</code> /{" "}
                <code className="rounded bg-amber-100 px-1">INSERVE_API_KEY</code>).
                Vul hieronder nieuwe waarden in om deze via de database te
                overschrijven. Laat de API-key leeg om de bestaande key te
                behouden.
              </span>
            </div>
          )}

          {initial.source === "db" && initial.hasApiKey && (
            <div
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs leading-relaxed text-emerald-800"
              role="note"
            >
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                De instellingen worden momenteel beheerd via de WebGUI (database).
                Wijzigingen hieronder overschrijven de huidige waarden. Laat de
                API-key leeg om de bestaande key te behouden.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="inserve-subdomain">Inserve subdomein</Label>
            <div className="flex items-stretch gap-2">
              <Input
                id="inserve-subdomain"
                name="subdomain"
                type="text"
                placeholder="jouwbedrijf"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                readOnly={readOnly}
                className={cn(readOnly && "bg-slate-50 text-slate-500")}
                autoComplete="off"
              />
              <span className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                .inserve.nl
              </span>
            </div>
            {state?.errors?.subdomain && (
              <p className="text-xs font-medium text-red-600">
                {state.errors.subdomain.join(" ")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="inserve-api-key">
                API-key
                {initial.hasApiKey && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    (huidig: <span className="font-mono">{initial.apiKeyMasked}</span>)
                  </span>
                )}
              </Label>
            </div>
            <div className="relative">
              <Input
                id="inserve-api-key"
                name="apiKey"
                type={showApiKey ? "text" : "password"}
                placeholder={
                  readOnly
                    ? "••••••••••••••••"
                    : initial.hasApiKey
                      ? "Laat leeg om huidige key te behouden, of vul een nieuwe key in"
                      : "Voer de Inserve API-key in"
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                readOnly={readOnly}
                className={cn("pr-11", readOnly && "bg-slate-50 text-slate-500")}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                tabIndex={-1}
                aria-label={showApiKey ? "Verberg API-key" : "Toon API-key"}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {state?.errors?.apiKey && (
              <p className="text-xs font-medium text-red-600">
                {state.errors.apiKey.join(" ")}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="border-t bg-slate-50/50 px-6 py-3">
          <div className="flex w-full flex-col gap-3">
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={isTestPending}
                className="mr-auto"
              >
                {isTestPending ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Testen…
                  </>
                ) : (
                  <>🔌 Verbinding testen</>
                )}
              </Button>
              {!readOnly ? (
                <>
                  <p className="text-xs text-slate-500">
                    Instellingen worden opgeslagen in de database (API-key als
                    geheim veld) en gelogd in het auditlogboek.
                  </p>
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    {isPending ? "Opslaan…" : "Opslaan"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Alleen <strong>Beheerders</strong> kunnen de Inserve API-instellingen
                  wijzigen.
                </p>
              )}
            </div>

            {connectionResult && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2.5 text-xs",
                  connectionResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-800"
                )}
                role="status"
              >
                {connectionResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="font-medium">
                    {connectionResult.ok
                      ? `Verbinding Inserve gelukt (${connectionResult.latencyMs ?? "-"}ms)`
                      : connectionResult.message ?? "Verbinding Inserve mislukt."}
                  </p>
                  {connectionResult.endpoint && (
                    <p className="mt-0.5 font-mono text-[11px] opacity-80">
                      GET {connectionResult.endpoint}
                      {connectionResult.status ? ` • HTTP ${connectionResult.status}` : ""}
                    </p>
                  )}
                  {!connectionResult.ok && connectionResult.error && (
                    <p className="mt-0.5 text-[11px] opacity-90">
                      Fout: {connectionResult.error}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
