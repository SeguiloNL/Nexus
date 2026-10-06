import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDateLong } from "@/lib/formatters";
import { collectUserCustomerIds, hasMinRole } from "@/lib/rbac";
import { getMyNotificationSettingsAction } from "./actions";
import { NotificationSettingsForm } from "./_components/notification-settings-form";
import {
  UserCircle2,
  Mail,
  Shield,
  Building2,
  Clock,
  BellRing,
} from "lucide-react";
import { RoleScope, UserRole } from "@/types/enums";

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ADMIN: "default",
  EMPLOYEE: "secondary",
  VIEWER: "outline",
};

function resolveRoleDisplay(
  legacyRole: string | null | undefined,
  roleName: string | null | undefined,
  scopeName: string | null | undefined
): string {
  if (roleName) {
    return scopeName ? `${roleName} (${scopeName.toLowerCase()})` : roleName;
  }
  if (!legacyRole) return "Gebruiker";
  const map: Record<string, string> = {
    ADMIN: "Beheerder",
    EMPLOYEE: "Medewerker",
    VIEWER: "Alleen-lezen",
  };
  return map[legacyRole] ?? legacyRole;
}

export default async function ProfilePage() {
  const user = await requireUser();

  const [userDb, customerIds, customers, notifySettings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        roleObj: { select: { id: true, name: true, scope: true, isSystem: true } },
      },
    }),
    collectUserCustomerIds(user.id).catch(() => user.customerIds ?? []),
    (async () => {
      const ids = await collectUserCustomerIds(user.id).catch(() => user.customerIds ?? []);
      if (!ids || ids.length === 0) return [] as { id: string; companyName: string; customerNumber: string | null }[];
      return prisma.customer.findMany({
        where: { id: { in: ids } },
        select: { id: true, companyName: true, customerNumber: true },
        orderBy: { companyName: "asc" },
      });
    })(),
    getMyNotificationSettingsAction(),
  ]);

  if (!userDb) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-600">Uw account kon niet worden geladen.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const scopeName =
    userDb.roleObj?.scope ?? (user.roleScope as RoleScope | undefined) ?? null;
  const roleLabel = resolveRoleDisplay(
    userDb.role,
    userDb.roleObj?.name ?? user.roleName ?? null,
    scopeName
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <UserCircle2 className="h-6 w-6 text-slate-500" />
          <h1 className="text-xl font-semibold">Mijn Profiel</h1>
        </div>
        <p className="text-sm text-slate-500">
          Beheer uw accountgegevens en notificatie-instellingen.
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">Algemeen</TabsTrigger>
          <TabsTrigger value="notifications">
            <BellRing className="mr-2 h-3.5 w-3.5" />
            Notificaties
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-slate-500" />
                  Account
                </CardTitle>
                <CardDescription>Identificatie en toegangsrechten.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Naam</span>
                  <span className="font-medium">{userDb.name}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    E-mail
                  </span>
                  <span className="font-medium">{userDb.email}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Rol</span>
                  <Badge variant={ROLE_VARIANT[userDb.role] ?? "outline"}>
                    {roleLabel}
                  </Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Account</span>
                  <Badge variant={userDb.isActive ? "default" : "destructive"}>
                    {userDb.isActive ? "Actief" : "Gedeactiveerd"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-slate-500" />
                  Activiteit
                </CardTitle>
                <CardDescription>Wanneer is het account voor het laatst gebruikt.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Laatste login</span>
                  <span className="font-medium">
                    {userDb.lastLoginAt ? formatDateLong(userDb.lastLoginAt) : "—"}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Aangemaakt op</span>
                  <span className="font-medium">
                    {formatDateLong(userDb.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  Klant-scope
                </CardTitle>
                <CardDescription>
                  Klanten waarop u toegang hebt binnen Nexus. Deze scope bepaalt ook welke SIM-kaarten u in notificaties ontvangt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {customers.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {scopeName === "INTERNAL"
                      ? "Als interne medewerker hebt u toegang tot alle klanten (volledige scope)."
                      : "Er zijn geen klanten gekoppeld aan dit account."}
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {customers.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-lg border border-slate-200 p-3 text-sm"
                      >
                        <div className="font-medium">{c.companyName}</div>
                        <div className="text-xs text-slate-500">
                          {c.customerNumber || "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <NotificationSettingsForm
            initialSettings={notifySettings}
            isAdmin={
              (scopeName as RoleScope) === "INTERNAL" &&
              (userDb.roleObj?.isSystem === true ||
                hasMinRole(userDb.role as UserRole | null, UserRole.ADMIN))
            }
            customerCount={customers.length}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
