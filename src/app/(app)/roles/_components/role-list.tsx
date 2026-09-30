"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Plus,
  Edit,
  Trash2,
  Shield,
  Lock,
  Unlock,
  Building2,
  Users,
} from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RoleScope, ALL_RESOURCE_TYPES, CUSTOMER_SCOPE_RESOURCES, RESELLER_SCOPE_RESOURCES, PARTNER_SCOPE_RESOURCES } from "@/types/enums";
import type { PermissionLevel, RoleListItem } from "@/types/domain";
import type { ResourceType } from "@/types/enums";
import type { RoleActionState } from "../actions";
import { createRoleAction, deleteRoleAction } from "../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Props {
  roles: RoleListItem[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  errorMessage?: string | null;
}

const RESOURCE_LABELS: Record<ResourceType | string, { label: string; icon: any }> = {
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
  INTERNAL: { label: "Intern", tone: "bg-purple-50 text-purple-700 border-purple-200", icon: Users },
  CUSTOMER: { label: "Klant", tone: "bg-blue-50 text-blue-700 border-blue-200", icon: Building2 },
  RESELLER: { label: "Reseller", tone: "bg-amber-50 text-amber-700 border-amber-200", icon: Building2 },
  PARTNER: { label: "Partner", tone: "bg-teal-50 text-teal-700 border-teal-200", icon: Building2 },
};

