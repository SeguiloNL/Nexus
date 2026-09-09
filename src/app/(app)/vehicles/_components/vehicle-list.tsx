"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Trash2 } from "lucide-react";
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
import type { Vehicle } from "@prisma/client";
import { formatLicensePlate, formatVin } from "@/lib/formatters";

type ListVehicle = Vehicle & {
  customer: { id: string; companyName: string } | null;
};

interface VehicleListProps {
  vehicles: ListVehicle[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function VehicleList({
  vehicles,
  canCreate,
  canEdit,
  canDelete,
}: VehicleListProps) {
  const columns: ColumnDef<ListVehicle>[] = [
    {
      accessorKey: "licensePlate",
      header: "Kenteken",
      cell: ({ row }) => {
        const v = row.getValue<string | null>("licensePlate");
        return (
          <Link
            className="font-mono font-medium underline-offset-4 hover:underline"
            href={`/vehicles/${row.original.id}`}
          >
            {v ? formatLicensePlate(v) : <span className="text-slate-400">—</span>}
          </Link>
        );
      },
    },
    {
      accessorKey: "vin",
      header: "VIN",
      cell: ({ row }) => {
        const v = row.original.vin;
        return v ? (
          <span className="font-mono text-xs" title={v}>
            {formatVin(v)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      header: "Klant",
      cell: ({ row }) =>
        row.original.customer ? (
          <Link
            href={`/customers/${row.original.customer.id}`}
            className="underline-offset-4 hover:underline"
          >
            {row.original.customer.companyName}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      accessorKey: "brand",
      header: "Merk / Model",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.brand ?? <span className="text-slate-400">—</span>}</div>
          <div className="text-xs text-slate-500">{row.original.model ?? ""}</div>
        </div>
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
                  <Link href={`/vehicles/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/vehicles/${id}?tab=edit`}>
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
                        href={`/vehicles/${id}?tab=delete`}
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
          <h1 className="text-2xl font-bold tracking-tight">Voertuigen</h1>
          <p className="text-sm text-slate-500">
            Voertuigen van klanten, gekoppeld aan trackers.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/vehicles/new">
              <Plus className="h-4 w-4" /> Nieuw voertuig
            </Link>
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={vehicles}
        searchColumnAccessor="licensePlate"
        searchPlaceholder="Zoek voertuig (kenteken, VIN, merk…"
      />
    </div>
  );
}
