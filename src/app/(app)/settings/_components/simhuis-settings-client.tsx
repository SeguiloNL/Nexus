"use client";

import { useFormState } from "react-dom";
import { useEffect, useState, useTransition } from "react";
import {
  saveSimhuisSettingsAction,
  type SimhuisSettingsActionState,
  testSimhuisConnectionAction,
  type ConnectionTestResult,
} from "../actions";
import type { SimhuisSettingsMasked } from "@/server/validators/setting";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Eye, EyeOff, CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SimhuisSettingsFormProps {
  initial: SimhuisSettingsMasked;
  readOnly: boolean;
}

const initialState: SimhuisSettingsActionState = {};

export function SimhuisSettingsForm({ initial, readOnly }: SimhuisSettingsFormProps) {
  const [state, formAction, isPending] = useFormState(
    saveSimhuisSettingsAction,
    initialState
  );
  const [isTestPending, startTestTransition] = useTransition();
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [authMode, setAuthMode] = useState<"basic" | "bearer">(initial.authMode ?? "basic");
  const [username, setUsername] = useState(initial.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resellerId, setResellerId] = useState(initial.resellerId ?? "");
  const [defaultOfferId, setDefaultOfferId] = useState(initial.defaultOfferId ?? "");
  const [defaultPlanId, setDefaultPlanId] = useState(initial.defaultPlanId ?? "");
  const [defaultProductName, setDefaultProductName] = useState(initial.defaultProductName ?? "");
  const [endpointLogin, setEndpointLogin] = useState(initial.endpoints?.login ?? "/auth/login");
  const [endpointSims, setEndpointSims] = useState(initial.endpoints?.sims ?? "/sims");
  const [endpointSimActivate, setEndpointSimActivate] = useState(
    initial.endpoints?.simActivate ?? "/activate"
  );
  const [endpointSimDeactivate, setEndpointSimDeactivate] = useState(
    initial.endpoints?.simDeactivate ?? "/deactivate"
  );

  useEffect(() => {
    if (state?.success) {
      setPassword("");
    }
  }, [state?.success]);

  const handleTestConnection = () => {
    setConnectionResult(null);
    startTestTransition(async () => {
      const result = await testSimhuisConnectionAction();
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
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <Globe className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">Simhuis API-koppeling</CardTitle>
              <Badge variant={sourceLabel.variant} className={cn("text-xs font-normal", sourceLabel.className)}>
                {sourceLabel.text}
              </Badge>
            </div>
            <CardDescription>
              Configureer hier de API-verbinding met Simhuis voor SIM-activatie en
              -status. Alleen beheerders kunnen deze waarden aanpassen.
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
                De Simhuis-verbinding is nu ingesteld via omgevingsvariabelen. Vul
                hieronder nieuwe waarden in om deze via de database te
                overschrijven. Laat het wachtwoord leeg om de huidige waarde te
                behouden.
              </span>
            </div>
          )}

          {initial.source === "db" && initial.hasPassword && (
            <div
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs leading-relaxed text-emerald-800"
              role="note"
            >
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                De instellingen worden momenteel beheerd via de WebGUI (database).
                Laat het wachtwoord leeg om het huidige wachtwoord te behouden.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="simhuis-base-url">Basis-URL</Label>
            <Input
              id="simhuis-base-url"
              name="baseUrl"
              type="text"
              placeholder="https://apicontrolcenter.com/v3"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              readOnly={readOnly}
              className={cn(readOnly && "bg-slate-50 text-slate-500")}
              autoComplete="off"
            />
            {state?.errors?.baseUrl && (
              <p className="text-xs font-medium text-red-600">
                {state.errors.baseUrl.join(" ")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="simhuis-auth-mode">Auth-methode</Label>
            <Select
              name="authMode"
              value={authMode}
              onValueChange={(v) => setAuthMode(v as "basic" | "bearer")}
              disabled={readOnly}
            >
              <SelectTrigger id="simhuis-auth-mode">
                <SelectValue placeholder="Kies auth-methode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">HTTP Basic Auth</SelectItem>
                <SelectItem value="bearer">Bearer Token (inloggen via /auth/login)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="simhuis-username">Gebruikersnaam</Label>
              <Input
                id="simhuis-username"
                name="username"
                type="text"
                placeholder="jouw_username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                readOnly={readOnly}
                className={cn(readOnly && "bg-slate-50 text-slate-500")}
                autoComplete="off"
              />
              {state?.errors?.username && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.username.join(" ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="simhuis-password">
                  Wachtwoord
                  {initial.hasPassword && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      (huidig:{" "}
                      <span className="font-mono">{initial.passwordMasked}</span>)
                    </span>
                  )}
                </Label>
              </div>
              <div className="relative">
                <Input
                  id="simhuis-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={
                    readOnly
                      ? "••••••••"
                      : initial.hasPassword
                        ? "Laat leeg om huidige wachtwoord te behouden"
                        : "Voer het Simhuis wachtwoord in"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  readOnly={readOnly}
                  className={cn("pr-11", readOnly && "bg-slate-50 text-slate-500")}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  tabIndex={-1}
                  aria-label={showPassword ? "Verberg wachtwoord" : "Toon wachtwoord"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {state?.errors?.password && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.password.join(" ")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="simhuis-reseller-id">Reseller ID (optioneel)</Label>
            <Input
              id="simhuis-reseller-id"
              name="resellerId"
              type="text"
              placeholder="Bijv. 12345"
              value={resellerId ?? ""}
              onChange={(e) => setResellerId(e.target.value)}
              readOnly={readOnly}
              className={cn(readOnly && "bg-slate-50 text-slate-500")}
              autoComplete="off"
            />
            {state?.errors?.resellerId && (
              <p className="text-xs font-medium text-red-600">
                {state.errors.resellerId.join(" ")}
              </p>
            )}
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <div className="rounded-md bg-amber-200/60 px-2 py-1 text-[11px] font-semibold tracking-wide text-amber-900 uppercase">
                SIM Product
              </div>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  Standaard Simhuis-product voor nieuwe SIM-activaties
                </p>
                <p className="text-xs text-amber-800/80 mt-0.5">
                  Bij elke SIM-activering voor een tracker wordt automatisch dit product
                  (offer/plan) doorgestuurd naar Simhuis. Productnaam is alleen voor
                  eigen referentie.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="simhuis-default-offer-id">
                  Default Offer ID <span className="text-[10px] text-slate-500 font-normal">(offer_id)</span>
                </Label>
                <Input
                  id="simhuis-default-offer-id"
                  name="defaultOfferId"
                  type="text"
                  placeholder="Bijv. SEG-OFFER-123 of 1001"
                  value={defaultOfferId ?? ""}
                  onChange={(e) => setDefaultOfferId(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                  autoComplete="off"
                />
                {state?.errors?.defaultOfferId && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.defaultOfferId.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="simhuis-default-plan-id">
                  Default Plan ID <span className="text-[10px] text-slate-500 font-normal">(plan_id)</span>
                </Label>
                <Input
                  id="simhuis-default-plan-id"
                  name="defaultPlanId"
                  type="text"
                  placeholder="Bijv. SEG-PLAN-456 of 2002"
                  value={defaultPlanId ?? ""}
                  onChange={(e) => setDefaultPlanId(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                  autoComplete="off"
                />
                {state?.errors?.defaultPlanId && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.defaultPlanId.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="simhuis-default-product-name">
                  Productnaam <span className="text-[10px] text-slate-500 font-normal">(referentie)</span>
                </Label>
                <Input
                  id="simhuis-default-product-name"
                  name="defaultProductName"
                  type="text"
                  placeholder="Bijv. Seguilo B.V. ROPD LR 0.40 OU per MB 0.0029 EUR SMS"
                  value={defaultProductName ?? ""}
                  onChange={(e) => setDefaultProductName(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                  autoComplete="off"
                />
                {state?.errors?.defaultProductName && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.defaultProductName.join(" ")}
                  </p>
                )}
              </div>
            </div>
          </div>

          <details className="rounded-md border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer list-none p-3 text-sm font-medium text-slate-700 hover:bg-slate-100/50 rounded-t-md">
              <span className="ml-1">⚙️ Geavanceerd: API endpoints</span>
            </summary>
            <div className="grid grid-cols-1 gap-4 p-4 pt-2 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="simhuis-endpoint-login">Login endpoint</Label>
                <Input
                  id="simhuis-endpoint-login"
                  name="endpointLogin"
                  type="text"
                  value={endpointLogin}
                  onChange={(e) => setEndpointLogin(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointLogin && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointLogin.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="simhuis-endpoint-sims">SIMs overzicht endpoint</Label>
                <Input
                  id="simhuis-endpoint-sims"
                  name="endpointSims"
                  type="text"
                  value={endpointSims}
                  onChange={(e) => setEndpointSims(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointSims && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointSims.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="simhuis-endpoint-activate">SIM activeren endpoint</Label>
                <Input
                  id="simhuis-endpoint-activate"
                  name="endpointSimActivate"
                  type="text"
                  value={endpointSimActivate}
                  onChange={(e) => setEndpointSimActivate(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointSimActivate && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointSimActivate.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="simhuis-endpoint-deactivate">SIM deactiveren endpoint</Label>
                <Input
                  id="simhuis-endpoint-deactivate"
                  name="endpointSimDeactivate"
                  type="text"
                  value={endpointSimDeactivate}
                  onChange={(e) => setEndpointSimDeactivate(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointSimDeactivate && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointSimDeactivate.join(" ")}
                  </p>
                )}
              </div>
            </div>
          </details>
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
                    Wachtwoord wordt opgeslagen als geheim veld en gelogd in het
                    auditlogboek.
                  </p>
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="bg-teal-600 text-white hover:bg-teal-700"
                  >
                    {isPending ? "Opslaan…" : "Opslaan"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Alleen <strong>Beheerders</strong> kunnen de Simhuis API-instellingen
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
                      ? `Verbinding Simhuis gelukt (${connectionResult.latencyMs ?? "-"}ms)`
                      : connectionResult.message ?? "Verbinding Simhuis mislukt."}
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
