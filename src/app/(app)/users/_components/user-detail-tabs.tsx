"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  UserRound,
  Mail,
  Shield,
  Building2,
  History,
  Edit,
  Save,
  CheckSquare,
  Square,
  Power,
  PowerOff,
  Clock,
  CalendarDays,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserRole, RoleScope, ALL_RESOURCE_TYPES, CUSTOMER_SCOPE_RESOURCES, RESELLER_SCOPE_RESOURCES, PARTNER_SCOPE_RESOURCES, type ResourceType } from "@/types/enums";
import type { UserDetail, UserCustomerLink, RoleListItem } from "@/types/domain";
import type { PermissionBits } from "@/types/next-auth.d";
import type { Customer } from "@prisma/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/formatters";
import {
  updateUserAction,
  updateUserCustomersAction,
  toggleUserActiveAction,
  type UserActionState,
} from "../actions";

type RoleOption = Pick<
  RoleListItem,
  "id" | "name" | "scope" | "isSystem" | "description"
>;

type CustomerOption = Pick<Customer, "id" | "customerNumber" | "companyName">;

type AuditLogEntry = {
  id: string;
  timestamp: Date;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: any;
  newValues: any;
  metadata?: any;
  user: { name: string | null; email: string } | null;
};

interface Props {
  user: UserDetail & {
    roleObj?: RoleOption | null;
    customerLinks: (UserCustomerLink & { customer?: CustomerOption })[];
    permissions: Record<ResourceType, { read: boolean; write: boolean }>;
  };
  customers: CustomerOption[];
  roles: RoleOption[];
  auditLogs: AuditLogEntry[];
}

const ROLE_TONE: Record<string, string> = {
  ADMIN: "bg-purple-50 text-purple-700 border-purple-200",
  EMPLOYEE: "bg-blue-50 text-blue-700 border-blue-200",
  VIEWER: "bg-slate-50 text-slate-700 border-slate-200",
};

const SCOPE_TONE: Record<RoleScope, string> = {
  INTERNAL: "bg-purple-50 text-purple-700 border-purple-200",
  CUSTOMER: "bg-blue-50 text-blue-700 border-blue-200",
  RESELLER: "bg-amber-50 text-amber-700 border-amber-200",
  PARTNER: "bg-teal-50 text-teal-700 border-teal-200",
};

const SCOPE_LABEL: Record<RoleScope, string> = {
  INTERNAL: "Intern",
  CUSTOMER: "Klant",
  RESELLER: "Reseller",
  PARTNER: "Partner",
};

const RESOURCE_LABELS: Record<string, { label: string; icon: any }> = {
  customer: { label: "Klanten", icon: Building2 },
  subscription: { label: "Abonnementen", icon: Shield },
  vehicle: { label: "Voertuigen", icon: UserRound },
  sim: { label: "SIM-kaarten", icon: Shield },
  tracker: { label: "Trackers", icon: Shield },
  activation_order: { label: "Activeringen", icon: Shield },
  invoice: { label: "Facturen", icon: Shield },
  product: { label: "Producten", icon: Shield },
  user: { label: "Gebruikers", icon: UserRound },
  role: { label: "Rollen", icon: Shield },
  audit_log: { label: "Audit log", icon: Shield },
  setting: { label: "Instellingen", icon: Shield },
  dashboard: { label: "Dashboard", icon: Shield },
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Aangemaakt",
  UPDATE: "Gewijzigd",
  DELETE: "Verwijderd",
  TOGGLE_USER_ACTIVE: "Status gewijzigd",
  LINK_USER_CUSTOMER: "Gebruiker gekoppeld",
  UNLINK_USER_CUSTOMER: "Gebruiker ontkoppeld",
  BULK_UPDATE_ROLE: "Rol bulk gewijzigd",
};

function RoleBadge({
  role,
  roleObj,
}: {
  role: UserRole;
  roleObj?: RoleOption | null;
}) {
  const labels: Record<UserRole, string> = {
    ADMIN: "Beheerder",
    EMPLOYEE: "Medewerker",
    VIEWER: "Alleen lezen",
  };
  const displayName = roleObj?.name ?? labels[role] ?? role;
  const isCustomerScope = roleObj?.scope === RoleScope.CUSTOMER;
  const tone = isCustomerScope ? SCOPE_TONE.CUSTOMER : ROLE_TONE[role] ?? "";
  return (
    <Badge variant="outline" className={tone}>
      <Shield className="mr-1 h-3 w-3" />
      {displayName}
    </Badge>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {value != null && value !== "" ? (
          href ? (
            <a
              href={href}
              className="block truncate underline-offset-4 hover:underline"
            >
              {value}
            </a>
          ) : (
            <div>{value}</div>
          )
        ) : (
          <div className="text-slate-400">—</div>
        )}
      </div>
    </div>
  );
}