export function RoleList({
  roles,
  canCreate,
  canEdit,
  canDelete,
  errorMessage,
}: Props) {
  const router = useRouter();
  const columns: ColumnDef<RoleListItem>[] = [
    {
      accessorKey: "name",
      header: "Naam",
      cell: ({ row }) => {
        const r = row.original;
        const scope = SCOPE_LABEL[r.scope as RoleScope];
        const Icon = scope.icon;
        return (
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-slate-500" />
            <div>
              <div className="font-medium flex items-center gap-2">
                {r.name}
                {r.isSystem && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-600 text-[10px] py-0 h-4">
                    <Lock className="mr-1 h-2.5 w-2.5" /> Systeem
                  </Badge>
                )}
                {r.isDefault && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px] py-0 h-4">
                    <Unlock className="mr-1 h-2.5 w-2.5" /> Default
                  </Badge>
                )}
              </div>
              {r.description && (
                <p className="text-xs text-slate-500 max-w-md truncate">{r.description}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "scope",
      header: "Scope",
      cell: ({ row }) => {
        const r = row.original;
        const scope = SCOPE_LABEL[r.scope as RoleScope];
        const Icon = scope.icon;
        return (
          <Badge variant="outline" className={scope.tone}>
            <Icon className="mr-1 h-3 w-3" />
            {scope.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "userCount",
      header: "Gebruikers",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-sm text-slate-600">{row.original.userCount ?? 0}</span>
        </div>
      ),
    },
    {
      accessorKey: "permissionCount",
      header: "Rechten",
      cell: ({ row }) => {
        const pc = row.original.permissionCount as any;
        const read = typeof pc === "object" && pc ? pc.read : 0;
        const write = typeof pc === "object" && pc ? pc.write : 0;
        return (
          <div className="text-sm text-slate-600">
            <span className="text-blue-600">{read} read</span>
            <span className="mx-1 text-slate-300">·</span>
            <span className="text-purple-600">{write} write</span>
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const r = row.original;
        const cannotDelete = r.isSystem;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acties</DropdownMenuLabel>
              {canEdit && (
                <DropdownMenuItem onClick={() => router.push(`/roles/${r.id}`)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Bewerken
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canDelete && !cannotDelete && (
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => {
                    if (
                      confirm(
                        `Weet je zeker dat je de rol "${r.name}" wilt verwijderen? Gebruikers met deze rol verliezen hun rechten.`
                      )
                    ) {
                      deleteRoleAction(r.id);
                      toast.success(`Rol "${r.name}" is verwijderd.`);
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Verwijderen
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rollen & Rechten</h1>
          <p className="text-sm text-slate-500">
            Beheer welke rollen toegang hebben tot welke functionaliteit.
          </p>
        </div>
        {canCreate && <CreateDialog canCreate={canCreate} />}
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {decodeURIComponent(errorMessage)}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Alle rollen</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={roles as any}
            searchColumnAccessor="name"
            searchPlaceholder="Zoek op naam..."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CreateDialog({ canCreate }: { canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const initial: RoleActionState = { message: null };
  const [state, formAction] = useFormState(createRoleAction as any, initial);
  const [scope, setScope] = useState<RoleScope>(RoleScope.INTERNAL);
  const close = () => {
    setOpen(false);
    router.refresh();
  };

  const availableResources = (() => {
    switch (scope) {
      case RoleScope.RESELLER:
        return RESELLER_SCOPE_RESOURCES as readonly string[];
      case RoleScope.PARTNER:
        return PARTNER_SCOPE_RESOURCES as readonly string[];
      case RoleScope.CUSTOMER:
        return CUSTOMER_SCOPE_RESOURCES as readonly string[];
      case RoleScope.INTERNAL:
      default:
        return ALL_RESOURCE_TYPES as readonly string[];
    }
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && state?.roleId) {
          toast.success("Rol is aangemaakt.");
          setTimeout(() => router.push(`/roles/${state.roleId}`), 200);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!canCreate}>
          <Plus className="mr-2 h-4 w-4" /> Nieuwe rol
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Nieuwe rol aanmaken</DialogTitle>
            <DialogDescription>
              Geef de rol een naam, scope en stel per functionaliteit de gewenste toegang in.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Naam *</Label>
                <Input id="name" name="name" required />
                {state?.errors?.name?.length ? (
                  <p className="text-xs text-red-600">{state.errors.name.join(", ")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="scope">Scope *</Label>
                <Select
                  name="scope"
                  required
                  value={scope}
                  onValueChange={(v) => setScope(v as RoleScope)}
                >
                  <SelectTrigger id="scope">
                    <SelectValue placeholder="Kies een scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RoleScope.INTERNAL}>
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5" /> Intern (medewerkers)
                      </div>
                    </SelectItem>
                    <SelectItem value={RoleScope.CUSTOMER}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5" /> Klant (toegang per klant)
                      </div>
                    </SelectItem>
                    <SelectItem value={RoleScope.RESELLER}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5" /> Reseller (wij factureren de reseller)
                      </div>
                    </SelectItem>
                    <SelectItem value={RoleScope.PARTNER}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5" /> Partner (wij factureren de eindklant)
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Beschrijving</Label>
              <Textarea id="description" name="description" rows={2} />
            </div>

            <div>
              <Label className="mb-3 block">Rechten per functionaliteit</Label>
              <div className="rounded-lg border">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-600 border-b">
                  <div className="col-span-5">Functionaliteit</div>
                  <div className="col-span-7 grid grid-cols-3 text-center">
                    <div>Geen</div>
                    <div>Alleen lezen</div>
                    <div>Volledig</div>
                  </div>
                </div>
                {(availableResources as readonly string[]).map((resource) => {
                  const meta = RESOURCE_LABELS[resource] ?? {
                    label: resource,
                    icon: Shield,
                  };
                  const Icon = meta.icon;
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
                            defaultChecked
                          />
                        </label>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`perm_${resource}`}
                            value="READ"
                            className="h-3.5 w-3.5"
                          />
                        </label>
                        <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`perm_${resource}`}
                            value="WRITE"
                            className="h-3.5 w-3.5"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Volledige toegang impliceert automatisch leesrecht.
              </p>
              {state?.errors?.permissions?.length ? (
                <p className="text-xs text-red-600 mt-2">
                  {state.errors.permissions.join(", ")}
                </p>
              ) : null}
            </div>

            {state?.message && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {state.message}
              </div>
            )}
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={close}
            >
              Annuleren
            </Button>
            <Button type="submit">Rol aanmaken</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
