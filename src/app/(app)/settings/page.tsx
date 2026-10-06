import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Info, Database, Shield, Globe } from "lucide-react";
import { InserveSettingsForm } from "./_components/inserve-settings-client";
import { SimhuisSettingsForm } from "./_components/simhuis-settings-client";
import { NavixySettingsForm } from "./_components/navixy-settings-client";
import { SmtpSettingsForm } from "./_components/smtp-settings-client";
import { SyncScheduleCard } from "./_components/sync-schedule-client";
import {
  getInserveSettingsMasked,
  getSimhuisSettingsMasked,
  getNavixySettingsMasked,
  getSmtpSettingsMasked,
} from "@/server/services/app-setting.service";
import { getSyncSchedulesAction } from "./actions";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "setting")) {
    if (!canUserRole(user.permissions, "edit", "setting")) {
      redirectForbidden();
    }
  }

  const canEdit = canUserRole(user.permissions, "edit", "setting");
  const [inserveSettings, simhuisSettings, navixySettings, smtpSettings, syncState] =
    await Promise.all([
      getInserveSettingsMasked(),
      getSimhuisSettingsMasked(),
      getNavixySettingsMasked(),
      getSmtpSettingsMasked(),
      getSyncSchedulesAction(),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Instellingen</h1>
        <p className="text-sm text-slate-500">
          Applicatie-instellingen, API-koppelingen, SSO, e-mail en database-configuratie.
        </p>
      </div>

      <InserveSettingsForm initial={inserveSettings} readOnly={!canEdit} />
      <SimhuisSettingsForm initial={simhuisSettings} readOnly={!canEdit} />
      <NavixySettingsForm initial={navixySettings} readOnly={!canEdit} />
      <SmtpSettingsForm initial={smtpSettings} readOnly={!canEdit} />

      <SyncScheduleCard initialState={syncState} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-purple-50 text-purple-700">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Systeeminformatie</CardTitle>
              <CardDescription>Versie en omgeving</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Applicatie</span>
              <span className="font-medium">Nexus</span>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Versie</span>
              <Badge variant="outline">v0.1.0</Badge>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Omgeving</span>
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                Development
              </Badge>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Basis-URL</span>
              <span className="font-mono text-xs">http://localhost:3001</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Beveiliging</CardTitle>
              <CardDescription>
                Wachtwoord- en sessie-instellingen
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Min. wachtwoordlengte</span>
              <span className="font-medium">8 tekens</span>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Hash-algoritme</span>
              <Badge variant="outline">bcrypt (cost 10)</Badge>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Sessie-duur</span>
              <span className="font-medium">30 dagen (standaard)</span>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">2FA</span>
              <Badge variant="outline" className="bg-slate-50 text-slate-600">
                Niet geconfigureerd
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Database</CardTitle>
              <CardDescription>PostgreSQL 16</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Engine</span>
              <span className="font-medium">PostgreSQL 16.x</span>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Schema</span>
              <Badge variant="outline">public</Badge>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Migrations</span>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                2 applied
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {!canEdit ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Alleen <strong>Beheerders</strong> kunnen instellingen wijzigen.
        </div>
      ) : null}
    </div>
  );
}
