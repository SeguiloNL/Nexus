import Link from "next/link";
import { useFormState } from "react-dom";
import type { ColumnDef, Row, SortingFn } from "@tanstack/react-table";
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
import { formatBytes, formatIccid } from "@/lib/formatters";
import { SIM_PROVIDER_UI_LABELS } from "@/lib/providers/provider-registry";
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
  canSyncUsage: boolean;
}

// ============================================================
// 🆕 MiniUsageCell — compacte verbruiksindicatie kolom SIM-lijst
//    Gebruikt: dataUsedBytes / dataLimitBytes / lowestDataLimitBytes
//    Kleine variant van UsageProgress in sim-detail.tsx
// ============================================================
function MiniUsageCell({ sim }: { sim: ListSim }) {
  const used = sim.dataUsedBytes; // bigint | null
  const limitRaw = sim.dataLimitBytes;
  const threshold = sim.lowestDataLimitBytes;
  const limit: bigint | null = limitRaw ?? threshold; // fallback: laagste drempel als limiet

  const hasUsage = used !== null && used !== undefined;
  const hasLimit = limit !== null && limit !== undefined && limit > 0n;

  if (!hasUsage && !hasLimit) {
    return (
      <div className="flex min-h-[40px] items-center">
        <span className="text-[11px] text-slate-400">—</span>
      </div>
    );
  }

  let pct = 0;
  let overschreden = false;
  if (hasLimit && hasUsage) {
    if (limit === 0n) {
      pct = 0;
    } else {
      const num = Number(used) / Number(limit) * 100;
      pct = Math.min(100, Math.max(0, num));
      overschreden = used > limit;
    }
  }

  let barColor = "bg-emerald-500";
  let pctColor = "text-emerald-700";

  if (!hasLimit) {
    barColor = "bg-slate-300";
    pctColor = "text-slate-600";
  } else if (overschreden) {
    barColor = "bg-red-500";
    pctColor = "text-red-700";
  } else if (pct >= 90) {
    barColor = "bg-red-500";
    pctColor = "text-red-700";
  } else if (threshold && hasUsage && used >= threshold) {
    barColor = "bg-amber-500";
    pctColor = "text-amber-700";
  }

  const fmtUsed = formatBytes(used ?? null, 1);
  const fmtLimit = hasLimit ? formatBytes(limit, 1) : "Onbeperkt";

  return (
    <div className="flex w-full min-w-[180px] flex-col gap-1.5 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-[11px] leading-tight">
          <span className="font-semibold text-slate-900">{fmtUsed}</span>
          <span className="text-slate-500"> van {fmtLimit}</span>
        </div>
        {hasLimit ? (
          <div className={`text-[11px] font-bold tabular-nums ${pctColor}`}>
            {overschreden ? (
              <span className="inline-flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" />
                100%
              </span>
            ) : pct >= 90 ? (
              <span className="inline-flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" />
                {pct.toFixed(0)}%
              </span>
            ) : (
              <span>{pct.toFixed(0)}%</span>
            )}
          </div>
        ) : null}
      </div>
      {hasLimit ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, overschreden ? 100 : 0)}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full w-full rounded-full ${barColor}`} />
        </div>
      )}
    </div>
  );
}

export function SimList({
  sims,
  canCreate,
  canEdit,
  canDelete,
  canImport,
  canExport,
  canSyncUsage,
}: SimListProps) {
  const [statusFilter, setStatusFilter] = useState<SimStatus | "__ALL__">("__ALL__");
  const [syncState, syncFormAction, syncPendingNative] = useFormState(syncUsageSimsAction, {
    ok: false,
  } as BulkActionState);

  const [isSyncPendingClient, setIsSyncPendingClient] = useState(false);
  const [isSyncTransitioning, startSyncTransition] = useTransition();
  const syncSubmittedRef = useRef(false);
  const prevSyncStateRef = useRef(syncState);
  const syncEmergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (syncEmergencyTimerRef.current) {
        clearTimeout(syncEmergencyTimerRef.current);
        syncEmergencyTimerRef.current = null;
      }
    }
    prevSyncStateRef.current = curr;
  }, [syncState, syncPendingNative]); // ✅ FIX: GEEN isSyncPendingClient (eigen-dep infinite loop!)

  useEffect(() => {
    return () => {
      if (syncEmergencyTimerRef.current) {
        clearTimeout(syncEmergencyTimerRef.current);
        syncEmergencyTimerRef.current = null;
      }
    };
  }, []);

  function onSyncSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (syncSubmittedRef.current || syncPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    syncSubmittedRef.current = true;
    setIsSyncPendingClient(true);
    // 🚨 NOOD-STOP: 90 seconden max voor bulk sync 327 SIMs
    if (syncEmergencyTimerRef.current) clearTimeout(syncEmergencyTimerRef.current);
    syncEmergencyTimerRef.current = setTimeout(() => {
      console.warn('[sim-list] ⏹️ Verbruik sync noodstop na 90s timeout.');
      syncSubmittedRef.current = false;
      setIsSyncPendingClient(false);
      syncEmergencyTimerRef.current = null;
    }, 90_000);
    startSyncTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        await syncFormAction(fd);
      } catch (err: any) {
        console.error('[sim-list] Bulk usage sync action exception:', err);
      } finally {
        setIsSyncPendingClient(false);
        syncSubmittedRef.current = false;
        if (syncEmergencyTimerRef.current) {
          clearTimeout(syncEmergencyTimerRef.current);
          syncEmergencyTimerRef.current = null;
        }
      }
    });
    e.preventDefault();
  }

  const filteredSims = useMemo(() => {
    if (statusFilter === "__ALL__") return sims;
    return sims.filter((s) => s.status === statusFilter);
  }, [sims, statusFilter]);

  const columns: ColumnDef<ListSim>[] = useMemo(() => [
    {
      accessorKey: "iccid",
      header: "ICCID",
      enableSorting: true,
      sortingFn: "alphanumeric",
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
      enableSorting: true,
      sortingFn: "alphanumeric",
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
      enableSorting: true,
      sortingFn: "alphanumeric",
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
      enableSorting: true,
      sortingFn: "alphanumeric",
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
      enableSorting: true,
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <SimStatusBadge status={row.getValue<SimStatus>("status")} />
      ),
    },
    {
      id: "usage",
      accessorFn: (row) => row.dataUsedBytes,
      header: "Verbruik",
      enableSorting: true,
      sortDescFirst: true,
      sortingFn: (rowA, rowB) => {
        const rA = rowA.original.dataUsedBytes as unknown as bigint | string | null | undefined;
        const rB = rowB.original.dataUsedBytes as unknown as bigint | string | null | undefined;
        const aLeeg = rA === null || rA === undefined || rA === "";
        const bLeeg = rB === null || rB === undefined || rB === "";
        if (aLeeg && bLeeg) return 0;
        if (aLeeg) return 1;
        if (bLeeg) return -1;
        let a: bigint;
        let b: bigint;
        try { a = typeof rA === "bigint" ? rA : BigInt(String(rA)); } catch { a = 0n; }
        try { b = typeof rB === "bigint" ? rB : BigInt(String(rB)); } catch { b = 0n; }
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      },
      cell: ({ row }) => <MiniUsageCell sim={row.original} />,
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
                <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                  <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
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
  ], [canEdit, canDelete]);

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
          {canSyncUsage ? (
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
              {SIM_PROVIDER_UI_LABELS.usageSyncProgress()}
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
