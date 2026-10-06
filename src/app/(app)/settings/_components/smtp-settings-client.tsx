"use client";

import { useFormState } from "react-dom";
import { useState, useTransition } from "react";
import {
  saveSmtpSettingsAction,
  type SmtpSettingsActionState,
  testSmtpSendAction,
  type ConnectionTestResult,
} from "../actions";
import type { SmtpSettingsMasked } from "@/server/validators/setting";
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
  Mail,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Info,
  Loader2,
  Send,
} from "lucide-react";

interface SmtpSettingsFormProps {
  initial: SmtpSettingsMasked | null;
  readOnly: boolean;
}

const initialState: SmtpSettingsActionState = {};

function StatusBadge({ configured, source }: { configured: boolean; source?: string | null }) {
  if (configured) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Geconfigureerd{source ? ` (${source})` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-slate-50 text-slate-600">
      <AlertCircle className="mr-1 h-3 w-3" />
      Niet ingesteld
    </Badge>
  );
}

export function SmtpSettingsForm({ initial, readOnly }: SmtpSettingsFormProps) {
  const [state, formAction, isPending] = useFormState(
    saveSmtpSettingsAction,
    initialState
  );
  const [isTestPending, startTestTransition] = useTransition();
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const mask = initial ?? {
    host: "",
    port: 0,
    secure: false,
    user: "",
    passwordMasked: "••••••••",
    hasPassword: false,
    from: "",
    configured: false,
    source: "none" as const,
  };

  function runTest() {
    setTestResult(null);
    startTestTransition(async () => {
      const r = await testSmtpSendAction();
      setTestResult(r);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-50 text-amber-700">
          <Mail className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Notificaties</CardTitle>
              <CardDescription>
                SMTP-configuratie voor e-mailmeldingen (datadrempels, etc.)
              </CardDescription>
            </div>
            <StatusBadge configured={mask.configured} source={mask.source} />
          </div>
          {state?.message ? (
            <div
              className={`mt-3 flex items-start gap-2 rounded-md p-3 text-sm ${
                state.success
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
              role="status"
              aria-live="polite"
            >
              {state.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>{state.message}</div>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <form action={formAction}>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="smtp-host">SMTP-host</Label>
              <Input
                id="smtp-host"
                name="host"
                defaultValue={mask.host}
                placeholder="smtp.voorbeeld.nl"
                readOnly={readOnly}
              />
              {state?.errors?.host ? (
                <p className="text-xs text-red-600">{state.errors.host.join(", ")}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Poort</Label>
              <Input
                id="smtp-port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={mask.port || 587}
                readOnly={readOnly}
              />
              {state?.errors?.port ? (
                <p className="text-xs text-red-600">{state.errors.port.join(", ")}</p>
              ) : null}
            </div>
          </div>

          <label
            htmlFor="smtp-secure"
            className="flex items-center gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer"
          >
            <input
              id="smtp-secure"
              name="secure"
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              defaultChecked={mask.secure}
              disabled={readOnly}
            />
            <div>
              <div className="text-sm font-medium">SSL/TLS (poort 465)</div>
              <div className="text-xs text-slate-500">
                Veel providers gebruiken STARTTLS (niet aangevinkt) op poort 587.
                Vink dit aan voor impliciete SSL op poort 465.
              </div>
            </div>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Gebruikersnaam (optioneel)</Label>
              <Input
                id="smtp-user"
                name="smtpUser"
                autoComplete="off"
                defaultValue={mask.user ?? ""}
                placeholder="user@domein.nl"
                readOnly={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="smtp-password">
                  Wachtwoord
                  {mask.hasPassword ? (
                    <span className="ml-2 text-[10px] text-slate-500">
                      (laten legen om bestaande te behouden)
                    </span>
                  ) : null}
                </Label>
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <>
                      <EyeOff className="h-3 w-3" />
                      Verbergen
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      Tonen
                    </>
                  )}
                </button>
              </div>
              <Input
                id="smtp-password"
                name="smtpPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={mask.hasPassword ? mask.passwordMasked : "••••••••"}
                readOnly={readOnly}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smtp-from">Afzender e-mail</Label>
            <Input
              id="smtp-from"
              name="fromEmail"
              type="email"
              defaultValue={mask.from || "noreply@nexus.local"}
              placeholder="noreply@nexus.nl"
              readOnly={readOnly}
            />
            {state?.errors?.from ? (
              <p className="text-xs text-red-600">{state.errors.from.join(", ")}</p>
            ) : null}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Deze instellingen kunnen ook via omgevingsvariabelen worden
              opgegeven: <code>SMTP_HOST</code>, <code>SMTP_PORT</code>,{" "}
              <code>SMTP_SECURE</code>, <code>SMTP_USER</code>,{" "}
              <code>SMTP_PASSWORD</code>, <code>SMTP_FROM</code>.
            </div>
          </div>

          {testResult ? (
            <div
              className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                testResult.ok
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
              role="status"
              aria-live="polite"
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>{testResult.message}</div>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={runTest}
            disabled={readOnly || isPending || isTestPending}
            className="gap-2"
            aria-busy={isTestPending}
          >
            {isTestPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Verstuur test-e-mail
          </Button>
          <Button
            type="submit"
            disabled={readOnly || isPending || isTestPending}
            className="gap-2"
            aria-busy={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Opslaan
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
