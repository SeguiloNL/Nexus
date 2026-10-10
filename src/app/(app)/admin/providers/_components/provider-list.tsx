"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, XCircle, Wifi, WifiOff, PlugZap, ShieldCheck, Shield, Loader2, RefreshCw, ZapOff } from "lucide-react";
import {
  activateProviderAction,
  deactivateProviderAction,
  testConnectionAction,
  saveProviderSettingsAction,
  type ProviderListItem,
} from "../actions";
import { ProviderSettingsForm } from "./provider-settings-form";
import { toast } from "sonner";

type Props = {
  initialProviders: ProviderListItem[];
  canEdit: boolean;
};

type StatusPill = {
  label: string;
  icon: any;
  className: string;
};

function pillsFor(provider: ProviderListItem): StatusPill[] {
  const out: StatusPill[] = [];
  out.push({
    label: provider.moduleAvailable ? "Geregistreerd" : "Module onbekend",
    icon: provider.moduleAvailable ? CheckCircle2 : XCircle,
    className: provider.moduleAvailable
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
      : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
  });
  out.push({
    label: provider.isConfigured ? "Geconfigureerd" : "Te configureren",
    icon: provider.isConfigured ? ShieldCheck : Shield,
    className: provider.isConfigured
      ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  });
  out.push({
    label: provider.isActivated ? "Actief" : "Inactief",
    icon: provider.isActivated ? PlugZap : ZapOff,
    className: provider.isActivated
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  });
  out.push({
    label: provider.isConnected ? "Verbonden" : "Verbinding onbekend",
    icon: provider.isConnected ? Wifi : WifiOff,
    className: provider.isConnected
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  });
  return out;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("nl-NL");
  } catch {
    return "—";
  }
}

export function ProviderManager({ initialProviders, canEdit }: Props) {
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const router = useRouter();

  async function wrap(
    id: string,
    fn: () => Promise<{ ok: boolean; message: string }>
  ) {
    try {
      setIsBusy(id);
      const res = await fn();
      if (res.ok) {
        toast.success(res.message, { description: res.message });
        router.refresh();
      } else {
        toast.error("Actie mislukt", { description: res.message });
      }
      return res;
    } catch (e: any) {
      const msg =
        e?.message && typeof e.message === "string"
          ? e.message
          : "Er is een onverwachte fout opgetreden.";
      toast.error("Onverwachte fout", { description: msg });
      return { ok: false, message: "Onverwachte fout" };
    } finally {
      setIsBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {initialProviders.map((p) => (
        <Card
          key={p.providerKey}
          className={
            p.providerKey === "simhuis"
              ? "border-emerald-300 shadow-sm"
              : undefined
          }
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{p.displayName}</CardTitle>
                  {p.providerKey === "simhuis" && (
                    <Badge variant="secondary" className="text-xs">
                      Standaard
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1">
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    providerKey: {p.providerKey}
                  </code>
                </CardDescription>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {pillsFor(p).map((pill, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className={`${pill.className} border-transparent`}
                  >
                    <pill.icon className="h-3 w-3 mr-1" />
                    {pill.label}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground tracking-wide">
                  Laatste controle
                </div>
                <div className="font-medium">
                  {formatDate(p.lastConnectionCheckedAt)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground tracking-wide">
                  Latentie
                </div>
                <div className="font-medium">
                  {p.lastConnectionLatencyMs != null
                    ? `${p.lastConnectionLatencyMs} ms`
                    : "—"}
                </div>
              </div>
              {p.lastConnectionErrorSafe && (
                <div className="col-span-2">
                  <div className="text-xs uppercase text-muted-foreground tracking-wide">
                    Laatste fout (veilig)
                  </div>
                  <div className="font-medium text-sm text-amber-700 dark:text-amber-300 break-words">
                    {p.lastConnectionErrorSafe}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs uppercase text-muted-foreground tracking-wide mb-2">
                Ondersteunde functies
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.capabilities.length === 0 ? (
                  <Badge variant="outline" className="text-xs">
                    Geen capabilities bekend
                  </Badge>
                ) : (
                  p.capabilities.map((cap) => (
                    <Badge
                      key={cap}
                      variant="secondary"
                      className="text-xs font-mono"
                    >
                      {cap}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <ProviderSettingsForm
              providerKey={p.providerKey}
              initialSettings={p.settings}
              disabled={!canEdit}
              onSaved={async (values) => {
                const res = await wrap(
                  `save-${p.providerKey}`,
                  () => saveProviderSettingsAction(p.providerKey, values)
                );
                return res as any;
              }}
              busy={isBusy === `save-${p.providerKey}`}
            />
          </CardContent>

          <CardFooter className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={
                !canEdit ||
                !p.capabilities.includes("testConnection") ||
                isBusy === `test-${p.providerKey}`
              }
              onClick={() =>
                wrap(`test-${p.providerKey}`, () =>
                  testConnectionAction(p.providerKey)
                )
              }
            >
              {isBusy === `test-${p.providerKey}` ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Verbinding testen
            </Button>

            {p.isActivated ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  !canEdit ||
                  p.providerKey === "simhuis" ||
                  isBusy === `deact-${p.providerKey}`
                }
                onClick={async () => {
                  const ok = window.confirm(
                    [
                      `Weet u zeker dat u leverancier “${p.displayName}” wilt deactiveren?`,
                      "",
                      "• Bestaande SIM-kaarten en gegevens worden NIET verwijderd.",
                      "• Nieuwe mutaties (activeren, opschorten, abonneren, purge) worden geblokkeerd.",
                      "• Lopende achtergrondtaken voor deze leverancier worden overgeslagen.",
                      "• Binnenkomende webhooks retourneren HTTP 403.",
                      "",
                      "Deze actie is terug te draaien via “Activeren”.",
                    ].join("\n")
                  );
                  if (!ok) return;
                  await wrap(`deact-${p.providerKey}`, () =>
                    deactivateProviderAction(p.providerKey)
                  );
                }}
              >
                {isBusy === `deact-${p.providerKey}` ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ZapOff className="h-4 w-4 mr-2" />
                )}
                Deactiveren
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!canEdit || !p.isConfigured || isBusy === `act-${p.providerKey}`}
                onClick={() =>
                  wrap(`act-${p.providerKey}`, () =>
                    activateProviderAction(p.providerKey)
                  )
                }
              >
                {isBusy === `act-${p.providerKey}` ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4 mr-2" />
                )}
                Activeren
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
