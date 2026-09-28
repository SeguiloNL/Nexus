"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Shield,
  Lock,
  Unlock,
  Building2,
  Users,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RoleScope,
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
} from "@/types/enums";
import type { PermissionLevel, RoleDetail } from "@/types/domain";
import type { RoleActionState } from "../actions";
import { updateRoleAction } from "../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const RESOURCE_LABELS: Record<string, { label: string; icon: any }> = {
  customer: { label: "Klanten", icon: Building2 },
  subscription: { label: "Abonnementen", icon: Shield },
  vehicle: { label: "Voertuigen", icon: Users },
  sim: { label: "SIM-kaarten", icon: Shield },
  tracker: { label: "Trackers", icon: Shield },
  activation_order: { label: "Activeringen", icon: Shield },
  invoice: { label: "Facturen", icon: Shield },
  product: { label: "Producten", icon: Shield },
  user: { label: "Gebruikers", icon: Users },
  role: { label: "Rollen", icon: Shield },
  audit_log: { label: "Audit log", icon: Shield },
  setting: { label: "Instellingen", icon: Shield },
  dashboard: { label: "Dashboard", icon: Shield },
};

const SCOPE_LABEL: Record<RoleScope, { label: string; tone: string; icon: any }> = {
  INTERNAL: {
    label: "Intern",
    tone: "bg-purple-50 text-purple-700 border-purple-200",
    icon: Users,
  },
  CUSTOMER: {
    label: "Klant",
    tone: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Building2,
  },
};

interface Props {
  role: RoleDetail;
  canEdit: boolean;
}

function permissionLevelOf(
  details: RoleDetail,
  resource: string
): "NONE" | "READ" | "WRITE" {
  const p = (details.permissions as any)?.[resource];
  if (p?.write) return "WRITE";
  if (p?.read) return "READ";
  return "NONE";
}

export function RoleEditForm({ role, canEdit }: Props) {
  const router = useRouter();
  const initial: RoleActionState = { message: null, roleId: role.id };
  const boundAction = async (
    prev: RoleActionState,
    fd: FormData
  ): Promise<RoleActionState> => {
    const result = await updateRoleAction(role.id, prev, fd);
    if (!result.message && !result.errors) {
      toast.success("Rol is bijgewerkt.");
      router.refresh();
    }
    return result;
  };
  const [state, formAction] = useFormState(boundAction as any, initial);

  const scope = role.scope as RoleScope;
  const scopeInfo = SCOPE_LABEL[scope] ?? SCOPE_LABEL.INTERNAL;
  const ScopeIcon = scopeInfo.icon;

  const availableResources =
    scope === RoleScope.CUSTOMER
      ? (CUSTOMER_SCOPE_RESOURCES as readonly string[])
      : (ALL_RESOURCE_TYPES as readonly string[]);

  const disabled = !canEdit || role.isSystem;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/roles">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
            <Badge variant="outline" className={scopeInfo.tone}>
              <ScopeIcon className="mr-1 h-3 w-3" />
              {scopeInfo.label}
            </Badge>
            {role.isSystem && (
              <Badge
                variant="outline"
                className="bg-slate-50 text-slate-600"
              >
                <Lock className="mr-1 h-3 w-3" /> Systeemrol
              </Badge>
            )}
            {role.isDefault && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700"
              >
                <Unlock className="mr-1 h-3 w-3" /> Default
              </Badge>
            )}
          </div>
          {role.description ? (
            <p className="text-sm text-slate-500 mt-1">{role.description}</p>
          ) : null}
        </div>
      </div>

      {role.isSystem && !canEdit ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Dit is een systeemrol en kan niet gewijzigd of verwijderd worden.
        </div>
      ) : null}

      <form action={formAction} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Algemene gegevens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Naam</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={role.name}
                  disabled={disabled}
                />
                {state?.errors?.name?.length ? (
                  <p className="text-xs text-red-600">
                    {state.errors.name.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Badge variant="outline" className={`w-fit ${scopeInfo.tone}`}>
                  <ScopeIcon className="mr-1 h-3 w-3" />
                  {scopeInfo.label} (kan niet worden gewijzigd)
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Beschrijving</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                defaultValue={role.description ?? ""}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rechten per functionaliteit</CardTitle>
            <CardDescription className="text-sm">
              Stel per onderdeel in wat gebruikers met deze rol mogen doen.
              Volledige toegang geeft automatisch ook leesrechten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-600 border-b">
                <div className="col-span-5">Functionaliteit</div>
                <div className="col-span-7 grid grid-cols-3 text-center">
                  <div>Geen</div>
                  <div>Alleen lezen</div>
                  <div>Volledig</div>
                </div>
              </div>
              {availableResources.map((resource) => {
                const meta = RESOURCE_LABELS[resource] ?? {
                  label: resource,
                  icon: Shield,
                };
                const Icon = meta.icon;
                const level = permissionLevelOf(role, resource);
                return (
                  <div
                    key={resource}
                    className="grid grid-cols-12 gap-2 px-4 py-2 items-center text-sm border-b last:border-b-0"
                  >
                    <div className="col-span-5 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-slate-500" />
                      {meta.label}
                    </div>
                    <div className="col-span-7 grid grid-cols-3 gap-2">
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${resource}`}
                          value="NONE"
                          className="h-3.5 w-3.5"
                          defaultChecked={level === "NONE"}
                          disabled={disabled}
                        />
                      </label>
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${resource}`}
                          value="READ"
                          className="h-3.5 w-3.5"
                          defaultChecked={level === "READ"}
                          disabled={disabled}
                        />
                      </label>
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${resource}`}
                          value="WRITE"
                          className="h-3.5 w-3.5"
                          defaultChecked={level === "WRITE"}
                          disabled={disabled}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            {state?.errors?.permissions?.length ? (
              <p className="text-xs text-red-600 mt-2">
                {state.errors.permissions.join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {state?.message && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {state.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Link href="/roles">
            <Button variant="secondary" type="button">
              Annuleren
            </Button>
          </Link>
          <Button type="submit" disabled={disabled}>
            <Save className="mr-2 h-4 w-4" />
            Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
