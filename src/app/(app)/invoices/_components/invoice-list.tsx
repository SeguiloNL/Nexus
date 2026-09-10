"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText, MoreHorizontal, CheckCircle, Ban } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { InvoiceStatusBadge } from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Invoice, InvoiceStatus } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { PaginatedResult } from "@/types/domain";
import type { UserRole } from "@/types/enums";
import { canUserRole } from "@/lib/auth/session";
import { markInvoicePaidAction, deleteInvoiceAction } from "../../subscriptions/actions";

type ListInvoice = any;

interface Props {
  result: PaginatedResult<ListInvoice>;
}

export function InvoiceList({ result }: Props) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = canUserRole(role as UserRole, "edit", "invoice");
  const canDelete = canUserRole(role as UserRole, "delete", "invoice");

  const actionsCol = {
    id: "actions",
    header: "Acties",
    cell: ({ row }: any) => {
      const st = row.original;
      const paid = st.status === "PAID";
      const cancelled = st.status === "CANCELLED";
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Factuuracties</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canEdit && !paid && !cancelled ? (
              <DropdownMenuItem asChild>
                <form
                  action={markInvoicePaidAction as any}
                  className="w-full"
                >
                  <input type="hidden" name="id" value={st.id} required />
                  <button
                    type="submit"
                    className="flex items-center w-full text-left"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" /> Markeer betaald
                  </button>
                </form>
              </DropdownMenuItem>
            ) : null}
            {canDelete && !paid && !cancelled ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <form
                    action={deleteInvoiceAction as any}
                    className="w-full"
                  >
                    <input type="hidden" name="id" value={st.id} required />
                    <button
                      type="submit"
                      className="flex items-center w-full text-left text-red-600"
                    >
                      <Ban className="mr-2 h-4 w-4" /> Annuleren
                    </button>
                  </form>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  } as ColumnDef<ListInvoice>;

  const cols: ColumnDef<ListInvoice>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Factuurnummer",
      cell: ({ row }) => (
        <Link
          href={`/subscriptions/${row.original.subscriptionId}#facturen`}
          className="font-mono font-medium"
        >
          {row.original.invoiceNumber}
        </Link>
      ),
    },
    {
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
      header: "Abonnement",
      cell: ({ row }) => {
        const s = row.original.subscription;
        return s ? (
          <Link
            href={`/subscriptions/${s.id}`}
            className="font-mono text-xs font-medium underline-offset-4 hover:underline"
          >
            {s.subscriptionNumber}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "issueDate",
      header: "Factuurdatum",
      cell: ({ row }) => formatDate(row.original.issueDate),
    },
    {
      accessorKey: "dueDate",
      header: "Vervaldatum",
      cell: ({ row }) => formatDate(row.original.dueDate),
    },
    {
      header: "Periode",
      cell: ({ row }) => (
        <div className="text-xs">
          <div>{formatDate(row.original.periodStart)}</div>
          <div className="text-slate-500">
            t/m {formatDate(row.original.periodEnd)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "total",
      header: "Totaal",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(String(row.original.total))}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <InvoiceStatusBadge status={row.original.status as InvoiceStatus} />
      ),
    },
  ];

  if (canEdit || canDelete) cols.push(actionsCol);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileText className="h-6 w-6" /> Facturen
          </h1>
          <p className="text-sm text-slate-500">
            Overzicht van alle gegenereerde facturen met doorberekening.
          </p>
        </div>
      </div>

      <DataTable
        columns={cols as ColumnDef<any>[]}
        data={result.data}
        totalCount={result.total}
        searchColumnAccessor="invoiceNumber"
        searchPlaceholder="Zoek factuur (nr, klant, notitie…)"
      />
    </div>
  );
}
