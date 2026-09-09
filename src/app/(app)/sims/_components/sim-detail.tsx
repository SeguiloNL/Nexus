"use client";

import Link from "next/link";
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
  AlertTriangle,
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
import { formatDate, formatIccid, formatMsisdn } from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
import type { SIM, SimStatus, AssignmentReason } from "@prisma/client";

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
};

export function SimDetail({
  sim,
  role,
  updateAction,
  deleteAction,
  simId,
}: SimDetailProps) {
  const canEdit = canUserRole(role, "edit", "sim");
  const canDelete = canUserRole(role, "delete", "sim");

  const [, deleteFormAction] = useFormState(
    async (_p: unknown) => deleteAction(simId),
    undefined
  );

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
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(sim.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(sim.updatedAt)}</span>
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
                Auditlog voor deze SIM.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>
                  Wordt gevuld door de AuditService met entityType=sim zodra
                  de database beschikbaar is.
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
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
