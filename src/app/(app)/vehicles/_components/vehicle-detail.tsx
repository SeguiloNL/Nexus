"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Edit,
  Info,
  FileText,
  History,
  Trash2,
  AlertTriangle,
  Car,
  Cpu,
  User,
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
import { VehicleForm } from "./vehicle-form";
import {
  formatDate,
  formatLicensePlate,
  formatVin,
  formatImei,
} from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
import type { Vehicle } from "@prisma/client";

type DetailVehicle = Vehicle & {
  customer: { id: string; companyName: string; customerNumber: string } | null;
  trackerAssignments: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    tracker: {
      id: string;
      serialNumber: string;
      imei: string;
      brand: string | null;
      model: string | null;
    };
  }>;
};

type VehicleDetailProps = {
  vehicle: DetailVehicle;
  role: UserRole;
  customerOptions: { id: string; label: string }[];
  updateAction: (
    vehicleId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  deleteAction: (vehicleId: string) => Promise<void>;
  vehicleId: string;
};

export function VehicleDetail({
  vehicle,
  role,
  customerOptions,
  updateAction,
  deleteAction,
  vehicleId,
}: VehicleDetailProps) {
  const canEdit = canUserRole(role, "edit", "vehicle");
  const canDelete = canUserRole(role, "delete", "vehicle");

  const [, deleteFormAction] = useFormState(
    async (_p: unknown) => deleteAction(vehicleId),
    undefined
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/vehicles">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Car className="h-5 w-5 text-slate-500" />
              <h1 className="text-2xl font-bold tracking-tight">
                {vehicle.licensePlate
                  ? formatLicensePlate(vehicle.licensePlate)
                  : `${vehicle.brand ?? ""} ${vehicle.model ?? ""}`.trim() ||
                    "Voertuig"}
              </h1>
            </div>
            <div className="text-sm text-slate-500">
              {vehicle.vin ? (
                <>
                  VIN:{" "}
                  <span className="font-mono text-xs">
                    {formatVin(vehicle.vin)}
                  </span>
                </>
              ) : null}
              {vehicle.customer ? (
                <>
                  {" · Klant: "}
                  <Link
                    href={`/customers/${vehicle.customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {vehicle.customer.companyName} (
                    {vehicle.customer.customerNumber})
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
          <TabsTrigger value="trackers">
            <Cpu className="mr-1.5 h-4 w-4" /> Trackers (
            {vehicle.trackerAssignments.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Gegevens</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<Car className="h-4 w-4" />}
                  label="Kenteken"
                  value={
                    vehicle.licensePlate
                      ? formatLicensePlate(vehicle.licensePlate)
                      : null
                  }
                  mono
                />
                <InfoRow
                  icon={<Car className="h-4 w-4" />}
                  label="VIN"
                  value={vehicle.vin ? formatVin(vehicle.vin) : null}
                  mono
                />
                <InfoRow
                  icon={<Car className="h-4 w-4" />}
                  label="Merk"
                  value={vehicle.brand}
                />
                <InfoRow
                  icon={<Car className="h-4 w-4" />}
                  label="Model"
                  value={vehicle.model}
                />
                {vehicle.customer ? (
                  <InfoRow
                    icon={<User className="h-4 w-4" />}
                    label="Klant"
                    value={vehicle.customer.companyName}
                    linkHref={`/customers/${vehicle.customer.id}`}
                  />
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(vehicle.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(vehicle.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {(vehicle.description || vehicle.notes) ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {vehicle.description ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Beschrijving</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">
                      {vehicle.description}
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              {vehicle.notes ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Notities
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">
                      {vehicle.notes}
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <VehicleForm
              mode="edit"
              vehicleId={vehicleId}
              initial={vehicle}
              customerOptions={customerOptions.filter(
                (o) => !vehicle.customer || o.id !== vehicle.customer.id
              )}
              action={async (prev, form) =>
                updateAction(vehicleId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="trackers" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gekoppelde trackers</CardTitle>
              <CardDescription>
                Huidige en historie toewijzingen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vehicle.trackerAssignments.length ? (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Periode</th>
                        <th className="px-3 py-2">Serienr.</th>
                        <th className="px-3 py-2">IMEI</th>
                        <th className="px-3 py-2">Merk/Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicle.trackerAssignments.map((a) => (
                        <tr key={a.id} className="border-t hover:bg-slate-50">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {formatDate(a.startAt)}
                            {a.endAt
                              ? ` → ${formatDate(a.endAt)}`
                              : " (lopend)"}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/trackers/${a.tracker.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {a.tracker.serialNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {formatImei(a.tracker.imei)}
                          </td>
                          <td className="px-3 py-2">
                            {a.tracker.brand ?? ""} {a.tracker.model ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  Nog geen trackers gekoppeld.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Wijzigingsgeschiedenis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>
                  Auditlog (entityType=vehicle) — te vullen zodra de database
                  actief is.
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
  mono,
  linkHref,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  mono?: boolean;
  linkHref?: string;
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
          linkHref ? (
            <a
              href={linkHref}
              className={`block truncate underline-offset-4 hover:underline ${
                mono ? "font-mono text-xs" : ""
              }`}
            >
              {value}
            </a>
          ) : (
            <div className={`truncate ${mono ? "font-mono text-xs" : ""}`}>
              {value}
            </div>
          )
        ) : (
          <div className="text-slate-400">—</div>
        )}
      </div>
    </div>
  );
}
