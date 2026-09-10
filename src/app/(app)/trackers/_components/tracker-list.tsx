"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2, Edit, Upload, Download } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { TrackerStatusBadge } from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Tracker, TrackerStatus } from "@prisma/client";
import { formatImei } from "@/lib/formatters";
import { exportTrackersCsvAction } from "../actions";

type ListTracker = Tracker;

interface TrackerListProps {
  trackers: ListTracker[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
  canExport: boolean;
}

export function TrackerList({
  trackers,
  canCreate,
  canEdit,
  canDelete,
  canImport,
  canExport,
}: TrackerListProps) {
  const columns: ColumnDef<ListTracker>[] = [
    {
      accessorKey: "serialNumber",
      header: "Serienummer",
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/trackers/${row.original.id}`}
        >
          {row.getValue("serialNumber")}
        </Link>
      ),
    },
    {
      accessorKey: "imei",
      header: "IMEI",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatImei(row.getValue<string>("imei"))}
        </span>
      ),
    },
    {
      accessorKey: "brand",
      header: "Merk",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.getValue("brand")}</div>
          <div className="text-xs text-slate-500">{row.original.model}</div>
        </div>
      ),
    },
    {
      accessorKey: "supplier",
      header: "Leverancier",
      cell: ({ row }) => {
        const v = row.getValue<string | null>("supplier");
        return v || <span className="text-slate-400">—</span>;
      },
    },
    {
      accessorKey: "purchaseDate",
      header: "Aankoop",
      cell: ({ row }) => {
        const v = row.original.purchaseDate;
        return v ? v.toISOString().slice(0, 10) : <span className="text-slate-400">—</span>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <TrackerStatusBadge
          status={row.getValue<TrackerStatus>("status")}
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
                  <Link href={`/trackers/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/trackers/${id}?tab=edit`}>
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
                      href={`/trackers/${id}?tab=delete`}
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
          <h1 className="text-2xl font-bold tracking-tight">Trackers</h1>
          <p className="text-sm text-slate-500">
            GPS-trackers voorraad, kenmerken en toewijzingen beheren.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport ? (
            <form action={exportTrackersCsvAction as any}>
              <Button variant="outline" type="submit">
                <Download className="mr-2 h-4 w-4" /> Exporteer CSV
              </Button>
            </form>
          ) : null}
          {canImport ? (
            <Button variant="outline" asChild>
              <Link href="/trackers/import">
                <Upload className="mr-2 h-4 w-4" /> CSV importeren
              </Link>
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild>
              <Link href="/trackers/new">
                <Plus className="h-4 w-4" /> Nieuwe tracker
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={trackers}
        searchColumnAccessor="serialNumber"
        searchPlaceholder="Zoek tracker (serienr, IMEI, merk, model…)"
      />
    </div>
  );
}
