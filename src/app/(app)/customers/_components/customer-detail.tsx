"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  MapPin,
  User,
  Receipt,
  Car,
  Users,
  History,
  AlertTriangle,
  Trash2,
  Info,
  Cpu,
  CreditCard,
  FileText,
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
import { CustomerStatusBadge, TrackerStatusBadge, SimStatusBadge, ActivationOrderStatusBadge } from "@/components/ui/status-badges";
import { CustomerForm } from "./customer-form";
import { formatDate, formatImei, formatIccid, formatMsisdn } from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole, AuditAction } from "@/types/enums";
import type { Customer, CustomerStatus } from "@prisma/client";

type DetailCustomer = Customer & {
  parentCustomer: { id: string; companyName: string; customerNumber: string } | null;
  subCustomers: Array<{
    id: string;
    companyName: string;
    customerNumber: string;
    status: CustomerStatus;
  }>;
  subscriptions: Array<{
    id: string;
    subscriptionNumber: string;
    status: string;
    monthlyPrice: any;
    startDate: Date;
    endDate: Date | null;
    trackerAssignments: Array<{
      id: string;
      startAt: Date;
      tracker: {
        id: string;
        serialNumber: string;
        imei: string;
        brand: string;
        model: string;
        status: string;
      };
      vehicle: {
        id: string;
        licensePlate: string | null;
        brand: string | null;
        model: string | null;
      } | null;
    }>;
    simAssignments: Array<{
      id: string;
      startAt: Date;
      sim: {
        id: string;
        iccid: string;
        msisdn: string | null;
        provider: string;
        status: string;
      };
    }>;
  }>;
  vehicles: Array<{
    id: string;
    licensePlate: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
  }>;
  activationOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    failedAt: Date | null;
    tracker: {
      id: string;
      serialNumber: string;
      imei: string;
      brand: string;
      model: string;
      status: string;
    } | null;
    sim: {
      id: string;
      iccid: string;
      msisdn: string | null;
      provider: string;
      status: string;
    } | null;
    subscription: {
      id: string;
      subscriptionNumber: string;
      status: string;
    } | null;
    vehicle: {
      id: string;
      licensePlate: string | null;
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

type CustomerDetailProps = {
  customer: DetailCustomer;
  parentOptions: { id: string; label: string }[];
  role: UserRole;
  updateAction: (
    customerId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  deleteAction: (customerId: string) => Promise<void>;
  customerId: string;
  auditLogs?: AuditLogForDetail;
};

export function CustomerDetail({
  customer,
  parentOptions,
  role,
  updateAction,
  deleteAction,
  customerId,
  auditLogs = [],
}: CustomerDetailProps) {
  const canEdit = canUserRole(role, "edit", "customer");
  const canDelete = canUserRole(role, "delete", "customer");

  const [, deleteFormAction] = useFormState(
    async (p: unknown) => deleteAction(customerId),
    undefined
  );

  const uniqueTrackers = Array.from(
    new Map(
      customer.subscriptions
        .flatMap((s) => s.trackerAssignments.map((a) => a.tracker))
        .concat(customer.activationOrders.flatMap((o) => (o.tracker ? [o.tracker] : [])))
        .map((t) => [t.id, t])
    ).values()
  );

  const uniqueSims = Array.from(
    new Map(
      customer.subscriptions
        .flatMap((s) => s.simAssignments.map((a) => a.sim))
        .concat(customer.activationOrders.flatMap((o) => (o.sim ? [o.sim] : [])))
        .map((s) => [s.id, s])
    ).values()
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
            <Link href="/customers">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {customer.companyName}
              </h1>
              <CustomerStatusBadge status={customer.status} />
            </div>
            <div className="text-sm text-slate-500">
              {customer.customerNumber}
              {customer.parentCustomer ? (
                <>
                  {" · Hoofdklant: "}
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/customers/${customer.parentCustomer.id}`}
                  >
                    {customer.parentCustomer.companyName} (
                    {customer.parentCustomer.customerNumber})
                  </Link>
                </>
              ) : null}
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
                <Trash2 className="h-4 w-4" /> Klant verwijderen
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="mr-1.5 h-4 w-4" />
            Overzicht
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" />
              Bewerken
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="subscriptions">
            <Receipt className="mr-1.5 h-4 w-4" />
            Abonnementen ({customer.subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="trackers">
            <Cpu className="mr-1.5 h-4 w-4" />
            Trackers ({uniqueTrackers.length})
          </TabsTrigger>
          <TabsTrigger value="sims">
            <CreditCard className="mr-1.5 h-4 w-4" />
            SIM-kaarten ({uniqueSims.length})
          </TabsTrigger>
          <TabsTrigger value="vehicles">
            <Car className="mr-1.5 h-4 w-4" />
            Voertuigen ({customer.vehicles.length})
          </TabsTrigger>
          <TabsTrigger value="activations">
            <FileText className="mr-1.5 h-4 w-4" />
            Activaties ({customer.activationOrders.length})
          </TabsTrigger>
          {customer.subCustomers.length ? (
            <TabsTrigger value="subcustomers">
              <Users className="mr-1.5 h-4 w-4" />
              Subklanten ({customer.subCustomers.length})
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" />
            Geschiedenis ({auditLogs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Contactgegevens</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<User className="h-4 w-4" />}
                  label="Contactpersoon"
                  value={customer.contactPerson}
                />
                <InfoRow
                  icon={<Mail className="h-4 w-4" />}
                  label="E-mail"
                  value={customer.email}
                  href={customer.email ? `mailto:${customer.email}` : undefined}
                />
                <InfoRow
                  icon={<Phone className="h-4 w-4" />}
                  label="Telefoon"
                  value={customer.phone}
                  href={customer.phone ? `tel:${customer.phone}` : undefined}
                />
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="Adres"
                  value={
                    [
                      customer.address,
                      [customer.postalCode, customer.city]
                        .filter(Boolean)
                        .join(" "),
                      customer.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || null
                  }
                />
                <InfoRow
                  icon={<FileText className="h-4 w-4" />}
                  label="KvK"
                  value={customer.kvkNr}
                />
                <InfoRow
                  icon={<FileText className="h-4 w-4" />}
                  label="BTW"
                  value={customer.btwNr}
                />
                <InfoRow
                  icon={<FileText className="h-4 w-4" />}
                  label="Inserve ID"
                  value={
                    customer.inserveCompanyId !== null &&
                    customer.inserveCompanyId !== undefined
                      ? String(customer.inserveCompanyId)
                      : null
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
                <CardDescription>Metadata van deze klant</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(customer.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(customer.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {customer.notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notities</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {customer.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <CustomerForm
              mode="edit"
              customerId={customerId}
              initial={customer}
              parentOptions={parentOptions.filter(
                (o) => o.id !== customerId
              )}
              action={async (prev, form) =>
                updateAction(customerId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="subscriptions" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recente abonnementen</CardTitle>
              <CardDescription>
                Top 10 meest recente abonnementen. Open abonnement voor
                details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={customer.subscriptions}
                emptyTitle="Nog geen abonnementen"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Nr.</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Prijs</th>
                        <th className="px-3 py-2">Periode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.subscriptions.map((s) => (
                        <tr
                          key={s.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/subscriptions/${s.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {s.subscriptionNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{s.status}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            € {Number(s.monthlyPrice).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(s.startDate)}
                            {s.endDate ? ` t/m ${formatDate(s.endDate)}` : ""}
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

        <TabsContent value="trackers" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trackers</CardTitle>
              <CardDescription>
                Unieke trackers die via abonnementen of activaties aan deze
                klant zijn gekoppeld.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={uniqueTrackers}
                emptyTitle="Nog geen trackers"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Serienr.</th>
                        <th className="px-3 py-2">IMEI</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueTrackers.map((t) => (
                        <tr
                          key={t.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/trackers/${t.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {t.brand} {t.model}
                            </Link>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {t.serialNumber}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {formatImei(t.imei)}
                          </td>
                          <td className="px-3 py-2">
                            <TrackerStatusBadge status={t.status as any} />
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

        <TabsContent value="sims" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SIM-kaarten</CardTitle>
              <CardDescription>
                Unieke SIM-kaarten die via abonnementen of activaties aan deze
                klant zijn gekoppeld.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={uniqueSims}
                emptyTitle="Nog geen SIM-kaarten"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Provider</th>
                        <th className="px-3 py-2">ICCID</th>
                        <th className="px-3 py-2">MSISDN</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueSims.map((s) => (
                        <tr
                          key={s.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/sims/${s.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {s.provider}
                            </Link>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {formatIccid(s.iccid)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {s.msisdn ? formatMsisdn(s.msisdn) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <SimStatusBadge status={s.status as any} />
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

        <TabsContent value="vehicles" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Voertuigen</CardTitle>
              <CardDescription>
                Gekoppelde voertuigen van deze klant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={customer.vehicles}
                emptyTitle="Nog geen voertuigen"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {customer.vehicles.map((v) => (
                    <Link
                      key={v.id}
                      href={`/vehicles/${v.id}`}
                      className="rounded-md border p-3 hover:bg-slate-50"
                    >
                      <div className="font-semibold">
                        {v.licensePlate ?? "Geen kenteken"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[v.brand, v.model].filter(Boolean).join(" ") ||
                          "Onbekend model"}
                      </div>
                      {v.vin ? (
                        <div className="mt-1 font-mono text-[11px] text-slate-500">
                          VIN: {v.vin}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </EmptyOrList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activations" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activatieorders</CardTitle>
              <CardDescription>
                Recente activatieorders voor deze klant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={customer.activationOrders}
                emptyTitle="Nog geen activatieorders"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Ordernr.</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Tracker</th>
                        <th className="px-3 py-2">SIM</th>
                        <th className="px-3 py-2">Voertuig</th>
                        <th className="px-3 py-2">Aangemaakt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.activationOrders.map((o) => (
                        <tr
                          key={o.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/activations/${o.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {o.orderNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <ActivationOrderStatusBadge status={o.status as any} />
                          </td>
                          <td className="px-3 py-2">
                            {o.tracker ? (
                              <Link
                                href={`/trackers/${o.tracker.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {o.tracker.brand} {o.tracker.model}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {o.sim ? (
                              <Link
                                href={`/sims/${o.sim.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {formatIccid(o.sim.iccid)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {o.vehicle
                              ? o.vehicle.licensePlate ?? "Geen kenteken"
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                            {formatDate(o.createdAt)}
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

        {customer.subCustomers.length ? (
          <TabsContent value="subcustomers" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Subklanten</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {customer.subCustomers.map((s) => (
                    <Link
                      key={s.id}
                      href={`/customers/${s.id}`}
                      className="flex items-center justify-between rounded-md border p-3 hover:bg-slate-50"
                    >
                      <div>
                        <div className="font-semibold">{s.companyName}</div>
                        <div className="text-xs text-slate-500">
                          {s.customerNumber}
                        </div>
                      </div>
                      <CustomerStatusBadge status={s.status} />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Wijzigingsgeschiedenis
              </CardTitle>
              <CardDescription>
                Auditlog van wijzigingen op deze klant en gerelateerde
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
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  href?: string;
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
          href ? (
            <a
              href={href}
              className="block truncate underline-offset-4 hover:underline"
            >
              {value}
            </a>
          ) : (
            <div className="truncate">{value}</div>
          )
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
