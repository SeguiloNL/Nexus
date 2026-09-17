"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Edit, Eye, Trash2, FileText, Loader2, UploadCloud, ExternalLink, Ban } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
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
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GenerateInvoicesState, BulkActionState } from "../actions";
import {
  syncSubscriptionFromListAction,
  bulkCancelSubscriptionsAction,
  bulkSoftDeleteSubscriptionsAction,
} from "../actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SubscriptionStatusBadge } from "@/components/ui/status-badges";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { Subscription, Customer, Product, InserveSyncStatus } from "@prisma/client";

type ListSub = Subscription & {
  customer: { id: string; customerNumber: string; companyName: string } | null;
  product: { id: string; productCode: string; name: string } | null;
  inserveSyncStatus?: InserveSyncStatus | null;
  inserveSubscriptionId?: number | null;
  inserveSyncError?: string | null;
};

interface Props {
  subscriptions: ListSub[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canGenerateInvoices: boolean;
  generateMonthlyInvoicesAction: (
    prev: GenerateInvoicesState,
    form: FormData
  ) => Promise<GenerateInvoicesState>;
}

export function SubscriptionList({
  subscriptions,
  canCreate,
  canEdit,
  canDelete,
  canGenerateInvoices,
  generateMonthlyInvoicesAction,
}: Props) {
  const columns: ColumnDef<ListSub>[] = [
    {
      accessorKey: "subscriptionNumber",
      header: "Abonnementnummer",
      cell: ({ row }) => (
        <Link
          href={`/subscriptions/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.subscriptionNumber}
        </Link>
      ),
    },
    {
      accessorKey: "customer",
      header: "Klant",
      cell: ({ row }) => {
        const c = row.original.customer;
        return c ? (
          <div>
            <Link
              href={`/customers/${c.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {c.companyName}
            </Link>
            <div className="text-xs text-slate-500">{c.customerNumber}</div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      header: "Product",
      cell: ({ row }) => {
        const p = row.original.product;
        return p ? (
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-slate-500">{p.productCode}</div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "monthlyPrice",
      header: "Maandprijs",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(String(row.original.monthlyPrice))}
        </span>
      ),
    },
    {
      accessorKey: "startDate",
      header: "Startdatum",
      cell: ({ row }) => formatDate(row.original.startDate),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <SubscriptionStatusBadge status={row.original.status as any} />
      ),
    },
    {
      id: "inserveSync",
      header: "Inserve sync",
      cell: ({ row }) => {
        const st = row.original;
        const status = st.inserveSyncStatus;
        const inserveId = st.inserveSubscriptionId;
        if (!status) {
          return <span className="text-slate-400">—</span>;
        }
        let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
        let label: string = status;
        switch (status) {
          case "PENDING":
            variant = "secondary";
            label = "Wachten";
            break;
          case "IN_PROGRESS":
            variant = "default";
            label = "Bezig…";
            break;
          case "SYNCED":
            variant = "default";
            label = "Gesynchroniseerd";
            break;
          case "FAILED":
            variant = "destructive";
            label = "Mislukt";
            break;
          case "SKIPPED":
            variant = "outline";
            label = "Overgeslagen";
            break;
        }
        return (
          <div className="flex flex-col gap-1">
            <Badge variant={variant} className="w-fit text-xs">
              {label}
            </Badge>
            {status === "SYNCED" && inserveId ? (
              <a
                href={`https://${process.env.NEXT_PUBLIC_INSERVE_SUBDOMAIN ?? ""}.inserve.nl/subscriptions/${inserveId}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Inserve #{inserveId}
              </a>
            ) : null}
            {status === "FAILED" && st.inserveSyncError ? (
              <div
                className="max-w-[220px] truncate text-xs text-rose-600"
                title={st.inserveSyncError}
              >
                {st.inserveSyncError}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const id = row.original.id;
        const syncStatus = row.original.inserveSyncStatus;
        const canSync = canEdit && syncStatus !== "IN_PROGRESS";
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/subscriptions/${id}`}>
                    <Eye className="mr-2 h-4 w-4" /> Details bekijken
                  </Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/subscriptions/${id}?tab=edit`}>
                      <Edit className="mr-2 h-4 w-4" /> Bewerken
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canSync ? (
                  <DropdownMenuItem asChild>
                    <form
                      action={syncSubscriptionFromListAction as any}
                      className="w-full"
                    >
                      <input type="hidden" name="id" value={id} required />
                      <button
                        type="submit"
                        className="flex items-center w-full text-left"
                      >
                        <UploadCloud className="mr-2 h-4 w-4" /> Sync naar Inserve
                      </button>
                    </form>
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      asChild
                      className="text-red-600 focus:bg-red-50 focus:text-red-700"
                    >
                      <Link href={`/subscriptions/${id}?tab=delete`}>
                        <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                      </Link>
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abonnementen</h1>
          <p className="text-sm text-slate-500">
            Overzicht van alle abonnementen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canGenerateInvoices ? (
            <GenerateInvoicesDialog action={generateMonthlyInvoicesAction} />
          ) : null}
          {canCreate ? (
            <Button asChild>
              <Link href="/subscriptions/new">
                <Plus className="h-4 w-4" /> Nieuw abonnement
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={subscriptions}
        searchColumnAccessor="subscriptionNumber"
        searchPlaceholder="Zoek abonnement (nr, klant, product…"
        enableRowSelection={canEdit || canDelete}
        getRowId={(row) => (row as any).id}
        bulkActions={
          canEdit || canDelete
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r: Row<ListSub>) => r.original.id);
                return (
                  <>
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkCancelSubscriptionsAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} abonnement(en) annuleren?`}
                        confirmDescription="De geselecteerde abonnementen worden op status CANCELLED gezet. Er wordt geen pro-rata verrekening gedaan."
                        confirmConfirmLabel="Annuleren bevestigen"
                      >
                        <Button variant="destructive" size="sm" type="button">
                          <Ban className="mr-2 h-4 w-4" /> Annuleren
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canDelete ? (
                      <BulkActionForm
                        action={
                          bulkSoftDeleteSubscriptionsAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} abonnement(en) verwijderen?`}
                        confirmDescription="Deze actie archiveert de geselecteerde abonnementen (soft-delete). Dit is ongedaan te maken via de database."
                        confirmConfirmLabel="Verwijderen bevestigen"
                      >
                        <Button variant="destructive" size="sm" type="button">
                          <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                        </Button>
                      </BulkActionForm>
                    ) : null}
                  </>
                );
              }
            : undefined
        }
      />
    </div>
  );
}

function GenerateInvoicesDialog({
  action,
}: {
  action: (prev: GenerateInvoicesState, form: FormData) => Promise<GenerateInvoicesState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(action, {} as GenerateInvoicesState);
  const [isPending, startTransition] = useTransition();

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  function onSubmit(formEl: HTMLFormElement) {
    startTransition(() => {
      const fd = new FormData(formEl);
      formAction(fd);
    });
  }

  if (state.ok && state.message && !open) {
    toast.success(state.message);
  } else if (state.error && state.message && !open) {
    toast.error(state.message);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileText className="h-4 w-4" /> Genereer maandfacturen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Maandfacturen genereren</DialogTitle>
          <DialogDescription>
            Genereer concept-facturen voor alle actieve/opgeschorte abonnementen
            voor de geselecteerde maand. Bestaande facturen voor dezelfde
            periode worden overgeslagen.
          </DialogDescription>
        </DialogHeader>
        <form
          action={formAction as any}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(e.currentTarget);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="year">Jaar</Label>
              <Input
                id="year"
                name="year"
                type="number"
                min={2000}
                max={2100}
                defaultValue={defaultYear}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Maand (1-12)</Label>
              <Input
                id="month"
                name="month"
                type="number"
                min={1}
                max={12}
                defaultValue={defaultMonth}
                required
              />
            </div>
          </div>

          {state.message ? (
            <div
              className={`rounded-md border p-3 text-sm ${
                state.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {state.message}
              {state.errors && state.errors.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {state.errors.map((e, i) => (
                    <li key={i}>
                      • {e.subscriptionNumber ?? e.subscriptionId}: {e.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {state.error && !state.message ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {state.error}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">Sluiten</Button>
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Genereren…
                </>
              ) : (
                <>Facturen genereren</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
