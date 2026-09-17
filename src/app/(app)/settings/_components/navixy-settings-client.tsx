"use client";

import { useFormState } from "react-dom";
import { useEffect, useState, useTransition } from "react";
import {
  saveNavixySettingsAction,
  type NavixySettingsActionState,
  testNavixyConnectionAction,
  type ConnectionTestResult,
} from "../actions";
import type { NavixySettingsMasked } from "@/server/validators/setting";
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
import { Radio, Eye, EyeOff, CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavixySettingsFormProps {
  initial: NavixySettingsMasked;
  readOnly: boolean;
}

const initialState: NavixySettingsActionState = {};

export function NavixySettingsForm({ initial, readOnly }: NavixySettingsFormProps) {
  const [state, formAction, isPending] = useFormState(
    saveNavixySettingsAction,
    initialState
  );
  const [isTestPending, startTestTransition] = useTransition();
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);

  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [authMode, setAuthMode] = useState<"panel" | "user" | "direct">(
    initial.authMode ?? "panel"
  );
  const [panelLogin, setPanelLogin] = useState(initial.panelLogin ?? "");
  const [panelPassword, setPanelPassword] = useState("");
  const [showPanelPassword, setShowPanelPassword] = useState(false);
  const [userLogin, setUserLogin] = useState(initial.userLogin ?? "");
  const [userPassword, setUserPassword] = useState("");
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [directHash, setDirectHash] = useState("");
  const [showDirectHash, setShowDirectHash] = useState(false);
  const [createMethod, setCreateMethod] = useState<"create" | "clone" | "register">(
    initial.createMethod ?? "create"
  );
  const [defaultUserId, setDefaultUserId] = useState(
    initial.defaultUserId !== null && initial.defaultUserId !== undefined
      ? String(initial.defaultUserId)
      : ""
  );
  const [defaultTariffId, setDefaultTariffId] = useState(
    initial.defaultTariffId !== null && initial.defaultTariffId !== undefined
      ? String(initial.defaultTariffId)
      : ""
  );
  const [defaultCloneSourceTrackerId, setDefaultCloneSourceTrackerId] = useState(
    initial.defaultCloneSourceTrackerId !== null &&
    initial.defaultCloneSourceTrackerId !== undefined
      ? String(initial.defaultCloneSourceTrackerId)
      : ""
  );
  const [endpointPanelAuth, setEndpointPanelAuth] = useState(
    initial.endpoints?.panelAuth ?? "/panel/account/auth"
  );
  const [endpointUserAuth, setEndpointUserAuth] = useState(
    initial.endpoints?.userAuth ?? "/user/session/auth"
  );
  const [endpointPanelTracker, setEndpointPanelTracker] = useState(
    initial.endpoints?.panelTracker ?? "/panel/tracker"
  );
  const [endpointUserTracker, setEndpointUserTracker] = useState(
    initial.endpoints?.userTracker ?? "/user/tracker"
  );

  useEffect(() => {
    if (state?.success) {
      setPanelPassword("");
      setUserPassword("");
      setDirectHash("");
    }
  }, [state?.success]);

  const handleTestConnection = () => {
    setConnectionResult(null);
    startTestTransition(async () => {
      const result = await testNavixyConnectionAction();
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
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-50 text-violet-700">
            <Radio className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">Navixy API-koppeling</CardTitle>
              <Badge variant={sourceLabel.variant} className={cn("text-xs font-normal", sourceLabel.className)}>
                {sourceLabel.text}
              </Badge>
            </div>
            <CardDescription>
              Configureer hier de API-verbinding met Navixy voor tracker-gateway
              registratie en status. Alleen beheerders kunnen deze waarden
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
                De Navixy-verbinding is nu ingesteld via omgevingsvariabelen. Vul
                hieronder nieuwe waarden in om deze via de database te
                overschrijven. Laat wachtwoord/hash velden leeg om de huidige
                waarden te behouden.
              </span>
            </div>
          )}

          {initial.source === "db" &&
            (initial.hasPanelPassword ||
              initial.hasUserPassword ||
              initial.hasDirectHash) && (
              <div
                className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs leading-relaxed text-emerald-800"
                role="note"
              >
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  De instellingen worden momenteel beheerd via de WebGUI
                  (database). Laat wachtwoord/hash velden leeg om de huidige
                  waarden te behouden.
                </span>
              </div>
            )}

          <div className="space-y-2">
            <Label htmlFor="navixy-base-url">Basis-URL</Label>
            <Input
              id="navixy-base-url"
              name="baseUrl"
              type="text"
              placeholder="https://api.eu.navixy.com/v2"
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
            <Label htmlFor="navixy-auth-mode">Auth-modus</Label>
            <Select
              name="authMode"
              value={authMode}
              onValueChange={(v) => setAuthMode(v as "panel" | "user" | "direct")}
              disabled={readOnly}
            >
              <SelectTrigger id="navixy-auth-mode">
                <SelectValue placeholder="Kies auth-modus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="panel">Admin Panel (numeric panel login)</SelectItem>
                <SelectItem value="user">User account (user login)</SelectItem>
                <SelectItem value="direct">Directe sessie-hash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ====== PANEL MODE ====== */}
          {authMode === "panel" && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
              <div className="text-xs font-semibold text-slate-600 tracking-wide uppercase">
                Panel credentials
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="navixy-panel-login">Panel login (numeric)</Label>
                  <Input
                    id="navixy-panel-login"
                    name="panelLogin"
                    type="text"
                    placeholder="Bijv. 12345"
                    value={panelLogin ?? ""}
                    onChange={(e) => setPanelLogin(e.target.value)}
                    readOnly={readOnly}
                    className={cn(readOnly && "bg-slate-50 text-slate-500")}
                    autoComplete="off"
                  />
                  {state?.errors?.panelLogin && (
                    <p className="text-xs font-medium text-red-600">
                      {state.errors.panelLogin.join(" ")}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="navixy-panel-password">
                      Panel wachtwoord
                      {initial.hasPanelPassword && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (huidig:{" "}
                          <span className="font-mono">
                            {initial.panelPasswordMasked}
                          </span>
                          )
                        </span>
                      )}
                    </Label>
                  </div>
                  <div className="relative">
                    <Input
                      id="navixy-panel-password"
                      name="panelPassword"
                      type={showPanelPassword ? "text" : "password"}
                      placeholder={
                        readOnly
                          ? "••••••••"
                          : initial.hasPanelPassword
                            ? "Laat leeg om huidige te behouden"
                            : "Voer panel wachtwoord in"
                      }
                      value={panelPassword}
                      onChange={(e) => setPanelPassword(e.target.value)}
                      readOnly={readOnly}
                      className={cn("pr-11", readOnly && "bg-slate-50 text-slate-500")}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPanelPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      tabIndex={-1}
                      aria-label={
                        showPanelPassword
                          ? "Verberg panel wachtwoord"
                          : "Toon panel wachtwoord"
                      }
                    >
                      {showPanelPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {state?.errors?.panelPassword && (
                    <p className="text-xs font-medium text-red-600">
                      {state.errors.panelPassword.join(" ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ====== USER MODE ====== */}
          {authMode === "user" && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
              <div className="text-xs font-semibold text-slate-600 tracking-wide uppercase">
                User credentials
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="navixy-user-login">User login (e-mail)</Label>
                  <Input
                    id="navixy-user-login"
                    name="userLogin"
                    type="text"
                    placeholder="Bijv. user@jouwbedrijf.nl"
                    value={userLogin ?? ""}
                    onChange={(e) => setUserLogin(e.target.value)}
                    readOnly={readOnly}
                    className={cn(readOnly && "bg-slate-50 text-slate-500")}
                    autoComplete="off"
                  />
                  {state?.errors?.userLogin && (
                    <p className="text-xs font-medium text-red-600">
                      {state.errors.userLogin.join(" ")}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="navixy-user-password">
                      User wachtwoord
                      {initial.hasUserPassword && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (huidig:{" "}
                          <span className="font-mono">
                            {initial.userPasswordMasked}
                          </span>
                          )
                        </span>
                      )}
                    </Label>
                  </div>
                  <div className="relative">
                    <Input
                      id="navixy-user-password"
                      name="userPassword"
                      type={showUserPassword ? "text" : "password"}
                      placeholder={
                        readOnly
                          ? "••••••••"
                          : initial.hasUserPassword
                            ? "Laat leeg om huidige te behouden"
                            : "Voer user wachtwoord in"
                      }
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      readOnly={readOnly}
                      className={cn("pr-11", readOnly && "bg-slate-50 text-slate-500")}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowUserPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      tabIndex={-1}
                      aria-label={
                        showUserPassword
                          ? "Verberg user wachtwoord"
                          : "Toon user wachtwoord"
                      }
                    >
                      {showUserPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {state?.errors?.userPassword && (
                    <p className="text-xs font-medium text-red-600">
                      {state.errors.userPassword.join(" ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ====== DIRECT HASH MODE ====== */}
          {authMode === "direct" && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
              <div className="text-xs font-semibold text-slate-600 tracking-wide uppercase mb-2">
                Directe sessie-hash
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="navixy-direct-hash">
                    Sessie-hash (min. 16 tekens)
                    {initial.hasDirectHash && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (huidig:{" "}
                        <span className="font-mono">{initial.directHashMasked}</span>
                        )
                      </span>
                    )}
                  </Label>
                </div>
                <div className="relative">
                  <Input
                    id="navixy-direct-hash"
                    name="directHash"
                    type={showDirectHash ? "text" : "password"}
                    placeholder={
                      readOnly
                        ? "••••••••••••••••"
                        : initial.hasDirectHash
                          ? "Laat leeg om huidige te behouden"
                          : "Voer sessie-hash in (bijv. a1b2c3d4e5f6g7h8)"
                    }
                    value={directHash}
                    onChange={(e) => setDirectHash(e.target.value)}
                    readOnly={readOnly}
                    className={cn("pr-11 font-mono text-sm", readOnly && "bg-slate-50 text-slate-500")}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDirectHash((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    tabIndex={-1}
                    aria-label={
                      showDirectHash
                        ? "Verberg sessie-hash"
                        : "Toon sessie-hash"
                    }
                  >
                    {showDirectHash ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {state?.errors?.directHash && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.directHash.join(" ")}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="navixy-create-method">Tracker registratie methode</Label>
              <Select
                name="createMethod"
                value={createMethod}
                onValueChange={(v) =>
                  setCreateMethod(v as "create" | "clone" | "register")
                }
                disabled={readOnly}
              >
                <SelectTrigger id="navixy-create-method">
                  <SelectValue placeholder="Kies methode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="create">create (Platform API)</SelectItem>
                  <SelectItem value="clone">clone (kopieer bron-tracker)</SelectItem>
                  <SelectItem value="register">register (register_retry fallback)</SelectItem>
                </SelectContent>
              </Select>
              {state?.errors?.createMethod && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.createMethod.join(" ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="navixy-default-user-id">
                Default User ID (optioneel, numeriek)
              </Label>
              <Input
                id="navixy-default-user-id"
                name="defaultUserId"
                type="text"
                inputMode="numeric"
                placeholder="Bijv. 123"
                value={defaultUserId}
                onChange={(e) => setDefaultUserId(e.target.value)}
                readOnly={readOnly}
                className={cn(readOnly && "bg-slate-50 text-slate-500")}
                autoComplete="off"
              />
              {state?.errors?.defaultUserId && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.defaultUserId.join(" ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="navixy-default-tariff-id">
                Default Tariff ID (optioneel, numeriek)
              </Label>
              <Input
                id="navixy-default-tariff-id"
                name="defaultTariffId"
                type="text"
                inputMode="numeric"
                placeholder="Bijv. 7"
                value={defaultTariffId}
                onChange={(e) => setDefaultTariffId(e.target.value)}
                readOnly={readOnly}
                className={cn(readOnly && "bg-slate-50 text-slate-500")}
                autoComplete="off"
              />
              {state?.errors?.defaultTariffId && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.defaultTariffId.join(" ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="navixy-default-clone-id">
                Default Clone bron-tracker ID
                {createMethod !== "clone" && (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    (alleen bij methode "clone")
                  </span>
                )}
              </Label>
              <Input
                id="navixy-default-clone-id"
                name="defaultCloneSourceTrackerId"
                type="text"
                inputMode="numeric"
                placeholder="Bijv. 99"
                value={defaultCloneSourceTrackerId}
                onChange={(e) => setDefaultCloneSourceTrackerId(e.target.value)}
                readOnly={readOnly}
                disabled={createMethod !== "clone"}
                className={cn(
                  readOnly && "bg-slate-50 text-slate-500",
                  createMethod !== "clone" &&
                    "cursor-not-allowed opacity-60 bg-slate-50 text-slate-500"
                )}
                autoComplete="off"
              />
              {state?.errors?.defaultCloneSourceTrackerId && (
                <p className="text-xs font-medium text-red-600">
                  {state.errors.defaultCloneSourceTrackerId.join(" ")}
                </p>
              )}
            </div>
          </div>

          <details className="rounded-md border border-slate-200 bg-slate-50/50">
            <summary className="cursor-pointer list-none p-3 text-sm font-medium text-slate-700 hover:bg-slate-100/50 rounded-t-md">
              <span className="ml-1">⚙️ Geavanceerd: API endpoints</span>
            </summary>
            <div className="grid grid-cols-1 gap-4 p-4 pt-2 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="navixy-endpoint-panel-auth">Panel auth endpoint</Label>
                <Input
                  id="navixy-endpoint-panel-auth"
                  name="endpointPanelAuth"
                  type="text"
                  value={endpointPanelAuth}
                  onChange={(e) => setEndpointPanelAuth(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointPanelAuth && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointPanelAuth.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="navixy-endpoint-user-auth">User auth endpoint</Label>
                <Input
                  id="navixy-endpoint-user-auth"
                  name="endpointUserAuth"
                  type="text"
                  value={endpointUserAuth}
                  onChange={(e) => setEndpointUserAuth(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointUserAuth && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointUserAuth.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="navixy-endpoint-panel-tracker">Panel tracker endpoint</Label>
                <Input
                  id="navixy-endpoint-panel-tracker"
                  name="endpointPanelTracker"
                  type="text"
                  value={endpointPanelTracker}
                  onChange={(e) => setEndpointPanelTracker(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointPanelTracker && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointPanelTracker.join(" ")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="navixy-endpoint-user-tracker">User tracker endpoint</Label>
                <Input
                  id="navixy-endpoint-user-tracker"
                  name="endpointUserTracker"
                  type="text"
                  value={endpointUserTracker}
                  onChange={(e) => setEndpointUserTracker(e.target.value)}
                  readOnly={readOnly}
                  className={cn(readOnly && "bg-slate-50 text-slate-500")}
                />
                {state?.errors?.endpointUserTracker && (
                  <p className="text-xs font-medium text-red-600">
                    {state.errors.endpointUserTracker.join(" ")}
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
                    Wachtwoorden en sessie-hash worden opgeslagen als geheime velden
                    en gelogd in het auditlogboek.
                  </p>
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="bg-violet-600 text-white hover:bg-violet-700"
                  >
                    {isPending ? "Opslaan…" : "Opslaan"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Alleen <strong>Beheerders</strong> kunnen de Navixy API-instellingen
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
                      ? `Verbinding Navixy gelukt (${connectionResult.latencyMs ?? "-"}ms)`
                      : connectionResult.message ?? "Verbinding Navixy mislukt."}
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
