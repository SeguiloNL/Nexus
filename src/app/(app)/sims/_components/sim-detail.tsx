"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Edit,
  Info,
  CreditCard,
  Phone,
  Calendar,
  Globe,
  FileText,
  History,
  Trash2,
  Package,
  Database,
  MessageSquare,
  Users,
  Activity,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SimStatusBadge, AssignmentReasonLabel } from "@/components/ui/status-badges";
import { SimForm } from "./sim-form";
import {
  formatDate,
  formatDateTime,
  formatIccid,
  formatMsisdn,
  formatBytes,
  formatCount,
} from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole, AuditAction } from "@/types/enums";
import type { SIM, SimStatus, AssignmentReason } from "@prisma/client";
import type { SimUsageSyncState } from "../actions";

type DetailSim = SIM & {
  assignments: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    reason: AssignmentReason | null;
    subscription: {
      id: string;
      subscriptionNumber: string;
      customer: {
        id: string;
        companyName: string;
        customerNumber: string;
      } | null;
    } | null;
  }>;
};

type AuditLogForDetail = Array<{
  id: string;
  timestamp: Date;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues: any;
  newValues: any;
  user: { name: string | null; email: string } | null;
}>;

type SimDetailProps = {
  sim: DetailSim;
  role: UserRole;
  updateAction: (
    simId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  deleteAction: (simId: string) => Promise<void>;
  simId: string;
  auditLogs?: AuditLogForDetail;
  syncUsageAction: (
    simId: string,
    prev: SimUsageSyncState,
    formData: FormData
  ) => Promise<SimUsageSyncState>;
};

export function SimDetail({
  sim,
  role,
  updateAction,
  deleteAction,
  simId,
  auditLogs = [],
  syncUsageAction,
}: SimDetailProps) {
  const canEdit = canUserRole(role, "edit", "sim");
  const canDelete = canUserRole(role, "delete", "sim");

  const [, deleteFormAction] = useFormState(
    async (_p: unknown) => deleteAction(simId),
    undefined
  );

  const [usageSyncState, usageSyncFormAction, usageSyncPendingNative] = useFormState(
    syncUsageAction.bind(null, simId),
    { ok: false } satisfies SimUsageSyncState
  );

  const [isUsageSyncPendingClient, setIsUsageSyncPendingClient] = useState(false);
  const [isUsageSyncTransitioning, startUsageSyncTransition] = useTransition();
  const usageSubmittedRef = useRef(false);
  const prevUsageSyncStateRef = useRef(usageSyncState);

  const usageSyncPending =
    isUsageSyncPendingClient || isUsageSyncTransitioning || usageSyncPendingNative;

  useEffect(() => {
    const prev = prevUsageSyncStateRef.current;
    const curr = usageSyncState;
    const stateChanged =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        (prev?.message !== curr?.message) ||
        (prev?.error !== curr?.error));
    if (stateChanged || (!usageSyncPendingNative && isUsageSyncPendingClient)) {
      usageSubmittedRef.current = false;
      setIsUsageSyncPendingClient(false);
    }
    prevUsageSyncStateRef.current = curr;
  }, [usageSyncState, usageSyncPendingNative, isUsageSyncPendingClient]);

  function onUsageSyncSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (usageSubmittedRef.current || usageSyncPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    usageSubmittedRef.current = true;
    setIsUsageSyncPendingClient(true);
    startUsageSyncTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        await usageSyncFormAction(fd);
      } finally {
        setIsUsageSyncPendingClient(false);
      }
    });
    e.preventDefault();
  }

  const ACTION_LABEL: Record<string, string> = {
    CREATE: "Aangemaakt",
    UPDATE: "Gewijzigd",
    DELETE: "Verwijderd",
    ACTIVATE: "Geactiveerd",
    SUSPEND: "Gepauzeerd",
    CANCEL: "Geannuleerd",
    EXPIRE: "Verlopen",
    RESUME: "Hervat",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sims">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-slate-500" />
              <h1 className="text-2xl font-bold tracking-tight">
                {sim.provider}
              </h1>
              <SimStatusBadge status={sim.status as SimStatus} />
            </div>
            <div className="text-sm text-slate-500 font-mono">
              ICCID: {formatIccid(sim.iccid)}
              {sim.msisdn ? <> · MSISDN: {formatMsisdn(sim.msisdn)}</> : null}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit ? (
            <Button asChild>
              <Link href="#edit">
                <Edit className="h-4 w-4" /> Bewerken
              </Link>
            </Button>
          ) : null}
          {canDelete ? (
            <form action={deleteFormAction}>
              <Button variant="destructive" type="submit">
                <Trash2 className="h-4 w-4" /> Verwijderen
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="mr-1.5 h-4 w-4" /> Overzicht
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" /> Bewerken
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="assignments">
            <CreditCard className="mr-1.5 h-4 w-4" /> Toewijzingen (
            {sim.assignments.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Netwerk & Identificatie</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="SIM type"
                  value={sim.simType}
                />
                <InfoRow
                  icon={<Globe className="h-4 w-4" />}
                  label="APN"
                  value={sim.apn}
                />
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="IMSI"
                  value={sim.imsi}
                  mono
                />
                <InfoRow
                  icon={<Phone className="h-4 w-4" />}
                  label="MSISDN"
                  value={sim.msisdn ? formatMsisdn(sim.msisdn) : null}
                  mono
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Geactiveerd"
                  value={
                    sim.providerActivationDate
                      ? formatDate(sim.providerActivationDate)
                      : null
                  }
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Beëindigd"
                  value={
                    sim.providerDeactivationDate
                      ? formatDate(sim.providerDeactivationDate)
                      : null
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
                <CardDescription>Metadata</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span className="text-right">{formatDate(sim.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span className="text-right">{formatDate(sim.updatedAt)}</span>
                </div>
                {(sim.dataUsedBytes ?? sim.dataLimitBytes ?? sim.smsUsedCount ?? sim.smsLimitCount ?? sim.lastUsageSyncAt) ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Laatste verbruik-sync</span>
                    <span className="text-right">
                      {sim.lastUsageSyncAt ? formatDateTime(sim.lastUsageSyncAt) : "—"}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {canEdit ? (
            <div
              className={
                "relative flex flex-col gap-2 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4 " +
                (usageSyncPending
                  ? "border-blue-300 bg-blue-50/80 ring-2 ring-blue-200/70 transition-colors duration-200"
                  : "border-slate-200 bg-slate-50/60 transition-colors duration-200")
              }
              aria-live="polite"
            >
              <div className="flex-1 min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-700">Handmatig verbruik vernieuwen</span>
                  <span className="hidden text-slate-400 sm:inline">·</span>
                  <span className="text-slate-600 sm:text-slate-500">
                    Haalt de meest recente data- en SMS-statistieken direct op via Simhuis.
                  </span>
                </div>
                {usageSyncPending ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-blue-700 sm:text-sm">
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    <span>
                      Bezig met ophalen van verbruiksgegevens... Dit kan enkele seconden duren.
                    </span>
                  </div>
                ) : null}
              </div>
              <form
                action={usageSyncFormAction as any}
                onSubmit={onUsageSyncSubmit}
                className="shrink-0 w-full sm:w-auto"
              >
                <Button
                  type="submit"
                  size="sm"
                  variant={usageSyncPending ? "outline" : "default"}
                  disabled={usageSyncPending}
                  aria-disabled={usageSyncPending}
                  aria-busy={usageSyncPending}
                  className={
                    "w-full sm:w-auto justify-center gap-2 px-4 py-2 " +
                    (usageSyncPending
                      ? "cursor-not-allowed border-blue-300 bg-blue-100/70 text-blue-700 hover:bg-blue-100/70"
                      : "")
                  }
                >
                  {usageSyncPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                      <span className="whitespace-nowrap">Bezig met vernieuwen...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="whitespace-nowrap">Verbruik vernieuwen</span>
                    </>
                  )}
                </Button>
              </form>
            </div>
          ) : null}

          {usageSyncState?.message ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm"
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600">✓</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-emerald-900">Verbruik vernieuwd</p>
                <p className="whitespace-pre-wrap break-words text-emerald-800/90">{usageSyncState.message}</p>
              </div>
            </div>
          ) : null}
          {usageSyncState?.error ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 shadow-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-red-900">Verbruik vernieuwen mislukt</p>
                <p className="whitespace-pre-wrap break-words text-red-800/90">{usageSyncState.error}</p>
                {canEdit ? (
                  <p className="mt-1 text-xs text-red-700/80">
                    Controleer je internetverbinding of probeer het later opnieuw. Als het probleem blijft, neem dan contact op met de beheerder.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4 text-slate-500" /> Product
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <InfoRow
                  icon={<Package className="h-4 w-4" />}
                  label="Product naam"
                  value={sim.product}
                />
                <InfoRow
                  icon={<Activity className="h-4 w-4" />}
                  label="Product type"
                  value={sim.productType ?? null}
                />
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="SIM naam"
                  value={sim.simName ?? null}
                />
                <InfoRow
                  icon={<Users className="h-4 w-4" />}
                  label="Groep"
                  value={sim.simGroup ?? null}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4 text-slate-500" /> Dataverbruik
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageProgress
                  used={sim.dataUsedBytes}
                  limit={sim.dataLimitBytes}
                  threshold={sim.lowestDataLimitBytes}
                  formatUsed={formatBytes(sim.dataUsedBytes)}
                  formatLimit={formatBytes(sim.dataLimitBytes)}
                />
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <InfoRowInline
                    label="Verbruikt"
                    value={formatBytes(sim.dataUsedBytes)}
                  />
                  <InfoRowInline
                    label="Limiet"
                    value={formatBytes(sim.dataLimitBytes)}
                  />
                  <InfoRowInline
                    label="Laagste drempel"
                    value={formatBytes(sim.lowestDataLimitBytes)}
                  />
                  <InfoRowInline
                    label="Resterend"
                    value={
                      typeof sim.dataUsedBytes === "bigint" &&
                      typeof sim.dataLimitBytes === "bigint"
                        ? formatBytes(sim.dataLimitBytes > sim.dataUsedBytes
                            ? sim.dataLimitBytes - sim.dataUsedBytes
                            : 0n)
                        : "—"
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4 text-slate-500" /> SMS
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageProgress
                  used={sim.smsUsedCount != null ? BigInt(sim.smsUsedCount) : null}
                  limit={sim.smsLimitCount != null ? BigInt(sim.smsLimitCount) : null}
                  threshold={sim.lowestSmsLimitCount != null ? BigInt(sim.lowestSmsLimitCount) : null}
                  formatUsed={formatCount(sim.smsUsedCount)}
                  formatLimit={formatCount(sim.smsLimitCount)}
                  unit="berichten"
                />
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <InfoRowInline
                    label="Verzonden"
                    value={formatCount(sim.smsUsedCount)}
                  />
                  <InfoRowInline
                    label="Limiet"
                    value={formatCount(sim.smsLimitCount)}
                  />
                  <InfoRowInline
                    label="Laagste drempel"
                    value={formatCount(sim.lowestSmsLimitCount)}
                  />
                  <InfoRowInline
                    label="Resterend"
                    value={
                      sim.smsUsedCount != null && sim.smsLimitCount != null
                        ? formatCount(Math.max(0, sim.smsLimitCount - sim.smsUsedCount))
                        : "—"
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {sim.notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Notities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {sim.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <SimForm
              mode="edit"
              simId={simId}
              initial={sim}
              action={async (prev, form) =>
                updateAction(simId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="assignments" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Actieve en historie toewijzingen
              </CardTitle>
              <CardDescription>
                Abonnementen waaraan deze SIM is gekoppeld.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={sim.assignments}
                emptyTitle="Nog geen toewijzingen"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Periode</th>
                        <th className="px-3 py-2">Abonnement</th>
                        <th className="px-3 py-2">Klant</th>
                        <th className="px-3 py-2">Reden</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.assignments.map((a) => (
                        <tr
                          key={a.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {formatDate(a.startAt)}
                            {a.endAt
                              ? ` → ${formatDate(a.endAt)}`
                              : " (lopend)"}
                          </td>
                          <td className="px-3 py-2">
                            {a.subscription ? (
                              <Link
                                href={`/subscriptions/${a.subscription.id}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {a.subscription.subscriptionNumber}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {a.subscription?.customer ? (
                              <Link
                                href={`/customers/${a.subscription.customer.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {a.subscription.customer.companyName}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {a.reason ? (
                              <AssignmentReasonLabel reason={a.reason} />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </EmptyOrList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Wijzigingsgeschiedenis
              </CardTitle>
              <CardDescription>
                Auditlog van wijzigingen op deze SIM en gerelateerde
                resources.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={auditLogs}
                emptyTitle="Nog geen wijzigingen gelogd"
              >
                <ul className="space-y-4">
                  {auditLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex items-start gap-3 border-b border-slate-100 pb-4 last:border-b-0"
                    >
                      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                        <History className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {ACTION_LABEL[log.action] ?? log.action}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-slate-500">
                            {log.entityType}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(log.timestamp)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">
                          {log.user
                            ? `${log.user.name ?? "Onbekend"} (${log.user.email})`
                            : "Systeem"}
                        </div>
                        {log.oldValues || log.newValues ? (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                              Details bekijken
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                              {log.oldValues ? (
                                <div>
                                  <div className="mb-1 font-semibold text-red-700">
                                    Oude waarden
                                  </div>
                                  <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-red-900">
                                    {JSON.stringify(log.oldValues, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {log.newValues ? (
                                <div>
                                  <div className="mb-1 font-semibold text-emerald-700">
                                    Nieuwe waarden
                                  </div>
                                  <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-emerald-900">
                                    {JSON.stringify(log.newValues, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </EmptyOrList>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {value ? (
          <div className={`truncate ${mono ? "font-mono text-xs" : ""}`}>
            {value}
          </div>
        ) : (
          <div className="text-slate-400">—</div>
        )}
      </div>
    </div>
  );
}

function InfoRowInline({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="font-medium text-slate-900">
        {value ?? "—"}
      </div>
    </div>
  );
}

function UsageProgress({
  used,
  limit,
  threshold,
  formatUsed,
  formatLimit,
  unit,
}: {
  used: bigint | null | undefined;
  limit: bigint | null | undefined;
  threshold: bigint | null | undefined;
  formatUsed: string;
  formatLimit: string;
  unit?: string;
}) {
  const hasUsage = used !== null && used !== undefined;
  const hasLimit = limit !== null && limit !== undefined && limit > 0n;
  const hasThreshold =
    threshold !== null && threshold !== undefined && threshold > 0n;

  if (!hasUsage && !hasLimit && !hasThreshold) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
        Geen verbruiksgegevens beschikbaar
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
  let statusColor = "text-emerald-700";
  let statusLabel = "";

  if (!hasLimit) {
    barColor = "bg-slate-300";
    statusColor = "text-slate-600";
    statusLabel = "Onbeperkt";
  } else if (overschreden) {
    barColor = "bg-red-500";
    statusColor = "text-red-700";
    statusLabel = "Limiet overschreden";
  } else if (pct >= 90) {
    barColor = "bg-red-500";
    statusColor = "text-red-700";
    statusLabel = "Bijna op";
  } else if (
    hasThreshold &&
    hasUsage &&
    used >= threshold
  ) {
    barColor = "bg-amber-500";
    statusColor = "text-amber-700";
    statusLabel = "Drempel bereikt";
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Verbruik
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-slate-900">
              {formatUsed}
            </span>
            {hasLimit ? (
              <span className="text-xs text-slate-500">
                van {formatLimit}
                {unit ? ` ${unit}` : ""}
              </span>
            ) : unit ? (
              <span className="text-xs text-slate-500">{unit}</span>
            ) : null}
          </div>
        </div>
        {statusLabel ? (
          <div className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
            {overschreden || pct >= 90 ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : null}
            {statusLabel}
          </div>
        ) : hasLimit ? (
          <div className={`text-xs font-semibold ${statusColor}`}>
            {pct.toFixed(0)}%
          </div>
        ) : null}
      </div>

      {hasLimit ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, overschreden ? 100 : 0)}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full w-full rounded-full ${barColor}`} />
        </div>
      )}

      {hasThreshold ? (
        <div className="text-[11px] text-slate-500">
          ⚠ Waarschuwingsdrempel: {formatThreshold(threshold, unit)}
        </div>
      ) : null}
    </div>
  );
}

function formatThreshold(
  value: bigint,
  unit?: string
): string {
  if (unit === "berichten") {
    return formatCount(value);
  }
  return formatBytes(value);
}

function EmptyOrList<T>({
  rows,
  children,
  emptyTitle,
}: {
  rows: T[];
  children: React.ReactNode;
  emptyTitle: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        {emptyTitle}
      </div>
    );
  }
  return <>{children}</>;
}
