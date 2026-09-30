"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, useMemo } from "react";
import { useFormState } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Plus,
  Edit,
  Trash2,
  UserRound,
  Shield,
  Save,
  Building2,
  Users,
} from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserRole, RoleScope } from "@/types/enums";
import type { RoleListItem } from "@/types/domain";
import type { PermissionBits } from "@/types/next-auth.d";
import type { User, Customer } from "@prisma/client";
import type { UserActionState } from "../actions";
import {
  createUserAction,
  updateUserAction,
  deleteUserAction,
} from "../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type RoleOption = Pick<
  RoleListItem,
  "id" | "name" | "scope" | "isSystem" | "description"
>;

type CustomerOption = Pick<Customer, "id" | "customerNumber" | "companyName">;

interface Props {
  users: (User & { roleObj?: RoleOption | null; customer?: CustomerOption | null })[];
  roles: RoleOption[];
  customers: CustomerOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  currentUserId: string;
  viewerRoleScope: RoleScope | null;
  errorMessage?: string | null;
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

function CreateDialog({
  canCreate,
  roles,
  customers,
  viewerRoleScope,
}: {
  canCreate: boolean;
  roles: RoleOption[];
  customers: CustomerOption[];
  viewerRoleScope: RoleScope | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const initial: UserActionState = { message: null };
  const [state, formAction] = useFormState(createUserAction as any, initial);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  useEffect(() => {
    if (open && !selectedRoleId) {
      const firstEligible = roles.find((r) => {
        if (viewerRoleScope === RoleScope.CUSTOMER) return r.scope === RoleScope.CUSTOMER;
        return true;
      });
      if (firstEligible) setSelectedRoleId(firstEligible.id);
    }
  }, [open, roles, viewerRoleScope, selectedRoleId]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId),
    [roles, selectedRoleId]
  );
  const needsCustomer = selectedRole?.scope === RoleScope.CUSTOMER;

  const close = () => {
    setOpen(false);
    setSelectedRoleId("");
    router.refresh();
  };

  const availableRoles = useMemo(() => {
    if (viewerRoleScope === RoleScope.CUSTOMER) {
      return roles.filter((r) => r.scope === RoleScope.CUSTOMER);
    }
    return roles;
  }, [roles, viewerRoleScope]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && state?.userId) window.location.reload();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!canCreate}>
          <Plus className="mr-2 h-4 w-4" /> Nieuwe gebruiker
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Nieuwe gebruiker aanmaken</DialogTitle>
            <DialogDescription>
              Verstrek een e-mail, naam, wachtwoord, rol en eventueel een klant.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Naam *</Label>
              <Input id="name" name="name" required />
              {state?.errors?.name?.length ? (
                <p className="text-xs text-red-600">{state.errors.name.join(", ")}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mailadres *</Label>
              <Input id="email" name="email" type="email" required />
              {state?.errors?.email?.length ? (
                <p className="text-xs text-red-600">{state.errors.email.join(", ")}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Wachtwoord * (min. 8 tekens)</Label>
              <Input id="password" name="password" type="password" required />
              {state?.errors?.password?.length ? (
                <p className="text-xs text-red-600">{state.errors.password.join(", ")}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="roleId">Rol *</Label>
                <Select
                  name="roleId"
                  value={selectedRoleId}
                  onValueChange={(v) => setSelectedRoleId(v)}
                  required
                >
                  <SelectTrigger id="roleId">
                    <SelectValue placeholder="Kies een rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Geen rollen beschikbaar
                      </SelectItem>
                    ) : (
                      availableRoles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <div className="flex items-center gap-2">
                            {r.scope === RoleScope.CUSTOMER ? (
                              <Building2 className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <Users className="h-3.5 w-3.5 text-purple-600" />
                            )}
                            <span>{r.name}</span>
                            {r.isSystem ? (
                              <Badge variant="outline" className="text-[10px] h-4 py-0">
                                Systeem
                              </Badge>
                            ) : null}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {state?.errors?.roleId?.length ? (
                  <p className="text-xs text-red-600">{state.errors.roleId.join(", ")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerId">
                  Klant {needsCustomer ? "*" : "(optioneel)"}
                </Label>
                <Select
                  name="customerId"
                  disabled={!needsCustomer}
                  required={needsCustomer}
                >
                  <SelectTrigger id="customerId">
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
                      customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-slate-500" />
                            <span className="font-medium">{c.companyName}</span>
                            <span className="text-xs text-slate-400">
                              ({c.customerNumber})
                            </span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {state?.errors?.customerId?.length ? (
                  <p className="text-xs text-red-600">
                    {state.errors.customerId.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
            {state?.message ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.message}
              </div>
            ) : null}
            {state?.userId ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Gebruiker aangemaakt!
              </div>
            ) : null}
          </div>
          <DialogFooter className="mt-6 gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Sluiten
            </Button>
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" /> Aanmaken
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  user,
  canEdit,
  roles,
  customers,
  viewerRoleScope,
}: {
  user: Props["users"][number];
  canEdit: boolean;
  roles: RoleOption[];
  customers: CustomerOption[];
  viewerRoleScope: RoleScope | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const bindAction = (prev: UserActionState, fd: FormData) =>
    updateUserAction(user.id, prev, fd);
  const [state, formAction] = useFormState(
    bindAction as any,
    { message: null } as UserActionState
  );
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    user.roleId ?? ""
  );

  useEffect(() => {
    if (open) setSelectedRoleId(user.roleId ?? "");
  }, [open, user.roleId]);

  const selectedRole = useMemo(() => {
    if (selectedRoleId) return roles.find((r) => r.id === selectedRoleId);
    return user.roleObj as RoleOption | undefined;
  }, [roles, selectedRoleId, user.roleObj]);
  const needsCustomer = selectedRole?.scope === RoleScope.CUSTOMER;

  const availableRoles = useMemo(() => {
    if (viewerRoleScope === RoleScope.CUSTOMER) {
      return roles.filter((r) => r.scope === RoleScope.CUSTOMER);
    }
    return roles;
  }, [roles, viewerRoleScope]);

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
        <DropdownMenuItem
          disabled={!canEdit}
          onSelect={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <Edit className="mr-2 h-4 w-4" /> Bewerken
        </DropdownMenuItem>
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
                    {availableRoles.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Geen rollen beschikbaar
                      </SelectItem>
                    ) : (
                      availableRoles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <div className="flex items-center gap-2">
                            {r.scope === RoleScope.CUSTOMER ? (
                              <Building2 className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <Users className="h-3.5 w-3.5 text-purple-600" />
                            )}
                            <span>{r.name}</span>
                            {r.isSystem ? (
                              <Badge variant="outline" className="text-[10px] h-4 py-0">
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
          <DialogFooter className="mt-6 gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Sluiten
            </Button>
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" /> Opslaan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserList({
  users,
  roles,
  customers,
  canCreate,
  canEdit,
  canDelete,
  currentUserId,
  viewerRoleScope,
  errorMessage,
}: Props) {
  const router = useRouter();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  if (errorMessage) {
    toast.error(errorMessage);
  }

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerOption>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const columns: ColumnDef<Props["users"][number]>[] = [
    {
      accessorKey: "name",
      header: "Naam",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <UserRound className="h-4 w-4" />
          </div>
          <div>
            <div className="font-medium">{row.getValue("name")}</div>
            <div className="text-xs text-slate-500">{row.original.email}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Rol",
      size: 180,
      cell: ({ row }) => (
        <RoleBadge
          role={row.original.role as UserRole}
          roleObj={row.original.roleObj}
        />
      ),
    },
    {
      id: "customer",
      header: "Klant",
      size: 240,
      cell: ({ row }) => {
        const cid = row.original.customerId;
        if (!cid)
          return (
            <span className="text-xs text-slate-400 italic">
              (Interne gebruiker)
            </span>
          );
        const c = customerMap.get(cid) ?? (row.original as any).customer;
        if (!c)
          return (
            <span className="text-xs text-slate-400 font-mono">{cid}</span>
          );
        return (
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{c.companyName}</div>
              <div className="text-xs text-slate-500 truncate">
                {c.customerNumber}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "lastLoginAt",
      header: "Laatste login",
      size: 180,
      cell: ({ row }) => {
        const t = row.original.lastLoginAt;
        return t ? (
          <span className="whitespace-nowrap text-xs text-slate-600">
            {new Date(t).toLocaleString("nl-NL")}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Nooit</span>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Aangemaakt",
      size: 160,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-slate-600">
          {new Date(row.original.createdAt).toLocaleDateString("nl-NL")}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = u.id === currentUserId;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <EditDialog
                  user={u}
                  canEdit={canEdit && !isSelf}
                  roles={roles}
                  customers={customers}
                  viewerRoleScope={viewerRoleScope}
                />
                <DropdownMenuSeparator />
                {canDelete && !isSelf ? (
                  <DropdownMenuItem
                    className="text-red-600 focus:bg-red-50 focus:text-red-700"
                    onClick={() => {
                      if (
                        confirm(
                          `Weet je zeker dat je gebruiker ${u.name} wilt verwijderen? Dit is definitief.`
                        )
                      ) {
                        startDeleteTransition(async () => {
                          try {
                            await deleteUserAction(u.id);
                          } catch (e) {
                            toast.error("Verwijderen mislukt.");
                          }
                        });
                      }
                    }}
                    disabled={isPendingDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                  </DropdownMenuItem>
                ) : null}
                {isSelf ? (
                  <DropdownMenuItem disabled>
                    <span className="text-xs">(Je eigen account)</span>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gebruikers</h1>
          <p className="text-sm text-slate-500">
            Beheer gebruikers en hun rechten. ({users.length})
          </p>
        </div>
        <CreateDialog
          canCreate={canCreate}
          roles={roles}
          customers={customers}
          viewerRoleScope={viewerRoleScope}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gebruikerslijst</CardTitle>
          <CardDescription>
            Kies per gebruiker een rol. Klant-rollen vereisen dat er ook een klant
            wordt toegewezen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={users}
            searchPlaceholder="Zoeken op naam of e-mail..."
          />
        </CardContent>
      </Card>
    </div>
  );
}
