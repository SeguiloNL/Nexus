"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Edit,
  Info,
  Cpu,
  Package,
  FileText,
  History,
  Trash2,
  Calendar,
  Truck,
  Wrench,
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
import { TrackerStatusBadge, AssignmentReasonLabel } from "@/components/ui/status-badges";
import { TrackerForm } from "./tracker-form";
import { formatDate, formatImei } from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole, AuditAction } from "@/types/enums";
import type { Tracker, TrackerStatus, AssignmentReason } from "@prisma/client";

type DetailTracker = Tracker & {
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
    vehicle: {
      id: string;
      licensePlate: string | null;
      brand: string | null;
      model: string | null;
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

type TrackerDetailProps = {
  tracker: DetailTracker;
  role: UserRole;
  updateAction: (
    trackerId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  deleteAction: (trackerId: string) => Promise<void>;
  trackerId: string;
  auditLogs?: AuditLogForDetail;
};

export function TrackerDetail({
  tracker,
  role,
  updateAction,
  deleteAction,
  trackerId,
  auditLogs = [],
}: TrackerDetailProps) {
  const canEdit = canUserRole(role, "edit", "tracker");
  const canDelete = canUserRole(role, "delete", "tracker");

  const [, deleteFormAction] = useFormState(
    async (_p: unknown) => deleteAction(trackerId),
    undefined
  );

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
            <Link href="/trackers">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {tracker.brand} {tracker.model}
              </h1>
              <TrackerStatusBadge status={tracker.status as TrackerStatus} />
            </div>
            <div className="text-sm text-slate-500">
              Serienr. {tracker.serialNumber} · IMEI{" "}
              <span className="font-mono">{formatImei(tracker.imei)}</span>
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
            <Package className="mr-1.5 h-4 w-4" /> Toewijzingen (
            {tracker.assignments.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Kenmerken</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<Cpu className="h-4 w-4" />}
                  label="Hardware type"
                  value={tracker.hardwareType}
                />
                <InfoRow
                  icon={<Wrench className="h-4 w-4" />}
                  label="Firmware"
                  value={tracker.firmwareVersion}
                />
                <InfoRow
                  icon={<Truck className="h-4 w-4" />}
                  label="Leverancier"
                  value={tracker.supplier}
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Aankoopdatum"
                  value={
                    tracker.purchaseDate
                      ? formatDate(tracker.purchaseDate)
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
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(tracker.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(tracker.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {tracker.notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Notities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {tracker.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <TrackerForm
              mode="edit"
              trackerId={trackerId}
              initial={tracker}
              action={async (prev, form) =>
                updateAction(trackerId, prev, form)
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
                Abonnementen en voertuigen waaraan deze tracker is gekoppeld.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={tracker.assignments}
                emptyTitle="Nog geen toewijzingen"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Periode</th>
                        <th className="px-3 py-2">Abonnement</th>
                        <th className="px-3 py-2">Klant</th>
                        <th className="px-3 py-2">Voertuig</th>
                        <th className="px-3 py-2">Reden</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tracker.assignments.map((a) => (
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
                            {a.vehicle ? (
                              <Link
                                href={`/vehicles/${a.vehicle.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {a.vehicle.licensePlate ??
                                  `${a.vehicle.brand ?? ""} ${a.vehicle.model ?? ""}`}
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
                Auditlog van wijzigingen op deze tracker en gerelateerde
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
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
          <div className="truncate">{value}</div>
        ) : (
          <div className="text-slate-400">—</div>
        )}
      </div>
    </div>
  );
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
