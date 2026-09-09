"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Eye } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import {
  SubscriptionStatusBadge,
  BillingCycleLabel,
} from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { Subscription, SubscriptionStatus } from "@prisma/client";

type ListSubscription = Subscription & {
  customer: { id: string; companyName: string; customerNumber: string };
  product: { id: string; name: string; productCode: string };
};

interface SubscriptionListProps {
  subscriptions: ListSubscription[];
  canCreate: boolean;
  canEdit: boolean;
}

export function SubscriptionList({
  subscriptions,
  canCreate,
  canEdit,
}: SubscriptionListProps) {
  const columns: ColumnDef<ListSubscription>[] = [
    {
      accessorKey: "subscriptionNumber",
      header: "Abonnementnr.",
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/subscriptions/${row.original.id}`}
        >
          {row.getValue("subscriptionNumber")}
        </Link>
      ),
    },
    {
      accessorKey: "customer",
      header: "Klant",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            <Link
              className="underline-offset-4 hover:underline"
              href={`/customers/${row.original.customer.id}`}
            >
              {row.original.customer.companyName}
            </Link>
          </div>
          <div className="text-xs text-slate-500">
            {row.original.customer.customerNumber}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "product",
      header: "Product",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.product.name}</div>
          <div className="text-xs text-slate-500">
            {row.original.product.productCode}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "startDate",
      header: "Startdatum",
      cell: ({ row }) => formatDate(row.getValue("startDate")),
    },
    {
      accessorKey: "endDate",
      header: "Einddatum",
      cell: ({ row }) => {
        const v = row.getValue<Date | null>("endDate");
        return v ? formatDate(v) : <span className="text-slate-400">—</span>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <SubscriptionStatusBadge
          status={row.getValue<SubscriptionStatus>("status") as unknown as string}
        />
      ),
    },
    {
      accessorKey: "monthlyPrice",
      header: "Prijs",
      cell: ({ row }) => {
        const cycle = row.original.billingCycle;
        return (
          <div className="whitespace-nowrap">
            <div className="font-medium">
              {formatCurrency(row.getValue("monthlyPrice"))}
            </div>
            <div className="text-xs text-slate-500">
              <BillingCycleLabel cycle={cycle as unknown as string} />
            </div>
          </div>
        );
      },
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
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abonnementen</h1>
          <p className="text-sm text-slate-500">
            Beheer alle abonnementen in het systeem.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/subscriptions/new">
              <Plus className="mr-2 h-4 w-4" /> Nieuw abonnement
            </Link>
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        data={subscriptions}
        searchPlaceholder="Zoeken op nummer..."
        searchColumnAccessor="subscriptionNumber"
      />
    </div>
  );
}
