"use client";

import { useEffect, useState } from "react";
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
import { Loader2, Save, ChevronsUpDown, Eye, EyeOff, KeyRound } from "lucide-react";

type MaskedField = { value?: string; masked?: string; isSecret: boolean };

type Props = {
  providerKey: string;
  initialSettings: Record<string, MaskedField>;
  disabled: boolean;
  busy: boolean;
  onSaved: (
    values: Record<string, unknown>
  ) => Promise<{ ok: boolean; message: string; settings?: any }>;
};

function initialFor(key: string, s: Record<string, MaskedField>): string {
  const f = s[key];
  if (!f) return "";
  return f.value ?? f.masked ?? "";
}

function passwordIsMasked(v: string): boolean {
  return v.length > 0 && v.includes("•");
}

export function ProviderSettingsForm({
  providerKey,
  initialSettings,
  disabled,
  busy,
  onSaved,
}: Props) {
  const [baseUrl, setBaseUrl] = useState(initialFor("baseUrl", initialSettings));
  const [authMode, setAuthMode] = useState(
    initialFor("authMode", initialSettings) || "basic"
  );
  const [username, setUsername] = useState(initialFor("username", initialSettings));
  const [password, setPassword] = useState(initialFor("password", initialSettings));
  const [showPassword, setShowPassword] = useState(false);

  const [apiToken, setApiToken] = useState(initialFor("apiToken", initialSettings));
  const [clientId, setClientId] = useState(initialFor("clientId", initialSettings));
  const [clientSecret, setClientSecret] = useState(
    initialFor("clientSecret", initialSettings)
  );
  const [webhookSecret, setWebhookSecret] = useState(
    initialFor("webhookSecret", initialSettings)
  );

  const [resellerId, setResellerId] = useState(
    initialFor("resellerId", initialSettings)
  );
  const [defaultOfferId, setDefaultOfferId] = useState(
    initialFor("defaultOfferId", initialSettings)
  );
  const [defaultPlanId, setDefaultPlanId] = useState(
    initialFor("defaultPlanId", initialSettings)
  );
  const [defaultProductName, setDefaultProductName] = useState(
    initialFor("defaultProductName", initialSettings)
  );

  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [endpointLogin, setEndpointLogin] = useState(
    initialFor("endpoint.login", initialSettings) || "/auth/login"
  );
  const [endpointSims, setEndpointSims] = useState(
    initialFor("endpoint.sims", initialSettings) || "/sims"
  );
  const [endpointSimActivate, setEndpointSimActivate] = useState(
    initialFor("endpoint.simActivate", initialSettings) || "/sims/activate"
  );
  const [endpointSimDeactivate, setEndpointSimDeactivate] = useState(
    initialFor("endpoint.simDeactivate", initialSettings) || "/sims/deactivate"
  );
  const [endpointSimSuspend, setEndpointSimSuspend] = useState(
    initialFor("endpoint.simSuspend", initialSettings) || "/sims/suspend"
  );
  const [endpointSimUnsuspend, setEndpointSimUnsuspend] = useState(
    initialFor("endpoint.simUnsuspend", initialSettings) || "/sims/unsuspend"
  );
  const [endpointSubscribe, setEndpointSubscribe] = useState(
    initialFor("endpoint.subscribe", initialSettings) || "/sims/subscribe"
  );
  const [endpointUsage, setEndpointUsage] = useState(
    initialFor("endpoint.usage", initialSettings) || "/sims/usage"
  );
  const [endpointAsset, setEndpointAsset] = useState(
    initialFor("endpoint.asset", initialSettings) || "/sims/asset"
  );

  // Refresh state als initialSettings wijzigt (na save of page refresh)
  useEffect(() => {
    setBaseUrl(initialFor("baseUrl", initialSettings));
    setAuthMode(initialFor("authMode", initialSettings) || "basic");
    setUsername(initialFor("username", initialSettings));
    setPassword(initialFor("password", initialSettings));
    setApiToken(initialFor("apiToken", initialSettings));
    setClientId(initialFor("clientId", initialSettings));
    setClientSecret(initialFor("clientSecret", initialSettings));
    setWebhookSecret(initialFor("webhookSecret", initialSettings));
    setResellerId(initialFor("resellerId", initialSettings));
    setDefaultOfferId(initialFor("defaultOfferId", initialSettings));
    setDefaultPlanId(initialFor("defaultPlanId", initialSettings));
    setDefaultProductName(initialFor("defaultProductName", initialSettings));
    setEndpointLogin(
      initialFor("endpoint.login", initialSettings) || "/auth/login"
    );
    setEndpointSims(initialFor("endpoint.sims", initialSettings) || "/sims");
    setEndpointSimActivate(
      initialFor("endpoint.simActivate", initialSettings) || "/sims/activate"
    );
    setEndpointSimDeactivate(
      initialFor("endpoint.simDeactivate", initialSettings) ||
        "/sims/deactivate"
    );
    setEndpointSimSuspend(
      initialFor("endpoint.simSuspend", initialSettings) || "/sims/suspend"
    );
    setEndpointSimUnsuspend(
      initialFor("endpoint.simUnsuspend", initialSettings) || "/sims/unsuspend"
    );
    setEndpointSubscribe(
      initialFor("endpoint.subscribe", initialSettings) || "/sims/subscribe"
    );
    setEndpointUsage(
      initialFor("endpoint.usage", initialSettings) || "/sims/usage"
    );
    setEndpointAsset(
      initialFor("endpoint.asset", initialSettings) || "/sims/asset"
    );
  }, [initialSettings, providerKey]);

  const preservePassword = passwordIsMasked(password);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      baseUrl,
      authMode: authMode as any,
      username: username || null,
      password: preservePassword ? null : password || null,
      apiToken: passwordIsMasked(apiToken) ? null : apiToken || null,
      clientId: clientId || null,
      clientSecret: passwordIsMasked(clientSecret)
        ? null
        : clientSecret || null,
      webhookSecret: passwordIsMasked(webhookSecret)
        ? null
        : webhookSecret || null,
      resellerId: resellerId || null,
      defaultOfferId: defaultOfferId || null,
      defaultPlanId: defaultPlanId || null,
      defaultProductName: defaultProductName || null,
      endpoints: {
        login: endpointLogin || "/auth/login",
        sims: endpointSims || "/sims",
        simActivate: endpointSimActivate || "/sims/activate",
        simDeactivate: endpointSimDeactivate || "/sims/deactivate",
        simSuspend: endpointSimSuspend || "/sims/suspend",
        simUnsuspend: endpointSimUnsuspend || "/sims/unsuspend",
        subscribe: endpointSubscribe || "/sims/subscribe",
        usage: endpointUsage || "/sims/usage",
        asset: endpointAsset || "/sims/asset",
      },
      __preservePassword: preservePassword,
    };
    await onSaved(payload);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Configuratie &amp; API-inloggegevens
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor={`${providerKey}-baseUrl`}>Basis-URL *</Label>
          <Input
            id={`${providerKey}-baseUrl`}
            type="url"
            placeholder="https://api.voorbeeld.nl/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={disabled || busy}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-authMode`}>Authenticatiemethode</Label>
          <Select
            value={authMode}
            onValueChange={setAuthMode}
            disabled={disabled || busy}
          >
            <SelectTrigger id={`${providerKey}-authMode`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic Auth (gebruikersnaam + wachtwoord)</SelectItem>
              <SelectItem value="bearer">Bearer Token</SelectItem>
              <SelectItem value="apikey">API-sleutel</SelectItem>
              <SelectItem value="none">Geen (open API)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-username`}>Gebruikersnaam</Label>
          <Input
            id={`${providerKey}-username`}
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={disabled || busy}
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${providerKey}-password`}>
              Wachtwoord / API-sleutel
            </Label>
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              tabIndex={-1}
            >
              {showPassword ? (
                <><EyeOff className="h-3 w-3" /> Verbergen</>
              ) : (
                <><Eye className="h-3 w-3" /> Tonen</>
              )}
            </button>
          </div>
          <div className="flex">
            <Input
              id={`${providerKey}-password`}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder={
                preservePassword
                  ? "• • • •  (laat leeg om ongewijzigd te laten)"
                  : undefined
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled || busy}
              className="font-mono"
            />
          </div>
          {preservePassword && (
            <div className="text-xs text-muted-foreground">
              Het wachtwoord is opgeslagen. Laat dit veld leeg om het te
              behouden, of typ een nieuw wachtwoord om het te overschrijven.
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-apiToken`}>API-token</Label>
          <Input
            id={`${providerKey}-apiToken`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            disabled={disabled || busy}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-webhookSecret`}>Webhook secret</Label>
          <Input
            id={`${providerKey}-webhookSecret`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            disabled={disabled || busy}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-clientId`}>Client ID</Label>
          <Input
            id={`${providerKey}-clientId`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={disabled || busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-clientSecret`}>Client secret</Label>
          <Input
            id={`${providerKey}-clientSecret`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={disabled || busy}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-resellerId`}>Reseller ID</Label>
          <Input
            id={`${providerKey}-resellerId`}
            value={resellerId}
            onChange={(e) => setResellerId(e.target.value)}
            disabled={disabled || busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-defaultOfferId`}>Default offer ID</Label>
          <Input
            id={`${providerKey}-defaultOfferId`}
            value={defaultOfferId}
            onChange={(e) => setDefaultOfferId(e.target.value)}
            disabled={disabled || busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-defaultPlanId`}>Default plan ID</Label>
          <Input
            id={`${providerKey}-defaultPlanId`}
            value={defaultPlanId}
            onChange={(e) => setDefaultPlanId(e.target.value)}
            disabled={disabled || busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${providerKey}-defaultProductName`}>Default productnaam</Label>
          <Input
            id={`${providerKey}-defaultProductName`}
            value={defaultProductName}
            onChange={(e) => setDefaultProductName(e.target.value)}
            disabled={disabled || busy}
          />
        </div>
      </div>

      <details
        open={endpointsOpen}
        onToggle={(e) =>
          setEndpointsOpen((e.currentTarget as HTMLDetailsElement).open)
        }
        className="rounded-md border bg-muted/30"
      >
        <summary
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium list-none"
          tabIndex={-1}
        >
          <span>API-endpoints (geavanceerd)</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </summary>
        <div className="p-3 space-y-3 border-t">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Login endpoint</Label>
              <Input
                value={endpointLogin}
                onChange={(e) => setEndpointLogin(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sims endpoint</Label>
              <Input
                value={endpointSims}
                onChange={(e) => setEndpointSims(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Activate endpoint</Label>
              <Input
                value={endpointSimActivate}
                onChange={(e) => setEndpointSimActivate(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Deactivate endpoint</Label>
              <Input
                value={endpointSimDeactivate}
                onChange={(e) => setEndpointSimDeactivate(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Suspend endpoint</Label>
              <Input
                value={endpointSimSuspend}
                onChange={(e) => setEndpointSimSuspend(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unsuspend endpoint</Label>
              <Input
                value={endpointSimUnsuspend}
                onChange={(e) => setEndpointSimUnsuspend(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subscribe endpoint</Label>
              <Input
                value={endpointSubscribe}
                onChange={(e) => setEndpointSubscribe(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Usage endpoint</Label>
              <Input
                value={endpointUsage}
                onChange={(e) => setEndpointUsage(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label>Asset endpoint</Label>
              <Input
                value={endpointAsset}
                onChange={(e) => setEndpointAsset(e.target.value)}
                disabled={disabled || busy}
              />
            </div>
          </div>
        </div>
      </details>

      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={disabled || busy}
          className="w-full sm:w-auto"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Instellingen opslaan
        </Button>
      </div>
    </form>
  );
}
