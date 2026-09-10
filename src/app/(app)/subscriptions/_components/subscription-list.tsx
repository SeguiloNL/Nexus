"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Edit, Eye, Trash2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
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
import type { GenerateInvoicesState } from "../actions";
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
import type { Subscription, Customer, Product } from "@prisma/client";

type ListSub = Subscription & {
  customer: { id: string; customerNumber: string; companyName: string } | null;
  product: { id: string; productCode: string; name: string } | null;
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
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const id = row.original.id;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
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
