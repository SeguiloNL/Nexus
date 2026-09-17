"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { FileText, MoreHorizontal, CheckCircle, Ban, Send, X, Calendar, Filter, UploadCloud, ExternalLink, Trash2, Mail, Check } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InvoiceStatusBadge } from "@/components/ui/status-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Invoice, InvoiceStatus as PrismaInvoiceStatus, InserveSyncStatus } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { PaginatedResult } from "@/types/domain";
import type { UserRole, InvoiceStatus as InvoiceStatusEnum } from "@/types/enums";
import { canUserRole } from "@/lib/auth/session";
import {
  markInvoicePaidAction,
  deleteInvoiceAction,
  sendInvoiceAction,
  sendInvoiceToInserveAction,
  bulkMarkInvoicesSentAction,
  bulkMarkInvoicesPaidAction,
  bulkCancelInvoicesAction,
  bulkHardDeleteInvoicesAction,
  type BulkActionState,
} from "../../subscriptions/actions";

type ListInvoice = any;

interface Props {
  result: PaginatedResult<ListInvoice>;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Concept",
  SENT: "Verzonden",
  PAID: "Betaald",
  OVERDUE: "Vervallen",
  CANCELLED: "Geannuleerd",
};

export function InvoiceList({ result }: Props) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = canUserRole(role as UserRole, "edit", "invoice");
  const canDelete = canUserRole(role as UserRole, "delete", "invoice");
  const isAdmin = role === "ADMIN";

  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [statusFilter, setStatusFilter] = useState<string>(sp?.get("status") || "all");
  const [fromDate, setFromDate] = useState<string>(sp?.get("issueDateFrom") || "");
  const [toDate, setToDate] = useState<string>(sp?.get("issueDateTo") || "");
  const [searchQ, setSearchQ] = useState<string>(sp?.get("search") || "");

  useEffect(() => {
    setStatusFilter(sp?.get("status") || "all");
    setFromDate(sp?.get("issueDateFrom") || "");
    setToDate(sp?.get("issueDateTo") || "");
    setSearchQ(sp?.get("search") || "");
  }, [sp]);

  const applyFilters = (patch: Record<string, string | undefined>) => {
    startTransition(() => {
      const params = new URLSearchParams(Array.from(sp?.entries() || []));
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === "all") {
          params.delete(k);
        } else {
          params.set(k, v);
        }
      }
      params.delete("page");
      const qs = params.toString();
      router.push(`/invoices${qs ? `?${qs}` : ""}`);
    });
  };

  const resetFilters = () => {
    startTransition(() => {
      router.push("/invoices");
    });
  };

  const hasAnyFilter = statusFilter !== "all" || !!fromDate || !!toDate || !!searchQ;

  const inSyncStatus = (st: any): InserveSyncStatus | null => {
    return (st?.inserveSyncStatus as InserveSyncStatus) ?? null;
  };

  const canSendToInserve = (st: any): boolean => {
    if (!canEdit) return false;
    const paid = st.status === "PAID";
    const cancelled = st.status === "CANCELLED";
    if (paid || cancelled) return false;
    const s = inSyncStatus(st);
    return s === "PENDING" || s === "FAILED" || s === null;
  };

  const actionsCol = {
    id: "actions",
    header: "Acties",
    cell: ({ row }: any) => {
      const st = row.original;
      const paid = st.status === "PAID";
      const cancelled = st.status === "CANCELLED";
      const draft = st.status === "DRAFT";
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Factuuracties</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canEdit && draft ? (
              <DropdownMenuItem asChild>
                <form action={sendInvoiceAction as any} className="w-full">
                  <input type="hidden" name="id" value={st.id} required />
                  <button
                    type="submit"
                    className="flex items-center w-full text-left"
                  >
                    <Send className="mr-2 h-4 w-4" /> Markeer verzonden
                  </button>
                </form>
              </DropdownMenuItem>
            ) : null}
            {canSendToInserve(st) ? (
              <DropdownMenuItem asChild>
                <form action={sendInvoiceToInserveAction as any} className="w-full">
                  <input type="hidden" name="id" value={st.id} required />
                  <button
                    type="submit"
                    className="flex items-center w-full text-left"
                  >
                    <UploadCloud className="mr-2 h-4 w-4" /> Verstuur naar Inserve
                  </button>
                </form>
              </DropdownMenuItem>
            ) : null}
            {canEdit && !paid && !cancelled ? (
              <DropdownMenuItem asChild>
                <form
                  action={markInvoicePaidAction as any}
                  className="w-full"
                >
                  <input type="hidden" name="id" value={st.id} required />
                  <button
                    type="submit"
                    className="flex items-center w-full text-left"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" /> Markeer betaald
                  </button>
                </form>
              </DropdownMenuItem>
            ) : null}
            {canDelete && !paid && !cancelled ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <form
                    action={deleteInvoiceAction as any}
                    className="w-full"
                  >
                    <input type="hidden" name="id" value={st.id} required />
                    <button
                      type="submit"
                      className="flex items-center w-full text-left text-red-600"
                    >
                      <Ban className="mr-2 h-4 w-4" /> Annuleren
                    </button>
                  </form>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  } as ColumnDef<ListInvoice>;

  const inServeSyncCol: ColumnDef<ListInvoice> = {
    id: "inserveSync",
    header: "Inserve sync",
    cell: ({ row }: any) => {
      const st = row.original;
      const status = inSyncStatus(st);
      const inserveInvoiceId = st?.inserveInvoiceId as number | null | undefined;
      if (!status) {
        return <span className="text-slate-400">—</span>;
      }
      let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
      let label: string = status ?? "";
      switch (status) {
        case "PENDING":
          variant = "secondary";
          label = "Wachten";
          break;
        case "IN_PROGRESS":
          variant = "default";
          label = "Bezig…";
          break;
        case "SYNCED":
          variant = "default";
          label = "Gesynchroniseerd";
          break;
        case "FAILED":
          variant = "destructive";
          label = "Mislukt";
          break;
        case "SKIPPED":
          variant = "outline";
          label = "Overgeslagen";
          break;
      }
      return (
        <div className="flex flex-col gap-1">
          <Badge variant={variant} className="w-fit text-xs">
            {label}
          </Badge>
          {status === "SYNCED" && inserveInvoiceId ? (
            <a
              href={`https://${process.env.NEXT_PUBLIC_INSERVE_SUBDOMAIN ?? ""}.inserve.nl/invoices/${inserveInvoiceId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Inserve #{inserveInvoiceId}
            </a>
          ) : null}
          {status === "FAILED" && st?.inserveSyncError ? (
            <div className="max-w-[220px] truncate text-xs text-rose-600" title={st.inserveSyncError}>
              {st.inserveSyncError}
            </div>
          ) : null}
        </div>
      );
    },
  };

  const cols: ColumnDef<ListInvoice>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Factuurnummer",
      cell: ({ row }) => (
        <Link
          href={`/subscriptions/${row.original.subscriptionId}#facturen`}
          className="font-mono font-medium"
        >
          {row.original.invoiceNumber}
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
      header: "Abonnement",
      cell: ({ row }) => {
        const s = row.original.subscription;
        return s ? (
          <Link
            href={`/subscriptions/${s.id}`}
            className="font-mono text-xs font-medium underline-offset-4 hover:underline"
          >
            {s.subscriptionNumber}
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "issueDate",
      header: "Factuurdatum",
      cell: ({ row }) => formatDate(row.original.issueDate),
    },
    {
      accessorKey: "dueDate",
      header: "Vervaldatum",
      cell: ({ row }) => formatDate(row.original.dueDate),
    },
    {
      accessorKey: "sentAt",
      header: "Verzonden op",
      cell: ({ row }) => {
        const v = (row.original as any).sentAt as Date | undefined | null;
        return v ? (
          <span className="tabular-nums">{formatDate(v)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      accessorKey: "paidAt",
      header: "Betaald op",
      cell: ({ row }) => {
        const v = (row.original as any).paidAt as Date | undefined | null;
        return v ? (
          <span className="tabular-nums text-emerald-700">{formatDate(v)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      header: "Periode",
      cell: ({ row }) => (
        <div className="text-xs">
          <div>{formatDate(row.original.periodStart)}</div>
          <div className="text-slate-500">
            t/m {formatDate(row.original.periodEnd)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "total",
      header: "Totaal",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(String(row.original.total))}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <InvoiceStatusBadge status={row.original.status as InvoiceStatusEnum} />
      ),
    },
    inServeSyncCol,
  ];

  if (canEdit || canDelete) cols.push(actionsCol);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileText className="h-6 w-6" /> Facturen
          </h1>
          <p className="text-sm text-slate-500">
            Overzicht van alle gegenereerde facturen met doorberekening.
          </p>
        </div>
        {hasAnyFilter ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={resetFilters}
            className="text-slate-600"
          >
            <X className="mr-2 h-4 w-4" /> Filters wissen
          </Button>
        ) : null}
      </div>

      <div className="rounded-md border bg-slate-50/60 p-3">
        <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-600">Zoeken</label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyFilters({ search: searchQ });
              }}
            >
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Factuur nr, klant, notitie…"
                className="w-full"
              />
            </form>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-600">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                applyFilters({ status: v });
              }}
            >
              <SelectTrigger id="invoice-status-filter">
                <SelectValue placeholder="Alle statussen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle statussen</SelectItem>
                {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-600">Factuurdatum vanaf</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  applyFilters({ issueDateFrom: e.target.value || undefined });
                }}
                className="pl-9"
              />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs text-slate-600">Factuurdatum t/m</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  applyFilters({ issueDateTo: e.target.value || undefined });
                }}
                className="pl-9"
              />
            </div>
          </div>
        </div>
        {isPending ? (
          <div className="mt-2 text-xs text-slate-500">Filters toepassen…</div>
        ) : null}
      </div>

      <DataTable
        columns={cols as ColumnDef<any>[]}
        data={result.data}
        totalCount={result.total}
        searchColumnAccessor="invoiceNumber"
        searchPlaceholder="Zoek factuur (nr, klant, notitie…)"
        enableRowSelection={canEdit || (canDelete && isAdmin)}
        getRowId={(row) => (row as any).id}
        bulkActions={
          canEdit || (canDelete && isAdmin)
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r: Row<ListInvoice>) => (r.original as any).id);
                return (
                  <>
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkMarkInvoicesSentAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                      >
                        <Button variant="outline" size="sm" type="button">
                          <Send className="mr-2 h-4 w-4" /> Markeer verzonden
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkMarkInvoicesPaidAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                      >
                        <Button variant="outline" size="sm" type="button">
                          <Check className="mr-2 h-4 w-4" /> Markeer betaald
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canEdit ? (
                      <BulkActionForm
                        action={
                          bulkCancelInvoicesAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} factuur(en) annuleren?`}
                        confirmDescription="De geselecteerde facturen worden op status CANCELLED gezet. Dit is geen harde verwijdering."
                        confirmConfirmLabel="Annuleren bevestigen"
                      >
                        <Button variant="destructive" size="sm" type="button">
                          <Ban className="mr-2 h-4 w-4" /> Annuleren
                        </Button>
                      </BulkActionForm>
                    ) : null}
                    {canDelete && isAdmin ? (
                      <BulkActionForm
                        action={
                          bulkHardDeleteInvoicesAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle={`${ids.length} factuur(en) DEFINITIEF verwijderen?`}
                        confirmDescription="Dit verwijdert de facturen permanent uit de database (hard delete). Deze actie kan NIET ongedaan gemaakt worden!"
                        confirmConfirmLabel="Definitief verwijderen"
                      >
                        <Button variant="destructive" size="sm" type="button">
                          <Trash2 className="mr-2 h-4 w-4" /> Definitief verwijderen
                        </Button>
                      </BulkActionForm>
                    ) : null}
                  </>
                );
              }
            : undefined
        }
      />
    </div>
  );
}
