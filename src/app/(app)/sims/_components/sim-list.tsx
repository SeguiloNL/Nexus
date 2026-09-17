"use client";

import Link from "next/link";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2, Edit, Upload, Download } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { SimStatusBadge } from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SIM, SimStatus } from "@prisma/client";
import { formatIccid } from "@/lib/formatters";
import { exportSimsCsvAction, bulkSoftDeleteSimsAction, type BulkActionState } from "../actions";

type ListSim = SIM;

interface SimListProps {
  sims: ListSim[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
  canExport: boolean;
}

export function SimList({
  sims,
  canCreate,
  canEdit,
  canDelete,
  canImport,
  canExport,
}: SimListProps) {
  const columns: ColumnDef<ListSim>[] = [
    {
      accessorKey: "iccid",
      header: "ICCID",
      cell: ({ row }) => (
        <Link
          className="font-mono text-xs underline-offset-4 hover:underline"
          href={`/sims/${row.original.id}`}
        >
          {formatIccid(row.getValue<string>("iccid"))}
        </Link>
      ),
    },
    {
      accessorKey: "msisdn",
      header: "MSISDN",
      cell: ({ row }) => {
        const v = row.getValue<string | null>("msisdn");
        return v ? (
          <span className="font-mono text-xs">{v}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "provider",
      header: "Provider",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">
            <Link
              href={`/sims/${row.original.id}`}
              className="underline-offset-4 hover:underline"
            >
              {row.getValue("provider")}
            </Link>
          </div>
          {row.original.simType ? (
            <div className="text-xs text-slate-500">{row.original.simType}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "imsi",
      header: "IMSI",
      cell: ({ row }) => {
        const v = row.original.imsi;
        return v ? (
          <span className="font-mono text-xs">{v}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <SimStatusBadge status={row.getValue<SimStatus>("status")} />
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
                  <Link href={`/sims/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/sims/${id}?tab=edit`}>
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
                      href={`/sims/${id}?tab=delete`}
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
          <h1 className="text-2xl font-bold tracking-tight">SIM-kaarten</h1>
          <p className="text-sm text-slate-500">
            Beheer SIM-kaarten, providers en toewijzingen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport ? (
            <form action={exportSimsCsvAction as any}>
              <Button variant="outline" type="submit">
                <Download className="mr-2 h-4 w-4" /> Exporteer CSV
              </Button>
            </form>
          ) : null}
          {canImport ? (
            <Button variant="outline" asChild>
              <Link href="/sims/import">
                <Upload className="mr-2 h-4 w-4" /> CSV importeren
              </Link>
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild>
              <Link href="/sims/new">
                <Plus className="h-4 w-4" /> Nieuwe SIM
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={sims}
        searchColumnAccessor="iccid"
        searchPlaceholder="Zoek SIM (ICCID, MSISDN, IMSI, provider…)"
        enableRowSelection={canDelete}
        getRowId={(row) => (row as any).id}
        bulkActions={
          canDelete
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r: Row<ListSim>) => r.original.id);
                return (
                  <BulkActionForm
                    action={
                      bulkSoftDeleteSimsAction as (
                        prev: BulkActionState,
                        form: FormData
                      ) => Promise<BulkActionState>
                    }
                    ids={ids}
                    clearSelection={clearSelection}
                    confirmTitle={`${ids.length} SIM-kaart(en) verwijderen?`}
                    confirmDescription="Deze actie archiveert de geselecteerde SIM-kaarten (soft-delete). Dit is ongedaan te maken via de database."
                    confirmConfirmLabel="Verwijderen bevestigen"
                  >
                    <Button variant="destructive" size="sm" type="button">
                      <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                    </Button>
                  </BulkActionForm>
                );
              }
            : undefined
        }
      />
    </div>
  );
}
