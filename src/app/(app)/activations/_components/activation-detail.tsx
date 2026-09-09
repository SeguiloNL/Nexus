"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Play,
  RotateCcw,
  CheckSquare,
  Edit as EditIcon,
  FileText,
  History,
  Truck,
  CreditCard,
  Cpu,
  User,
  Calendar,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ActivationOrderStatusBadge,
  TrackerStatusBadge,
  SimStatusBadge,
  SubscriptionStatusBadge,
} from "@/components/ui/status-badges";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
import {
  formatCurrency,
  formatDate,
  formatImei,
  formatIccid,
  formatLicensePlate,
  formatVin,
} from "@/lib/formatters";

interface Data {
  id: string;
  orderNumber: string;
  status: string;
  desiredStartDate: Date;
  monthlyPrice: number;
  billingCycle: string;
  internalNotes: string | null;
  failureReason: string | null;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  customer: { id: string; customerNumber: string; companyName: string };
  subCustomer?: { id: string; customerNumber: string; companyName: string } | null;
  product: { id: string; productCode: string; name: string };
  tracker?: { id: string; serialNumber: string; imei: string; brand: string | null; model: string | null; status: string } | null;
  sim?: { id: string; iccid: string; imsi: string; msisdn: string | null; provider: string | null; status: string } | null;
  vehicle?: { id: string; licensePlate: string | null; vin: string | null; brand: string | null; model: string | null } | null;
  subscription?: { id: string; subscriptionNumber: string; status: string; monthlyPrice: number } | null;
  createdBy?: { id: string; name: string; email: string } | null;
}

interface Props {
  order: Data;
  role: UserRole;
  markReadyAction: (id: string) => any;
  cancelAction: (id: string, prev: any, f: FormData) => any;
  retryAction: (id: string) => any;
  completeAction: (id: string) => any;
  actionError?: string | null;
}

