"use client";

import * as React from "react";
import { useFormState } from "react-dom";
import { useEffect } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, UserRound, Mail, Phone, Smartphone, Briefcase, Link2Off, Link2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import type { ContactPerson } from "@prisma/client";
import {
  createContactAction,
  deleteContactAction,
  updateContactAction,
  type ContactActionState,
} from "../actions";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";

type Props = {
  customerId: string;
  initialContacts: ContactPerson[];
  role: UserRole;
};

type ContactRow = ContactPerson;

function maskNone(s: string | null | undefined) {
  return s ?? "";
}

function formStr(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (v === null || v === undefined || typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function formNum(formData: FormData, key: string): number | undefined {
  const s = formStr(formData, key);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

export function CustomerContactsTable({ customerId, initialContacts, role }: Props) {
  const canEdit = canUserRole(role, "edit", "customer");
  const canCreate = canUserRole(role, "create", "customer");
  const canDelete = canUserRole(role, "delete", "customer");

  const [contacts, setContacts] = React.useState<ContactRow[]>(initialContacts);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<ContactRow | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<ContactRow | null>(null);

  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const columns: ColumnDef<ContactRow, any>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Naam",
        id: "name",
        cell: ({ row }) => {
          const c = row.original;
          const full = [c.firstName, c.lastName].filter(Boolean).join(" ");
          return (
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="font-medium truncate">{full || "—"}</div>
                {c.functionTitle ? (
                  <div className="text-xs text-slate-500 truncate">
                    <Briefcase className="inline h-3 w-3 mr-1 align-text-bottom" aria-hidden />
                    {c.functionTitle}
                  </div>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "email",
        header: "E-mail",
        cell: ({ getValue }) => {
          const v = getValue<string>();
          if (!v) return <span className="text-slate-400">—</span>;
          return (
            <a href={`mailto:${v}`} className="inline-flex items-center gap-1 hover:underline">
              <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <span className="truncate max-w-[220px]">{v}</span>
            </a>
          );
        },
      },
      {
        accessorKey: "phone",
        header: "Telefoon",
        cell: ({ getValue }) => {
          const v = getValue<string>();
          if (!v) return <span className="text-slate-400">—</span>;
          return (
            <a href={`tel:${v}`} className="inline-flex items-center gap-1 hover:underline font-mono text-xs">
              <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <span>{v}</span>
            </a>
          );
        },
      },
      {
        accessorKey: "mobile",
        header: "Mobiel",
        cell: ({ getValue }) => {
          const v = getValue<string>();
          if (!v) return <span className="text-slate-400">—</span>;
          return (
            <a href={`tel:${v}`} className="inline-flex items-center gap-1 hover:underline font-mono text-xs">
              <Smartphone className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <span>{v}</span>
            </a>
          );
        },
      },
      {
        accessorKey: "inserveContactId",
        header: "Inserve",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          if (!v) {
            return (
              <Badge variant="outline" className="text-slate-500 border-slate-200 flex w-fit gap-1 items-center">
                <Link2Off className="h-3 w-3" aria-hidden /> Handmatig
              </Badge>
            );
          }
          return (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 flex w-fit gap-1 items-center">
              <Link2 className="h-3 w-3" aria-hidden /> #{v}
            </Badge>
          );
        },
      },
      ...(canEdit || canDelete
        ? [
            {
              id: "actions",
              header: "Acties",
              cell: ({ row }: any) => {
                const c: ContactRow = row.original;
                return (
                  <div className="flex items-center justify-end gap-2">
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Contactpersoon ${c.firstName ?? ""} ${c.lastName} bewerken`}
                        onClick={() => setEditingContact(c)}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Bewerken
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        aria-label={`Contactpersoon ${c.firstName ?? ""} ${c.lastName} verwijderen`}
                        onClick={() => setDeleteCandidate(c)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" /> Verwijderen
                      </Button>
                    ) : null}
                  </div>
                );
              },
            },
          ]
        : []),
    ],
    [canEdit, canDelete]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Contactpersonen</h3>
          <p className="text-sm text-slate-500">
            Contactpersonen van deze klant. Wijzigingen van Inserve-kant worden bij de eerstvolgende sync overgenomen.
          </p>
        </div>
        {canCreate ? (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1.5" /> Contactpersoon toevoegen
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Contactpersoon toevoegen</DialogTitle>
                <DialogDescription>
                  Voeg een contactpersoon toe aan deze klant. Inserve-contactpersonen hebben een groene badge.
                </DialogDescription>
              </DialogHeader>
              <ContactForm
                mode="create"
                customerId={customerId}
                onAfterSubmit={(created) => {
                  setContacts((prev) => [...prev, created]);
                  setAddOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <DataTable<ContactRow, any>
        columns={columns}
        data={contacts}
        searchPlaceholder="Zoek contactpersoon…"
        searchColumnAccessors={["firstName", "lastName", "email", "phone", "mobile", "functionTitle"]}
        pageSizeOptions={[10, 25, 50]}
        defaultSorting={[{ id: "name", desc: false }]}
        totalCount={contacts.length}
      />

      {editingContact ? (
        <Dialog open={!!editingContact} onOpenChange={(v) => !v && setEditingContact(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Contactpersoon bewerken</DialogTitle>
              <DialogDescription>
                Wijzig de gegevens van deze contactpersoon.
              </DialogDescription>
            </DialogHeader>
            <ContactForm
              mode="edit"
              customerId={customerId}
              contact={editingContact}
              onAfterSubmit={(updated) => {
                setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                setEditingContact(null);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {deleteCandidate ? (
        <Dialog open={!!deleteCandidate} onOpenChange={(v) => !v && setDeleteCandidate(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Contactpersoon verwijderen</DialogTitle>
              <DialogDescription>
                Weet je zeker dat je{" "}
                <strong>
                  {deleteCandidate.firstName ?? ""} {deleteCandidate.lastName}
                </strong>{" "}
                wilt verwijderen? Dit kan niet ongedaan worden gemaakt (wordt zacht-gewist met datum).
              </DialogDescription>
            </DialogHeader>
            <DeleteContactConfirm
              customerId={customerId}
              contact={deleteCandidate}
              onDeleted={() => {
                setContacts((prev) => prev.filter((c) => c.id !== deleteCandidate.id));
                setDeleteCandidate(null);
              }}
              onCancel={() => setDeleteCandidate(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// -------------- Sub-components --------------

function ContactForm({
  mode,
  customerId,
  contact,
  onAfterSubmit,
}: {
  mode: "create" | "edit";
  customerId: string;
  contact?: ContactRow;
  onAfterSubmit: (c: ContactRow) => void;
}) {
  const createBound = React.useMemo(
    () => createContactAction.bind(null, customerId),
    [customerId]
  );
  const updateBound = React.useMemo(() => {
    if (!contact) return null;
    return updateContactAction.bind(null, customerId, contact.id);
  }, [customerId, contact]);

  const action: typeof createBound = mode === "edit" && updateBound ? updateBound : createBound;

  const [state, formAction] = useFormState(action, {
    errors: undefined,
    message: null,
  } satisfies ContactActionState);

  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const s = state as ContactActionState;
    if (s?.message) {
      if (s.errors) {
        toast.error(s.message);
      } else if (s.contactId) {
        toast.success(s.message ?? "Opgeslagen.");
      } else if (s.message) {
        toast.error(s.message);
      }
    }
  }, [state]);

  return (
    <form
      action={async (formData: FormData) => {
        setSubmitting(true);
        try {
          const result = (await (formAction as any)(formData)) as ContactActionState;
          if (result?.contactId) {
            const optimistic: any = {
              id: result.contactId,
              customerId,
              firstName: formStr(formData, "firstName") || null,
              lastName: formStr(formData, "lastName"),
              email: formStr(formData, "email") || null,
              phone: formStr(formData, "phone") || null,
              mobile: formStr(formData, "mobile") || null,
              functionTitle: formStr(formData, "functionTitle") || null,
              inserveContactId:
                formNum(formData, "inserveContactId") ?? contact?.inserveContactId ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            };
            onAfterSubmit(optimistic);
          }
        } finally {
          setSubmitting(false);
        }
      }}
      className="space-y-4"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`firstName-${mode}-${contact?.id ?? ""}`}>Voornaam</Label>
          <Input
            id={`firstName-${mode}-${contact?.id ?? ""}`}
            name="firstName"
            defaultValue={contact?.firstName ?? ""}
            placeholder="Bijv. Pieter"
            autoComplete="given-name"
          />
          {state?.errors?.firstName ? (
            <p className="text-xs text-rose-600">{state.errors.firstName.join(" ")}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`lastName-${mode}-${contact?.id ?? ""}`}>Achternaam *</Label>
          <Input
            id={`lastName-${mode}-${contact?.id ?? ""}`}
            name="lastName"
            defaultValue={contact?.lastName ?? ""}
            placeholder="Bijv. Jansen"
            autoComplete="family-name"
            required
          />
          {state?.errors?.lastName ? (
            <p className="text-xs text-rose-600">{state.errors.lastName.join(" ")}</p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`functionTitle-${mode}-${contact?.id ?? ""}`}>Functie</Label>
          <Input
            id={`functionTitle-${mode}-${contact?.id ?? ""}`}
            name="functionTitle"
            defaultValue={contact?.functionTitle ?? ""}
            placeholder="Bijv. Inkoopmanager"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`email-${mode}-${contact?.id ?? ""}`}>E-mailadres</Label>
          <Input
            id={`email-${mode}-${contact?.id ?? ""}`}
            name="email"
            type="email"
            defaultValue={contact?.email ?? ""}
            placeholder="naam@voorbeeld.nl"
            autoComplete="email"
          />
          {state?.errors?.email ? (
            <p className="text-xs text-rose-600">{state.errors.email.join(" ")}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`phone-${mode}-${contact?.id ?? ""}`}>Telefoon (vast)</Label>
          <Input
            id={`phone-${mode}-${contact?.id ?? ""}`}
            name="phone"
            type="tel"
            defaultValue={contact?.phone ?? ""}
            placeholder="Bijv. 070 123 4567"
            autoComplete="tel"
          />
          {state?.errors?.phone ? (
            <p className="text-xs text-rose-600">{state.errors.phone.join(" ")}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`mobile-${mode}-${contact?.id ?? ""}`}>Telefoon (mobiel)</Label>
          <Input
            id={`mobile-${mode}-${contact?.id ?? ""}`}
            name="mobile"
            type="tel"
            defaultValue={contact?.mobile ?? ""}
            placeholder="Bijv. 06 1234 5678"
            autoComplete="tel-mobile"
          />
          {state?.errors?.mobile ? (
            <p className="text-xs text-rose-600">{state.errors.mobile.join(" ")}</p>
          ) : null}
        </div>
        {mode === "create" || (contact && contact.inserveContactId != null) ? (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`inserveContactId-${mode}-${contact?.id ?? ""}`}>Inserve ID (optioneel)</Label>
            <Input
              id={`inserveContactId-${mode}-${contact?.id ?? ""}`}
              name="inserveContactId"
              type="number"
              step={1}
              min={1}
              defaultValue={contact?.inserveContactId ?? ""}
              placeholder="Alleen voor gekoppelde Inserve-contactpersonen"
              disabled={mode === "edit" && contact?.inserveContactId != null}
            />
            {contact?.inserveContactId != null ? (
              <p className="text-xs text-slate-500">
                Dit contact is gekoppeld aan Inserve ID {contact.inserveContactId}; ID kan niet handmatig worden gewijzigd.
              </p>
            ) : null}
            {state?.errors?.inserveContactId ? (
              <p className="text-xs text-rose-600">{state.errors.inserveContactId.join(" ")}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogFooter className="flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={submitting}>
            Annuleren
          </Button>
        </DialogClose>
        <Button type="submit" aria-busy={submitting} disabled={submitting}>
          {submitting ? "Opslaan…" : mode === "edit" ? "Wijzigingen opslaan" : "Contactpersoon toevoegen"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteContactConfirm({
  customerId,
  contact,
  onDeleted,
  onCancel,
}: {
  customerId: string;
  contact: ContactRow;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  return (
    <form
      action={async () => {
        setSubmitting(true);
        try {
          const res: any = await deleteContactAction(customerId, contact.id);
          if (res?.ok) {
            toast.success("Contactpersoon verwijderd.");
            onDeleted();
          } else {
            toast.error(res?.error ?? "Verwijderen mislukt.");
          }
        } finally {
          setSubmitting(false);
        }
      }}
      className="space-y-4"
    >
      <DialogFooter className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Annuleren
        </Button>
        <Button type="submit" variant="destructive" aria-busy={submitting} disabled={submitting}>
          <Trash2 className="h-4 w-4 mr-1.5" /> {submitting ? "Verwijderen…" : "Verwijderen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
