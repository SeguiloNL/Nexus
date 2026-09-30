"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2, Edit, Upload, Download, Filter, RefreshCw, AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { SimStatusBadge, SIM_STATUS } from "@/components/ui/status-badges";
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
import {
  exportSimsCsvAction,
  bulkSoftDeleteSimsAction,
  syncUsageSimsAction,
  type BulkActionState,
} from "../actions";
import { useMemo, useRef, useEffect, useState, useTransition } from "react";

type ListSim = SIM;

const STATUS_OPTIONS: Array<{ value: SimStatus | "__ALL__"; label: string }> = [
  { value: "__ALL__", label: "Alle statussen" },
  ...(Object.entries(SIM_STATUS) as Array<[SimStatus, { label: string; variant: string }]>)
    .sort((a, b) => a[1].label.localeCompare(b[1].label, "nl"))
    .map(([value, cfg]) => ({ value, label: cfg.label })),
];

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
  const [statusFilter, setStatusFilter] = useState<SimStatus | "__ALL__">("__ALL__");
  const [syncState, syncFormAction, syncPendingNative] = useFormState(syncUsageSimsAction, {
    ok: false,
  } as BulkActionState);

  const [isSyncPendingClient, setIsSyncPendingClient] = useState(false);
  const [isSyncTransitioning, startSyncTransition] = useTransition();
  const syncSubmittedRef = useRef(false);
  const prevSyncStateRef = useRef(syncState);

  const syncPending = isSyncPendingClient || isSyncTransitioning || syncPendingNative;

  useEffect(() => {
    const prev = prevSyncStateRef.current;
    const curr = syncState;
    const stateChanged =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        prev?.message !== curr?.message ||
        prev?.error !== curr?.error);
    if (stateChanged || (!syncPendingNative && isSyncPendingClient)) {
      syncSubmittedRef.current = false;
      setIsSyncPendingClient(false);
    }
    prevSyncStateRef.current = curr;
  }, [syncState, syncPendingNative, isSyncPendingClient]);

  function onSyncSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (syncSubmittedRef.current || syncPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    syncSubmittedRef.current = true;
    setIsSyncPendingClient(true);
    startSyncTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        await syncFormAction(fd);
      } finally {
        setIsSyncPendingClient(false);
      }
    });
    e.preventDefault();
  }

  const filteredSims = useMemo(() => {
    if (statusFilter === "__ALL__") return sims;
    return sims.filter((s) => s.status === statusFilter);
  }, [sims, statusFilter]);

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
        <div className="flex flex-wrap items-center gap-2">
          {canExport ? (
            <form action={exportSimsCsvAction as any}>
              <Button variant="outline" type="submit" disabled={syncPending}>
                <Download className="mr-2 h-4 w-4" /> Exporteer CSV
              </Button>
            </form>
          ) : null}
          {canEdit ? (
            <form
              action={syncFormAction as any}
              className="inline-flex"
              onSubmit={onSyncSubmit}
            >
              <Button
                variant={syncPending ? "default" : "outline"}
                type="submit"
                disabled={syncPending}
                aria-disabled={syncPending}
                aria-busy={syncPending}
                className={
                  "gap-2 " +
                  (syncPending
                    ? "cursor-not-allowed border-blue-500 bg-blue-600 text-white hover:bg-blue-600"
                    : "")
                }
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {syncPending ? (
                  <span className="whitespace-nowrap">Bezig met synchroniseren...</span>
                ) : (
                  <span className="whitespace-nowrap">Verbruik sync</span>
                )}
              </Button>
            </form>
          ) : null}
          {canImport ? (
            <Button variant="outline" asChild disabled={syncPending}>
              <Link href="/sims/import">
                <Upload className="mr-2 h-4 w-4" /> CSV importeren
              </Link>
            </Button>
          ) : null}
          {canCreate ? (
            <Button asChild disabled={syncPending}>
              <Link href="/sims/new">
                <Plus className="h-4 w-4" /> Nieuwe SIM
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {syncPending ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-md border border-blue-300 bg-blue-50 px-3.5 py-2.5 text-sm shadow-sm"
        >
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-blue-900">Verbruikssynchronisatie bezig...</p>
            <p className="text-blue-800/90">
              De meest recente verbruiksgegevens worden voor alle actieve SIM-kaarten opgehaald bij Simhuis. Dit kan enkele seconden tot een minuut duren, afhankelijk van het aantal SIMs.
            </p>
          </div>
        </div>
      ) : null}

      {!syncPending && syncState?.message ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm"
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 text-base leading-none">✓</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-emerald-900">Synchronisatie voltooid</p>
            <p className="whitespace-pre-wrap break-words text-emerald-800/90">{syncState.message}</p>
          </div>
        </div>
      ) : null}
      {!syncPending && syncState?.error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 shadow-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-red-900">Synchronisatie mislukt</p>
            <p className="whitespace-pre-wrap break-words text-red-800/90">{syncState.error}</p>
            {canEdit ? (
              <p className="mt-1 text-xs text-red-700/80">
                Controleer de netwerkverbinding of probeer het later opnieuw. Neem contact op met de beheerder als het probleem blijft bestaan.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" /> Filter
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SimStatus | "__ALL__")}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {statusFilter !== "__ALL__" ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setStatusFilter("__ALL__")}
              className="h-8 text-xs text-slate-600 hover:text-slate-900"
            >
              Filter wissen
            </Button>
          ) : null}
        </div>
        <div className="ml-auto text-xs text-slate-500">
          {filteredSims.length} van {sims.length} SIM-kaarten
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredSims}
        searchColumnAccessors={["iccid", "msisdn", "imsi", "provider"]}
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
