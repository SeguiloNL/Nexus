"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Power, PowerOff, Trash2, Database } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DataPlan } from "@prisma/client";
import { formatCurrency } from "@/lib/formatters";
import { formatDataBundle } from "@/server/services/data-plan.service";
import { toast } from "sonner";
import {
  bulkActivateDataPlansAction,
  bulkDeactivateDataPlansAction,
  bulkDeleteDataPlansAction,
  deleteDataPlanAction,
  type BulkActionState,
} from "../actions";

type ListDataPlan = DataPlan;

interface DataPlanListProps {
  dataPlans: ListDataPlan[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function DeleteRowDialog({
  dataPlan,
  canDelete,
}: {
  dataPlan: ListDataPlan;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenuItem
        disabled={!canDelete}
        className="text-red-600 focus:bg-red-50 focus:text-red-700"
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dataplan verwijderen</DialogTitle>
            <DialogDescription>
              Weet je zeker dat je het dataplan{" "}
              <strong>{dataPlan.name}</strong> wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
              Gebruikte plannen (met actieve SIM, abonnement of order) kunnen NIET verwijderd
              worden; deactiveer ze in plaats daarvan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteDataPlanAction(dataPlan.id);
                  if (result.ok) {
                    toast.success(result.message ?? "Dataplan verwijderd.");
                    setOpen(false);
                  } else {
                    toast.error(result.error ?? "Verwijderen mislukt.");
                  }
                });
              }}
            >
              {isPending ? "Bezig…" : "Definitief verwijderen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DataPlanList({ dataPlans, canCreate, canEdit, canDelete }: DataPlanListProps) {
  const columns: ColumnDef<ListDataPlan>[] = [
    {
      accessorKey: "name",
      header: "Naam",
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/data-plans/${row.original.id}`}
        >
          {row.getValue("name")}
        </Link>
      ),
    },
    {
      id: "dataBundle",
      header: "Bundel",
      cell: ({ row }) => (
        <span>
          <Database className="inline mr-1.5 h-3.5 w-3.5 text-slate-500" />
          {formatDataBundle(
            row.original.dataAmountBytes,
            String(row.original.dataAmountDisplayUnit ?? "")
          )}
        </span>
      ),
    },
    {
      accessorKey: "validityDays",
      header: "Geldigheid",
      cell: ({ row }) => {
        const v: any = row.original.validityDays;
        const cycle: any = row.original.validityBillingCycle;
        if (v != null) return `${v} dagen`;
        if (cycle) return String(cycle).toLowerCase();
        return <span className="text-slate-400">—</span>;
      },
    },
    {
      accessorKey: "provider",
      header: "Provider",
      cell: ({ row }) => {
        const v = row.getValue("provider") as string | null;
        return v ? (
          <Badge variant="outline">{v}</Badge>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "monthlyPrice",
      header: "Prijs / mnd",
      cell: ({ row }) => {
        const price: any = row.getValue("monthlyPrice");
        const currency = (row.original as any).currency ?? "EUR";
        if (price == null) return <span className="text-slate-400">—</span>;
        return (
          <span className="font-mono">
            {formatCurrency(String(price), currency)}
          </span>
        );
      },
    },
    {
      accessorKey: "isActive",
      header: "Actief",
      cell: ({ row }) =>
        row.getValue("isActive") ? (
          <Badge variant="success">Actief</Badge>
        ) : (
          <Badge variant="muted">Inactief</Badge>
        ),
    },
    {
      accessorKey: "simOnlyAvailable",
      header: "Sim-only",
      cell: ({ row }) =>
        row.getValue("simOnlyAvailable") ? (
          <Badge variant="secondary">Beschikbaar</Badge>
        ) : (
          <Badge variant="outline">Niet</Badge>
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
                <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                  <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/data-plans/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/data-plans/${id}?tab=edit`}>
                      <Edit className="mr-2 h-4 w-4" /> Bewerken
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DeleteRowDialog dataPlan={row.original} canDelete={canDelete} />
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
    <div className="space-y-6">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-col items-start gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dataplannen</h1>
            <p className="text-sm text-slate-500">
              Beheer dataplannen voor SIM-only bestellingen en provider-integraties.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {canCreate && (
            <Button asChild>
              <Link href="/data-plans/new">
                <Plus className="h-5 w-5 mr-2 md:h-4 md:w-4" /> Nieuw dataplan
              </Link>
            </Button>
          )}
        </div>
      </div>

      <DataTable<ListDataPlan, unknown>
        columns={columns}
        data={dataPlans}
        enableRowSelection={canEdit || canDelete}
        getRowId={(row) => row.id}
        searchPlaceholder="Zoeken op naam, provider…"
        bulkActions={
          canEdit || canDelete
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r) => r.original.id);
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkActivateDataPlansAction as (
                            prev: BulkActionState,
                            form: FormData,
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} dataplan(nen) activeren?`}
                        confirmDescription="Gemarkeerde dataplannen worden beschikbaar gesteld."
                        confirmConfirmLabel="Activeren"
                        onSuccess={() => toast.success("Dataplannen geactiveerd.")}
                      >
                        <Button size="sm" type="button">
                          <Power className="mr-2 h-4 w-4" /> Activeer
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkDeactivateDataPlansAction as (
                            prev: BulkActionState,
                            form: FormData,
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} dataplan(nen) deactiveren?`}
                        confirmDescription="Gemarkeerde dataplannen zijn na deze actie niet meer beschikbaar voor nieuwe bestellingen."
                        confirmConfirmLabel="Deactiveren"
                        onSuccess={() => toast.success("Dataplannen gedeactiveerd.")}
                      >
                        <Button size="sm" variant="secondary" type="button">
                          <PowerOff className="mr-2 h-4 w-4" /> Deactiveer
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canDelete ? (
                      <BulkActionForm
                        action={
                          bulkDeleteDataPlansAction as (
                            prev: BulkActionState,
                            form: FormData,
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} dataplan(nen) definitief verwijderen?`}
                        confirmDescription="Gebruikte dataplannen (met actieve SIM, abonnement of order) worden overgeslagen en geretourneerd in de foutmelding."
                        confirmConfirmLabel="Verwijderen"
                        onSuccess={() => toast.success("Dataplannen verwerkt.")}
                      >
                        <Button variant="destructive" size="sm" type="button">
                          <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                        </Button>
                      </BulkActionForm>
                    ) : null}
                  </div>
                );
              }
            : undefined
        }
      />
    </div>
  );
}
