"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Edit, Eye, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
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
}

export function SubscriptionList({
  subscriptions,
  canCreate,
  canEdit,
  canDelete,
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
        {canCreate ? (
          <Button asChild>
            <Link href="/subscriptions/new">
              <Plus className="h-4 w-4" /> Nieuw abonnement
            </Link>
          </Button>
        ) : null}
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
