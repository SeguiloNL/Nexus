import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Info, Database, Shield, Globe } from "lucide-react";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "setting")) {
    if (!canUserRole(session.user.role, "edit", "setting")) {
      throw new PermissionError("Je mag geen instellingen bekijken.");
    }
  }

  const canEdit = canUserRole(session.user.role, "edit", "setting");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Instellingen</h1>
        <p className="text-sm text-slate-500">
          Applicatie-instellingen, SSO, e-mail en database-configuratie.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

        <Card>
          <CardHeader className="flex-row items-start gap-3 space-y-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Notificaties</CardTitle>
              <CardDescription>
                E-mail en webhook configuratie
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">SMTP-host</span>
              <Badge variant="outline" className="bg-slate-50 text-slate-600">
                Niet ingesteld
              </Badge>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">E-mail afzender</span>
              <span className="font-mono text-xs">noreply@nexus.local</span>
            </div>
            <div className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-slate-500">Webhook URL</span>
              <Badge variant="outline" className="bg-slate-50 text-slate-600">
                Niet ingesteld
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
