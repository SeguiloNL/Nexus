"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2, Edit } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { CustomerStatusBadge } from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Customer, CustomerStatus } from "@prisma/client";

type ListCustomer = Customer & {
  parentCustomer: { id: string; companyName: string } | null;
};

interface CustomerListProps {
  customers: ListCustomer[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  viewerRoleCanEdit?: boolean;
}

export function CustomerList({
  customers,
  canCreate,
  canEdit,
  canDelete,
}: CustomerListProps) {
  const columns: ColumnDef<ListCustomer>[] = [
    {
      accessorKey: "customerNumber",
      header: "Klantnr.",
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/customers/${row.original.id}`}
        >
          {row.getValue("customerNumber")}
        </Link>
      ),
    },
    {
      accessorKey: "companyName",
      header: "Bedrijf",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            <Link
              className="underline-offset-4 hover:underline"
              href={`/customers/${row.original.id}`}
            >
              {row.getValue("companyName")}
            </Link>
          </div>
          {row.original.parentCustomer?.companyName ? (
            <div className="text-xs text-slate-500">
              {row.original.parentCustomer.companyName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "contactPerson",
      header: "Contactpersoon",
      cell: ({ row }) => {
        const v = row.getValue<string | null>("contactPerson");
        return v || <span className="text-slate-400">—</span>;
      },
    },
    {
      accessorKey: "city",
      header: "Plaats",
      cell: ({ row }) => {
        const city = row.getValue<string | null>("city");
        const pc = row.original.postalCode;
        return (
          <span className="whitespace-nowrap">
            {pc} {city || ""}
            {!city && !pc ? <span className="text-slate-400">—</span> : null}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <CustomerStatusBadge
          status={row.getValue<CustomerStatus>("status")}
        />
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
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/customers/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/customers/${id}?tab=edit`}>
                      <Edit className="mr-2 h-4 w-4" /> Bewerken
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                {canDelete ? (
                  <DropdownMenuItem
                    className="text-red-600 focus:bg-red-50 focus:text-red-700"
                    asChild
                  >
                    <Link
                      className="flex items-center"
                      href={`/customers/${id}?tab=delete`}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
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
          <h1 className="text-2xl font-bold tracking-tight">Klanten</h1>
          <p className="text-sm text-slate-500">
            Beheer je klanten, subklanten en contactgegevens.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/customers/new">
              <Plus className="h-4 w-4" /> Nieuwe klant
            </Link>
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={customers}
        searchColumnAccessor="companyName"
        searchPlaceholder="Zoek klant (naam, nr, contact, plaats, e-mail…)"
      />
    </div>
  );
}