export function ActivationOrderDetail({
  order,
  role,
  markReadyAction,
  cancelAction,
  retryAction,
  completeAction,
  actionError,
}: Props) {
  const canEdit = canUserRole(role, "edit", "activationOrder");
  const canDelete = canUserRole(role, "delete", "activationOrder");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const [, formMarkReady] = useFormState(async () => {
    setBusy(true);
    try {
      await markReadyAction(order.id);
    } finally {
      setBusy(false);
    }
  }, undefined);

  const [, formRetry] = useFormState(async () => {
    setBusy(true);
    try {
      await retryAction(order.id);
    } finally {
      setBusy(false);
    }
  }, undefined);

  const [, formComplete] = useFormState(async () => {
    setBusy(true);
    try {
      await completeAction(order.id);
    } finally {
      setBusy(false);
    }
  }, undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/activations">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {order.orderNumber}
              </h1>
              <ActivationOrderStatusBadge status={order.status as any} />
            </div>
            <div className="text-sm text-slate-500">
              <Link
                href={`/customers/${order.customer.id}`}
                className="underline-offset-4 hover:underline"
              >
                {order.customer.companyName}
              </Link>
              {" · "}
              {order.product.name}
              {order.createdBy ? ` · Aangemaakt door ${order.createdBy.name}` : ""}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {order.status === "DRAFT" && canEdit ? (
            <Button asChild variant="outline">
              <Link href={`/activations/wizard?orderId=${order.id}`}>
                <EditIcon className="h-4 w-4" /> Bewerken in wizard
              </Link>
            </Button>
          ) : null}
          {order.status === "DRAFT" && canEdit ? (
            <form action={formMarkReady}>
              <Button type="submit" disabled={busy}>
                <CheckSquare className="h-4 w-4" /> Markeer READY
              </Button>
            </form>
          ) : null}
          {(order.status === "READY" || order.status === "FAILED") && canEdit ? (
            order.status === "READY" ? (
              <form action={formComplete}>
                <Button type="submit" disabled={busy}>
                  <Play className="h-4 w-4" /> Activeer nu!
                </Button>
              </form>
            ) : (
              <form action={formRetry}>
                <Button type="submit" disabled={busy} variant="outline">
                  <RotateCcw className="h-4 w-4" /> Opnieuw READY
                </Button>
              </form>
            )
          ) : null}
          {canDelete && (order.status === "DRAFT" || order.status === "READY") ? (
            <CancelDialog
              action={async (p, f) => cancelAction(order.id, p, f)}
            />
          ) : null}
        </div>
      </div>

      {order.status === "COMPLETED" && order.subscription ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <div className="font-medium text-emerald-800">
                  Activatie succesvol voltooid
                </div>
                <div className="text-xs text-emerald-700">
                  Abonnement: {order.subscription.subscriptionNumber} · afgerond {formatDate(order.completedAt!)}
                </div>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/subscriptions/${order.subscription.id}`}>
                Bekijk abonnement
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {order.status === "FAILED" ? (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex flex-wrap items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-red-800">Activatie mislukt</div>
              <div className="text-sm text-red-700 whitespace-pre-wrap break-words">
                {order.failureReason}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {actionError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {actionError}
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overzicht</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="history">Geschiedenis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Ordergegevens</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                <Info
                  icon={<User className="h-4 w-4" />}
                  label="Klant"
                  value={order.customer.companyName}
                  sub={order.customer.customerNumber}
                  link={`/customers/${order.customer.id}`}
                />
                {order.subCustomer ? (
                  <Info
                    icon={<User className="h-4 w-4" />}
                    label="Sub-klant"
                    value={order.subCustomer.companyName}
                    sub={order.subCustomer.customerNumber}
                    link={`/customers/${order.subCustomer.id}`}
                  />
                ) : null}
                <Info
                  icon={<CreditCard className="h-4 w-4" />}
                  label="Product"
                  value={order.product.name}
                  sub={order.product.productCode}
                />
                <Info
                  icon={<Calendar className="h-4 w-4" />}
                  label="Gewenste start"
                  value={formatDate(order.desiredStartDate)}
                />
                <Info
                  icon={<CreditCard className="h-4 w-4" />}
                  label="Maandprijs"
                  value={formatCurrency(String(order.monthlyPrice))}
                  sub={order.billingCycle}
                />
                {order.subscription ? (
                  <Info
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    label="Gekoppeld abonnement"
                    value={order.subscription.subscriptionNumber}
                    link={`/subscriptions/${order.subscription.id}`}
                    extra={
                      <SubscriptionStatusBadge
                        status={order.subscription.status as any}
                      />
                    }
                  />
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Status">
                  <ActivationOrderStatusBadge status={order.status as any} />
                </Row>
                <Row label="Aangemaakt">{formatDate(order.createdAt)}</Row>
                {order.completedAt ? (
                  <Row label="Voltooid">{formatDate(order.completedAt)}</Row>
                ) : null}
                {order.failedAt ? (
                  <Row label="Mislukt op">
                    {formatDate(order.failedAt)}
                  </Row>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {order.internalNotes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Interne opmerkingen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {order.internalNotes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="assets" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Tracker
                </CardTitle>
              </CardHeader>
              <CardContent>
                {order.tracker ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/trackers/${order.tracker.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {order.tracker.serialNumber}
                      </Link>
                      <TrackerStatusBadge status={order.tracker.status as any} />
                    </div>
                    <div className="text-xs text-slate-600">
                      IMEI:{" "}
                      <span className="font-mono">
                        {formatImei(order.tracker.imei)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {order.tracker.brand ?? ""} {order.tracker.model ?? ""}
                    </div>
                  </div>
                ) : (
                  <EmptyHint text="Nog geen tracker gekozen." />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> SIM
                </CardTitle>
              </CardHeader>
              <CardContent>
                {order.sim ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/sims/${order.sim.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {formatIccid(order.sim.iccid)}
                      </Link>
                      <SimStatusBadge status={order.sim.status as any} />
                    </div>
                    <div className="text-xs text-slate-600">
                      IMSI: <span className="font-mono">{order.sim.imsi}</span>
                    </div>
                    {order.sim.msisdn ? (
                      <div className="text-xs text-slate-600">
                        Nummer: {order.sim.msisdn}
                      </div>
                    ) : null}
                    <div className="text-xs text-slate-600">
                      Provider: {order.sim.provider ?? "—"}
                    </div>
                  </div>
                ) : (
                  <EmptyHint text="Nog geen SIM gekozen." />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Voertuig
                </CardTitle>
              </CardHeader>
              <CardContent>
                {order.vehicle ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/vehicles/${order.vehicle.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {order.vehicle.licensePlate
                          ? formatLicensePlate(order.vehicle.licensePlate)
                          : `${order.vehicle.brand ?? ""} ${
                              order.vehicle.model ?? ""
                            }`}
                      </Link>
                      <Badge variant="secondary">Gekoppeld</Badge>
                    </div>
                    {order.vehicle.vin ? (
                      <div className="text-xs text-slate-600">
                        VIN:{" "}
                        <span className="font-mono">
                          {formatVin(order.vehicle.vin)}
                        </span>
                      </div>
                    ) : null}
                    <div className="text-xs text-slate-600">
                      {order.vehicle.brand ?? ""} {order.vehicle.model ?? ""}
                    </div>
                  </div>
                ) : (
                  <EmptyHint text="Optioneel: geen voertuig geselecteerd." />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" /> Wijzigingsgeschiedenis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>Auditlog (entityType=activationOrder) — wordt in volgende UI taak volledig ingeladen.</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({
  icon,
  label,
  value,
  sub,
  link,
  extra,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  link?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon ? (
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {link ? (
          <a
            href={link}
            className="block truncate font-medium underline-offset-4 hover:underline"
          >
            {value}
          </a>
        ) : (
          <div className="truncate font-medium">{value}</div>
        )}
        {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
        {extra}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function CancelDialog({
  action,
}: {
  action: (prev: any, f: FormData) => any;
}) {
  const [s, formAction] = useFormState(action, { message: null });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Ban className="h-4 w-4" /> Annuleren
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Order annuleren</DialogTitle>
          <DialogDescription>
            Order status gaat naar CANCELLED. Kan niet ongedaan.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reden (optioneel)</Label>
            <Textarea name="reason" rows={3} />
          </div>
          {s?.message ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {s.message}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="destructive">
              Annuleren bevestigen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