function EmptyOrList<T>({
  rows,
  children,
  emptyTitle,
}: {
  rows: T[];
  children: React.ReactNode;
  emptyTitle: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        {emptyTitle}
      </div>
    );
  }
  return <>{children}</>;
}

function ToggleUserActive({
  userId,
  isActive,
  canEdit,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  canEdit: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const disabled = !canEdit || isSelf || isPending;

  async function handleToggle(nextActive: boolean) {
    if (disabled) return;
    startTransition(async () => {
      const res = await toggleUserActiveAction(userId, nextActive);
      if (res.ok) {
        toast.success(
          nextActive ? "Gebruiker is geactiveerd." : "Gebruiker is gedeactiveerd."
        );
        router.refresh();
      } else {
        toast.error(res.message ?? "Kon status niet wijzigen.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${
          isActive
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-slate-50 text-slate-600 border-slate-200"
        }`}
      >
        {isActive ? (
          <>
            <Power className="h-3 w-3" /> Actief
          </>
        ) : (
          <>
            <PowerOff className="h-3 w-3" /> Inactief
          </>
        )}
      </span>
      <Button
        type="button"
        size="sm"
        variant={isActive ? "destructive" : "default"}
        onClick={() => handleToggle(!isActive)}
        disabled={disabled}
      >
        {isActive ? (
          <>
            <PowerOff className="mr-1.5 h-4 w-4" />
            Deactiveren
          </>
        ) : (
          <>
            <Power className="mr-1.5 h-4 w-4" />
            Activeren
          </>
        )}
      </Button>
      {isSelf && (
        <span className="text-xs text-slate-400">(Je eigen account)</span>
      )}
    </div>
  );
}

function EditDialog({
  user,
  canEdit,
  roles,
  customers,
}: {
  user: Props["user"];
  canEdit: boolean;
  roles: RoleOption[];
  customers: CustomerOption[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const bindAction = (prev: UserActionState, fd: FormData) =>
    updateUserAction(user.id, prev, fd);
  const [state, formAction] = useFormState(bindAction as any, {
    message: null,
  } as UserActionState);
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    user.roleId ?? ""
  );

  const selectedRole = useMemo(() => {
    if (selectedRoleId) return roles.find((r) => r.id === selectedRoleId);
    return user.roleObj as RoleOption | undefined;
  }, [roles, selectedRoleId, user.roleObj]);
  const needsCustomer = selectedRole?.scope === RoleScope.CUSTOMER;

  const close = () => {
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o === false) router.refresh();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!canEdit}>
          <Edit className="mr-2 h-4 w-4" /> Bewerken
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Gebruiker bewerken: {user.name}</DialogTitle>
            <DialogDescription>
              Laat wachtwoord leeg om het huidige te behouden.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`edit-name-${user.id}`}>Naam *</Label>
              <Input
                id={`edit-name-${user.id}`}
                name="name"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-email-${user.id}`}>E-mail *</Label>
              <Input
                id={`edit-email-${user.id}`}
                name="email"
                type="email"
                defaultValue={user.email}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-password-${user.id}`}>
                Wachtwoord (leeg laten om niet te wijzigen)
              </Label>
              <Input
                id={`edit-password-${user.id}`}
                name="password"
                type="password"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`edit-roleId-${user.id}`}>Rol</Label>
                <Select
                  name="roleId"
                  value={selectedRoleId}
                  onValueChange={(v) => setSelectedRoleId(v)}
                >
                  <SelectTrigger id={`edit-roleId-${user.id}`}>
                    <SelectValue placeholder="Kies een rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Geen rollen beschikbaar
                      </SelectItem>
                    ) : (
                      roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <div className="flex items-center gap-2">
                            {r.scope === RoleScope.CUSTOMER ? (
                              <Building2 className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <Shield className="h-3.5 w-3.5 text-purple-600" />
                            )}
                            <span>{r.name}</span>
                            {r.isSystem ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 py-0"
                              >
                                Systeem
                              </Badge>
                            ) : null}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`edit-customerId-${user.id}`}>
                  Klant {needsCustomer ? "*" : "(optioneel)"}
                </Label>
                <Select
                  name="customerId"
                  defaultValue={user.customerId ?? ""}
                  disabled={!needsCustomer}
                  required={needsCustomer}
                >
                  <SelectTrigger id={`edit-customerId-${user.id}`}>
                    <SelectValue
                      placeholder={
                        needsCustomer
                          ? "Kies een klant..."
                          : "Alleen voor klant-rollen"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {!needsCustomer ? (
                      <SelectItem value="__none" disabled>
                        N.v.t. — alleen voor klant-rollen
                      </SelectItem>
                    ) : customers.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Geen klanten beschikbaar
                      </SelectItem>
                    ) : (
                      <>
                        <SelectItem value="">
                          <em className="text-slate-400">Geen klant (wissen)</em>
                        </SelectItem>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-3.5 w-3.5 text-slate-500" />
                              <span className="font-medium">{c.companyName}</span>
                              <span className="text-xs text-slate-400">
                                ({c.customerNumber})
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {state?.message ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.message}
              </div>
            ) : state?.userId !== undefined && !state.message ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Opgeslagen!
              </div>
            ) : null}
          </div>
          <DialogFooter className="mt-6 flex-col items-stretch gap-2 sm:flex-row sm:justify-end sm:items-center">
            <Button type="button" variant="ghost" onClick={close} className="w-full sm:w-auto">
              Sluiten
            </Button>
            <Button type="submit" className="w-full sm:w-auto">
              <Save className="mr-2 h-5 w-5 md:h-4 md:w-4" /> Opslaan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerLinksTab({
  user,
  customers,
  canEdit,
}: {
  user: Props["user"];
  customers: CustomerOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    if (user.customerId) s.add(user.customerId);
    for (const l of user.customerLinks) s.add(l.customerId);
    return s;
  }, [user.customerId, user.customerLinks]);

  const [selected, setSelected] = useState<Set<string>>(linkedIds);
  const [isPending, startTransition] = useTransition();

  const hasChanges = useMemo(() => {
    if (selected.size !== linkedIds.size) return true;
    for (const id of selected) if (!linkedIds.has(id)) return true;
    return false;
  }, [selected, linkedIds]);

  function toggleCustomer(id: string) {
    if (!canEdit) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setSelected(linkedIds);
  }

  async function save() {
    if (!canEdit) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await updateUserCustomersAction(user.id, ids);
      if (res.ok) {
        toast.success(
          `Klantkoppelingen bijgewerkt (${res.linked?.length ?? 0} gekoppeld, ${res.unlinked?.length ?? 0} ontkoppeld).`
        );
        router.refresh();
      } else {
        toast.error(res.message ?? "Kon klantkoppelingen niet opslaan.");
      }
    });
  }

  const linkedCustomers = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c]));
    const result: CustomerOption[] = [];
    if (user.customerId && map.has(user.customerId)) {
      result.push(map.get(user.customerId)!);
    }
    for (const l of user.customerLinks) {
      if (l.customer) {
        result.push(l.customer as CustomerOption);
      } else if (map.has(l.customerId)) {
        result.push(map.get(l.customerId)!);
      }
    }
    return result;
  }, [user.customerId, user.customerLinks, customers]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gekoppelde klanten</CardTitle>
          <CardDescription>
            Deze gebruiker heeft toegang tot de volgende {linkedCustomers.length}{" "}
            klant(en).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyOrList
            rows={linkedCustomers}
            emptyTitle="Nog geen klanten gekoppeld"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from(
                new Map(linkedCustomers.map((c) => [c.id, c])).values()
              ).map((c) => (
                <Link
                  key={c.id}
                  href={`/customers/${c.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-slate-50"
                >
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <Building2 className="h-4 w-4 text-slate-500" />
                      {c.companyName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.customerNumber}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </EmptyOrList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Klantkoppelingen beheren</CardTitle>
          <CardDescription>
            Selecteer de klanten waartoe deze gebruiker toegang moet hebben.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EmptyOrList
            rows={customers}
            emptyTitle="Geen klanten beschikbaar in jouw toegang"
          >
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <div className="divide-y">
                {customers.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleCustomer(c.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                        checked ? "bg-blue-50" : "hover:bg-slate-50"
                      } ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {checked ? (
                        <CheckSquare className="h-5 w-5 text-blue-600 shrink-0" />
                      ) : (
                        <Square className="h-5 w-5 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.companyName}</div>
                        <div className="text-xs text-slate-500">
                          {c.customerNumber}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{selected.size} klant(en) geselecteerd</span>
              {hasChanges && (
                <span className="text-amber-600">Niet opgeslagen wijzigingen</span>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={reset}
                disabled={!canEdit || !hasChanges || isPending}
              >
                Reset
              </Button>
              <Button
                type="button"
                onClick={save}
                disabled={!canEdit || !hasChanges || isPending}
              >
                <Save className="mr-2 h-4 w-4" /> Opslaan
              </Button>
            </div>
          </EmptyOrList>
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionsTab({ user }: { user: Props["user"] }) {
  const scope = (user.roleObj?.scope as RoleScope) ?? RoleScope.INTERNAL;
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

  const perms = user.permissions ?? ({} as any);

  let readCount = 0;
  let writeCount = 0;
  for (const r of availableResources) {
    const p = perms[r as ResourceType];
    if (p?.write) {
      writeCount++;
      readCount++;
    } else if (p?.read) {
      readCount++;
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rechtenmatrix</CardTitle>
        <CardDescription>
          Overzicht van de rechten van deze gebruiker, afgeleid van rol{" "}
          <strong>{user.roleObj?.name ?? user.role}</strong> (scope:{" "}
          {SCOPE_LABEL[scope]}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {readCount} leesrechten
          </Badge>
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
            {writeCount} schrijfrechten
          </Badge>
        </div>
        <div className="rounded-lg border hidden sm:block">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-600 border-b">
            <div className="col-span-6">Functionaliteit</div>
            <div className="col-span-3 text-center">Alleen lezen</div>
            <div className="col-span-3 text-center">Volledig</div>
          </div>
          {availableResources.map((resource) => {
            const meta = RESOURCE_LABELS[resource] ?? {
              label: resource,
              icon: Shield,
            };
            const Icon = meta.icon;
            const p = perms[resource as ResourceType];
            const hasRead = p?.read || p?.write;
            const hasWrite = !!p?.write;
            return (
              <div
                key={resource}
                className="grid grid-cols-12 gap-2 px-4 py-2 items-center text-sm border-b last:border-b-0"
              >
                <div className="col-span-6 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-slate-500" />
                  {meta.label}
                </div>
                <div className="col-span-3 flex items-center justify-center">
                  {hasRead ? (
                    <Badge
                      variant="outline"
                      className="bg-blue-50 text-blue-700 border-blue-200"
                    >
                      <CheckSquare className="mr-1 h-3 w-3" /> Ja
                    </Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
                <div className="col-span-3 flex items-center justify-center">
                  {hasWrite ? (
                    <Badge
                      variant="outline"
                      className="bg-purple-50 text-purple-700 border-purple-200"
                    >
                      <CheckSquare className="mr-1 h-3 w-3" /> Ja
                    </Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-2 sm:hidden">
          {availableResources.map((resource) => {
            const meta = RESOURCE_LABELS[resource] ?? {
              label: resource,
              icon: Shield,
            };
            const Icon = meta.icon;
            const p = perms[resource as ResourceType];
            const hasRead = p?.read || p?.write;
            const hasWrite = !!p?.write;
            return (
              <div
                key={resource}
                className="rounded-md border p-3 space-y-2"
              >
                <div className="flex items-center gap-2 font-medium text-base">
                  <Icon className="h-5 w-5 text-slate-500 shrink-0" />
                  <span>{meta.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-slate-50 p-2">
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                      Alleen lezen
                    </div>
                    <div>
                      {hasRead ? (
                        <Badge
                          variant="outline"
                          className="bg-blue-50 text-blue-700 border-blue-200"
                        >
                          Ja
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                      Volledig
                    </div>
                    <div>
                      {hasWrite ? (
                        <Badge
                          variant="outline"
                          className="bg-purple-50 text-purple-700 border-purple-200"
                        >
                          Ja
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditLogTab({ auditLogs }: { auditLogs: AuditLogEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wijzigingslogboek</CardTitle>
        <CardDescription>
          Recente acties op deze gebruiker en gerelateerde resources.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyOrList
          rows={auditLogs}
          emptyTitle="Nog geen wijzigingen gelogd"
        >
          <ul className="space-y-4">
            {auditLogs.map((log) => {
              const isOpen = expanded === log.id;
              return (
                <li
                  key={log.id}
                  className="flex items-start gap-3 border-b border-slate-100 pb-4 last:border-b-0"
                >
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <History className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {ACTION_LABEL[log.action] ?? log.action}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        {log.entityType}
                      </span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(new Date(log.timestamp))}
                      </span>
                      {(log.oldValues || log.newValues) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(isOpen ? null : log.id)}
                        >
                          {isOpen ? "Verbergen" : "Details"}
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {log.user
                        ? `${log.user.name ?? "Onbekend"} (${log.user.email})`
                        : "Systeem"}
                    </div>
                    {isOpen && (log.oldValues || log.newValues) ? (
                      <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                        {log.oldValues ? (
                          <div>
                            <div className="mb-1 font-semibold text-red-700">
                              Oude waarden
                            </div>
                            <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-red-900">
                              {JSON.stringify(log.oldValues, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                        {log.newValues ? (
                          <div>
                            <div className="mb-1 font-semibold text-emerald-700">
                              Nieuwe waarden
                            </div>
                            <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-emerald-900">
                              {JSON.stringify(log.newValues, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </EmptyOrList>
      </CardContent>
    </Card>
  );
}

export function UserDetailTabs({ user, customers, roles, auditLogs }: Props) {
  const router = useRouter();
  const [currentUserId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const meta = document.querySelector('meta[name="x-user-id"]');
        return meta?.getAttribute("content") ?? "";
      } catch {
        return "";
      }
    }
    return "";
  });
  const isSelf = false;
  const canEdit = true;

  const customerLinksCount =
    (user.customerId ? 1 : 0) + user.customerLinks.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/users">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
              <Badge
                variant="outline"
                className={
                  user.isActive
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }
              >
                {user.isActive ? (
                  <>
                    <Power className="mr-1 h-3 w-3" /> Actief
                  </>
                ) : (
                  <>
                    <PowerOff className="mr-1 h-3 w-3" /> Inactief
                  </>
                )}
              </Badge>
            </div>
            <div className="text-sm text-slate-500">{user.email}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <EditDialog
            user={user}
            canEdit={canEdit}
            roles={roles}
            customers={customers}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">
            <UserRound className="mr-1.5 h-4 w-4" />
            Algemeen
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Building2 className="mr-1.5 h-4 w-4" />
            Klantkoppelingen ({customerLinksCount})
          </TabsTrigger>
          <TabsTrigger value="permissions">
            <Shield className="mr-1.5 h-4 w-4" />
            Rechten
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" />
            Wijzigingslogboek ({auditLogs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Gebruikersgegevens</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<UserRound className="h-4 w-4" />}
                  label="Naam"
                  value={user.name}
                />
                <InfoRow
                  icon={<Mail className="h-4 w-4" />}
                  label="E-mail"
                  value={user.email}
                  href={`mailto:${user.email}`}
                />
                <InfoRow
                  icon={<Shield className="h-4 w-4" />}
                  label="Rol"
                  value={
                    <RoleBadge
                      role={user.role as UserRole}
                      roleObj={user.roleObj}
                    />
                  }
                />
                <InfoRow
                  icon={<Building2 className="h-4 w-4" />}
                  label="Scope"
                  value={
                    <Badge
                      variant="outline"
                      className={
                        SCOPE_TONE[
                          (user.roleObj?.scope as RoleScope) ?? RoleScope.INTERNAL
                        ]
                      }
                    >
                      {SCOPE_LABEL[
                        (user.roleObj?.scope as RoleScope) ?? RoleScope.INTERNAL
                      ]}
                    </Badge>
                  }
                />
                <InfoRow
                  icon={<Power className="h-4 w-4" />}
                  label="Status"
                  value={
                    <ToggleUserActive
                      userId={user.id}
                      isActive={user.isActive}
                      canEdit={canEdit}
                      isSelf={isSelf}
                    />
                  }
                />
                <InfoRow
                  icon={<Clock className="h-4 w-4" />}
                  label="Laatste login"
                  value={
                    user.lastLoginAt
                      ? formatDate(new Date(user.lastLoginAt))
                      : "Nooit"
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
                <CardDescription>Metadata van deze gebruiker</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span className="whitespace-nowrap">
                    {formatDate(new Date(user.createdAt))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Gebruiker ID</span>
                  <span className="font-mono text-xs">{user.id.substring(0, 12)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Klantkoppelingen</span>
                  <span>{customerLinksCount}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="mt-6">
          <CustomerLinksTab user={user} customers={customers} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <PermissionsTab user={user} />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <AuditLogTab auditLogs={auditLogs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
