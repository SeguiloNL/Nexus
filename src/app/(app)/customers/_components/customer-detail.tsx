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
import { CustomerStatusBadge } from "@/components/ui/status-badges";
import { CustomerForm } from "./customer-form";
import { formatDate } from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
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
    monthlyPrice: number;
    startDate: Date;
    endDate: Date | null;
  }>;
  vehicles: Array<{
    id: string;
    licensePlate: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
  }>;
};

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
};

export function CustomerDetail({
  customer,
  parentOptions,
  role,
  updateAction,
  deleteAction,
  customerId,
}: CustomerDetailProps) {
  const canEdit = canUserRole(role, "edit", "customer");
  const canDelete = canUserRole(role, "delete", "customer");

  const [, deleteFormAction] = useFormState(
    async (p: unknown) => deleteAction(customerId),
    undefined
  );

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
          <TabsTrigger value="vehicles">
            <Car className="mr-1.5 h-4 w-4" />
            Voertuigen ({customer.vehicles.length})
          </TabsTrigger>
          {customer.subCustomers.length ? (
            <TabsTrigger value="subcustomers">
              <Users className="mr-1.5 h-4 w-4" />
              Subklanten ({customer.subCustomers.length})
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" />
            Geschiedenis
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
                Wordt gevuld door de auditlog service (klik Auditlog in het
                menu om alles te bekijken).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>
                  Auditlog regels voor deze entiteit laden via de
                  <code className="mx-1 rounded bg-slate-100 px-1">
                    AuditService
                  </code>
                  met <code>entityType=customer</code>. Zodra de database
                  beschikbaar is wordt deze lijst automatisch gevuld.
                </div>
              </div>
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
