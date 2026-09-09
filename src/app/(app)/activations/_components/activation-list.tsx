"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, MoreHorizontal, Eye, Edit, Ban, Play, AlertTriangle } from "lucide-react";
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
import { ActivationOrderStatusBadge } from "@/components/ui/status-badges";
import { formatDate, formatImei, formatIccid, formatCurrency } from "@/lib/formatters";
import type { ActivationOrder, Customer, Product, Tracker, SIM, Subscription, Vehicle } from "@prisma/client";

type Row = ActivationOrder & {
  customer?: Pick<Customer, "id" | "companyName" | "customerNumber"> | null;
  product?: Pick<Product, "id" | "productCode" | "name"> | null;
  tracker?: Pick<Tracker, "id" | "serialNumber" | "imei"> | null;
  sim?: Pick<SIM, "id" | "iccid" | "msisdn"> | null;
  subscription?: Pick<Subscription, "id" | "subscriptionNumber" | "status"> | null;
  vehicle?: Pick<Vehicle, "id" | "licensePlate"> | null;
};

interface Props {
  orders: Row[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ActivationOrderList({ orders, canCreate, canEdit, canDelete }: Props) {
  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: "orderNumber",
      header: "Ordernummer",
      cell: ({ row }) => (
        <Link
          href={`/activations/${row.original.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.orderNumber}
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
      header: "Product",
      cell: ({ row }) =>
        row.original.product ? (
          <div>
            <div className="font-medium">{row.original.product.name}</div>
            <div className="text-xs text-slate-500">
              {row.original.product.productCode}
            </div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      accessorKey: "desiredStartDate",
      header: "Gewenste start",
      cell: ({ row }) => formatDate(row.original.desiredStartDate),
    },
    {
      header: "Maandprijs",
      cell: ({ row }) =>
        formatCurrency(String(row.original.monthlyPrice ?? 0)),
    },
    {
      header: "Tracker",
      cell: ({ row }) => {
        const t = row.original.tracker;
        return t ? (
          <div>
            <Link
              href={`/trackers/${t.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t.serialNumber}
            </Link>
            <div className="text-xs font-mono text-slate-500">
              {formatImei(t.imei)}
            </div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      header: "SIM",
      cell: ({ row }) => {
        const s = row.original.sim;
        return s ? (
          <div>
            <Link
              href={`/sims/${s.id}`}
              className="font-mono text-xs underline-offset-4 hover:underline"
            >
              {formatIccid(s.iccid)}
            </Link>
            {s.msisdn ? (
              <div className="text-xs text-slate-500">{s.msisdn}</div>
            ) : null}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <ActivationOrderStatusBadge
          status={row.original.status as any}
        />
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const id = row.original.id;
        const st = row.original.status;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/activations/${id}`}>
                    <Eye className="mr-2 h-4 w-4" /> Details bekijken
                  </Link>
                </DropdownMenuItem>
                {canEdit && st === "DRAFT" ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/activations/wizard?orderId=${id}`}>
                      <Edit className="mr-2 h-4 w-4" /> Wizard (bewerken)
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canEdit && (st === "FAILED" || st === "READY") ? (
                  <DropdownMenuSeparator />
                ) : null}
                {canEdit && st === "FAILED" ? (
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/activations/${id}?action=retry`}
                      className="text-amber-600"
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" /> Opnieuw proberen
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canDelete && (st === "DRAFT" || st === "READY") ? (
                  <DropdownMenuItem asChild className="text-red-600 focus:bg-red-50 focus:text-red-700">
                    <Link href={`/activations/${id}?action=cancel`}>
                      <Ban className="mr-2 h-4 w-4" /> Annuleren
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activaties</h1>
          <p className="text-sm text-slate-500">
            Order overzicht en activatie status.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/activations/wizard">
              <Plus className="h-4 w-4" /> Nieuwe activatie
            </Link>
          </Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={orders}
        searchColumnAccessor="orderNumber"
        searchPlaceholder="Zoek order (nr, tracker, sim, klant…"
      />
    </div>
  );
}
