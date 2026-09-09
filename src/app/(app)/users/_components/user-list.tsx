"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Trash2, UserRound, Shield, Save } from "lucide-react";
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
import { UserRole } from "@/types/enums";
import type { User } from "@prisma/client";
import type { UserActionState } from "../actions";
import { createUserAction, updateUserAction, deleteUserAction } from "../actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Props {
  users: User[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  currentUserId: string;
  errorMessage?: string | null;
}

const ROLE_TONE: Record<string, string> = {
  ADMIN: "bg-purple-50 text-purple-700 border-purple-200",
  EMPLOYEE: "bg-blue-50 text-blue-700 border-blue-200",
  VIEWER: "bg-slate-50 text-slate-700 border-slate-200",
};

function RoleBadge({ role }: { role: UserRole }) {
  const labels: Record<UserRole, string> = {
    ADMIN: "Beheerder",
    EMPLOYEE: "Medewerker",
    VIEWER: "Alleen lezen",
  };
  return (
    <Badge variant="outline" className={ROLE_TONE[role] ?? ""}>
      <Shield className="mr-1 h-3 w-3" />
      {labels[role] ?? role}
    </Badge>
  );
}

function CreateDialog({ canCreate }: { canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const initial: UserActionState = { message: null };
  const [state, formAction] = useFormState(createUserAction as any, initial);
  const close = () => {
    setOpen(false);
    router.refresh();
  };
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
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Nieuwe gebruiker aanmaken</DialogTitle>
            <DialogDescription>
              Verstrek een e-mail, naam, wachtwoord en rol.
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
            <div className="space-y-2">
              <Label htmlFor="role">Rol *</Label>
              <Select name="role" defaultValue="EMPLOYEE">
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Alleen lezen</SelectItem>
                  <SelectItem value="EMPLOYEE">Medewerker</SelectItem>
                  <SelectItem value="ADMIN">Beheerder</SelectItem>
                </SelectContent>
              </Select>
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
}: {
  user: User;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const bindAction = (prev: UserActionState, fd: FormData) =>
    updateUserAction(user.id, prev, fd);
  const [state, formAction] = useFormState(bindAction as any, { message: null } as UserActionState);
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
      <DialogContent>
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
            <div className="space-y-2">
              <Label htmlFor={`edit-role-${user.id}`}>Rol</Label>
              <Select name="role" defaultValue={user.role}>
                <SelectTrigger id={`edit-role-${user.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Alleen lezen</SelectItem>
                  <SelectItem value="EMPLOYEE">Medewerker</SelectItem>
                  <SelectItem value="ADMIN">Beheerder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {state?.message ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.message}
              </div>
            ) : (
              state?.userId !== undefined && !state.message ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  Opgeslagen!
                </div>
              ) : null
            )}
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
  canCreate,
  canEdit,
  canDelete,
  currentUserId,
  errorMessage,
}: Props) {
  const router = useRouter();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  if (errorMessage) {
    toast.error(errorMessage);
  }

  const columns: ColumnDef<User>[] = [
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
      size: 160,
      cell: ({ row }) => (
        <RoleBadge role={row.original.role as UserRole} />
      ),
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
      size: 180,
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
                <EditDialog user={u} canEdit={canEdit && !isSelf} />
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
            Alleen beheerders kunnen gebruikers aanmaken en beheren. ({users.length})
          </p>
        </div>
        <CreateDialog canCreate={canCreate} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gebruikerslijst</CardTitle>
          <CardDescription>
            Rollen: Beheerder (alles), Medewerker (schrijven), Alleen lezen (bekijken).
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
