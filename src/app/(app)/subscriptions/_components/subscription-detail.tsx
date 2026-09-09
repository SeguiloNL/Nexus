"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Pause,
  Play,
  Ban,
  Power,
  Edit,
  FileText,
  History,
  AlertTriangle,
  RotateCcw,
  ArrowRightLeft,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubscriptionForm } from "./subscription-form";
import {
  SubscriptionStatusBadge,
  TrackerStatusBadge,
  SimStatusBadge,
} from "@/components/ui/status-badges";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
import {
  formatCurrency,
  formatDate,
  formatImei,
  formatIccid,
  formatLicensePlate,
} from "@/lib/formatters";
import type { AssignmentReason, Subscription } from "@prisma/client";

type SubDetail = Subscription & {
  customer: { id: string; customerNumber: string; companyName: string };
  product: { id: string; productCode: string; name: string };
  trackerAssignments: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    reason?: AssignmentReason | null;
    tracker: {
      id: string;
      serialNumber: string;
      imei: string;
      brand: string | null;
      model: string | null;
      status: string;
    };
    vehicle?: {
      id: string;
      licensePlate: string | null;
      brand: string | null;
      model: string | null;
    } | null;
  }>;
  simAssignments: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    reason?: AssignmentReason | null;
    sim: {
      id: string;
      iccid: string;
      imsi: string;
      msisdn: string | null;
      provider: string | null;
      status: string;
    };
  }>;
};

interface Props {
  subscription: SubDetail;
  role: UserRole;
  customerOptions: { id: string; label: string }[];
  productOptions: any[];
  trackerStockOptions: { id: string; label: string }[];
  simStockOptions: { id: string; label: string }[];
  suspendAction: (id: string, prev: any, form: FormData) => any;
  resumeAction: (id: string) => any;
  cancelAction: (id: string, prev: any, form: FormData) => any;
  terminateAction: (id: string, prev: any, form: FormData) => any;
  deleteAction: (id: string) => any;
  updateAction: (id: string, prev: any, form: FormData) => any;
  unassignTrackerAction: (sid: string, tid: string) => any;
  unassignSimAction: (sid: string, simId: string) => any;
  replaceTrackerAction: (sid: string, prev: any, form: FormData) => any;
  replaceSimAction: (sid: string, prev: any, form: FormData) => any;
  subscriptionId: string;
}

export function SubscriptionDetail({
  subscription,
  role,
  customerOptions,
  productOptions,
  trackerStockOptions,
  simStockOptions,
  suspendAction,
  resumeAction,
  cancelAction,
  terminateAction,
  deleteAction,
  updateAction,
  unassignTrackerAction,
  unassignSimAction,
  replaceTrackerAction,
  replaceSimAction,
  subscriptionId,
}: Props) {
  const canEdit = canUserRole(role, "edit", "subscription");
  const canDelete = canUserRole(role, "delete", "subscription");

  const [, deleteFormAction] = useFormState(
    async () => deleteAction(subscriptionId),
    undefined
  );
  const [, resumeFormAction] = useFormState(
    async () => resumeAction(subscriptionId),
    undefined
  );

  const activeTracker = subscription.trackerAssignments.find(
    (a) => a.endAt === null
  );
  const activeSim = subscription.simAssignments.find(
    (a) => a.endAt === null
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/subscriptions">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {subscription.subscriptionNumber}
              </h1>
              <SubscriptionStatusBadge status={subscription.status as any} />
            </div>
            <div className="text-sm text-slate-500">
              <Link
                href={`/customers/${subscription.customer.id}`}
                className="underline-offset-4 hover:underline"
              >
                {subscription.customer.companyName}
              </Link>
              {" · "}
              {subscription.product.name}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {subscription.status === "ACTIVE" && canEdit ? (
            <SuspendDialog
              action={async (prev, form) =>
                suspendAction(subscriptionId, prev, form)
              }
            />
          ) : null}
          {subscription.status === "SUSPENDED" && canEdit ? (
            <form action={resumeFormAction}>
              <Button type="submit" variant="default">
                <Play className="h-4 w-4" /> Hervatten
              </Button>
            </form>
          ) : null}
          {(subscription.status === "ACTIVE" ||
            subscription.status === "SUSPENDED") &&
          canEdit ? (
            <CancelDialog
              action={async (prev, form) =>
                cancelAction(subscriptionId, prev, form)
              }
            />
          ) : null}
          {canDelete &&
          !["CANCELLED", "TERMINATED"].includes(subscription.status) ? (
            <TerminateDialog
              action={async (prev, form) =>
                terminateAction(subscriptionId, prev, form)
              }
            />
          ) : null}
          {canDelete && subscription.status === "DRAFT" ? (
            <form action={deleteFormAction}>
              <Button variant="destructive" type="submit">
                Verwijderen
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overzicht</TabsTrigger>
          {canEdit ? <TabsTrigger value="edit">Bewerken</TabsTrigger> : null}
          <TabsTrigger value="tracker">Tracker</TabsTrigger>
          <TabsTrigger value="sim">SIM</TabsTrigger>
          <TabsTrigger value="history">Geschiedenis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Abonnement</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                <Info label="Status">
                  <SubscriptionStatusBadge
                    status={subscription.status as any}
                  />
                </Info>
                <Info label="Klant">
                  <Link
                    href={`/customers/${subscription.customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {subscription.customer.companyName} (
                    {subscription.customer.customerNumber})
                  </Link>
                </Info>
                <Info label="Product">{subscription.product.name}</Info>
                <Info label="Facturatie">{subscription.billingCycle}</Info>
                <Info label="Maandprijs">
                  <span className="tabular-nums font-semibold">
                    {formatCurrency(String(subscription.monthlyPrice))}
                  </span>
                </Info>
                <Info label="Start / Eind">
                  {formatDate(subscription.startDate)}
                  {subscription.endDate
                    ? ` → ${formatDate(subscription.endDate)}`
                    : " (lopend)"}
                </Info>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Info label="Aangemaakt">
                  {formatDate(subscription.createdAt)}
                </Info>
                <Info label="Bijgewerkt">
                  {formatDate(subscription.updatedAt)}
                </Info>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Huidige tracker</CardTitle>
                  <CardDescription>
                    Actieve tracker assignment.
                  </CardDescription>
                </div>
                {activeTracker && canEdit ? (
                  <ReplaceTrackerDialog
                    oldTrackerId={activeTracker.tracker.id}
                    subscriptionId={subscriptionId}
                    options={trackerStockOptions}
                    action={(prev, form) =>
                      replaceTrackerAction(subscriptionId, prev, form)
                    }
                  />
                ) : null}
              </CardHeader>
              <CardContent>
                {activeTracker ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/trackers/${activeTracker.tracker.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {activeTracker.tracker.serialNumber}
                      </Link>
                      <TrackerStatusBadge
                        status={activeTracker.tracker.status as any}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <span className="text-slate-400">IMEI: </span>
                        <span className="font-mono">
                          {formatImei(activeTracker.tracker.imei)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">Merk/Model: </span>
                        {activeTracker.tracker.brand}{" "}
                        {activeTracker.tracker.model}
                      </div>
                    </div>
                    {activeTracker.vehicle ? (
                      <div className="rounded-md bg-slate-50 p-3 text-sm">
                        <div className="text-slate-400 text-xs">
                          Gekoppeld voertuig
                        </div>
                        <Link
                          href={`/vehicles/${activeTracker.vehicle.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {activeTracker.vehicle.licensePlate
                            ? formatLicensePlate(
                                activeTracker.vehicle.licensePlate
                              )
                            : `${activeTracker.vehicle.brand ?? ""} ${
                                activeTracker.vehicle.model ?? ""
                              }`}
                        </Link>
                      </div>
                    ) : null}
                    {canEdit ? (
                      <form
                        action={async () =>
                          unassignTrackerAction(
                            subscriptionId,
                            activeTracker.tracker.id
                          )
                        }
                      >
                        <Button size="sm" variant="outline" type="submit">
                          <Power className="mr-2 h-3.5 w-3.5" /> Ontkoppelen
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <EmptyHint text="Nog geen tracker toegewezen aan dit abonnement." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Huidige SIM</CardTitle>
                  <CardDescription>Actieve SIM assignment.</CardDescription>
                </div>
                {activeSim && canEdit ? (
                  <ReplaceSimDialog
                    oldSimId={activeSim.sim.id}
                    subscriptionId={subscriptionId}
                    options={simStockOptions}
                    action={(prev, form) =>
                      replaceSimAction(subscriptionId, prev, form)
                    }
                  />
                ) : null}
              </CardHeader>
              <CardContent>
                {activeSim ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/sims/${activeSim.sim.id}`}
                        className="font-medium font-mono text-sm underline-offset-4 hover:underline"
                      >
                        {formatIccid(activeSim.sim.iccid)}
                      </Link>
                      <SimStatusBadge
                        status={activeSim.sim.status as any}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <span className="text-slate-400">IMSI: </span>
                        <span className="font-mono">{activeSim.sim.imsi}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">MSISDN: </span>
                        {activeSim.sim.msisdn ?? "—"}
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400">Provider: </span>
                        {activeSim.sim.provider ?? "—"}
                      </div>
                    </div>
                    {canEdit ? (
                      <form
                        action={async () =>
                          unassignSimAction(
                            subscriptionId,
                            activeSim.sim.id
                          )
                        }
                      >
                        <Button size="sm" variant="outline" type="submit">
                          <Power className="mr-2 h-3.5 w-3.5" /> Ontkoppelen
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <EmptyHint text="Nog geen SIM toegewezen." />
                )}
              </CardContent>
            </Card>
          </div>

          {subscription.notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Notities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {subscription.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" className="mt-6">
            <SubscriptionForm
              mode="edit"
              subscriptionId={subscriptionId}
              initial={subscription}
              customerOptions={customerOptions.filter(
                (o) => o.id !== subscription.customer.id
              )}
              productOptions={productOptions}
              action={async (prev, form) =>
                updateAction(subscriptionId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="tracker" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tracker geschiedenis</CardTitle>
              <CardDescription>Alle assignments (lopend + historie).</CardDescription>
            </CardHeader>
            <CardContent>
              <AssignTable
                rows={subscription.trackerAssignments.map((a) => ({
                  period: a,
                  title: a.tracker.serialNumber,
                  sub: `${formatImei(a.tracker.imei)} · ${a.tracker.brand ?? ""} ${a.tracker.model ?? ""}`,
                  href: `/trackers/${a.tracker.id}`,
                  reason: a.reason ?? null,
                }))}
                headers={["Periode", "Tracker", "Details", "Reden"]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sim" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SIM geschiedenis</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignTable
                rows={subscription.simAssignments.map((a) => ({
                  period: a,
                  title: formatIccid(a.sim.iccid),
                  sub: `${a.sim.imsi} · ${a.sim.msisdn ?? ""} · ${a.sim.provider ?? ""}`,
                  href: `/sims/${a.sim.id}`,
                  reason: a.reason ?? null,
                }))}
                headers={["Periode", "ICCID", "Details", "Reden"]}
              />
            </CardContent>
          </Card>
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
                <div>
                  Auditlog (entityType=subscription + assignments) — te laden
                  zodra er acties op dit abonnement zijn uitgevoerd.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
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

function AssignTable({
  rows,
  headers,
}: {
  rows: Array<{
    period: { startAt: Date; endAt: Date | null };
    title: string;
    sub: string;
    href: string;
    reason: string | null;
  }>;
  headers: string[];
}) {
  if (!rows.length) {
    return (
      <EmptyHint text="Nog geen assignments op dit abonnement." />
    );
  }
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t hover:bg-slate-50">
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                {formatDate(r.period.startAt)}
                {r.period.endAt
                  ? ` → ${formatDate(r.period.endAt)}`
                  : " (lopend)"}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={r.href}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {r.title}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">{r.sub}</td>
              <td className="px-3 py-2">
                {r.reason ? <Badge variant="secondary">{r.reason}</Badge> : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuspendDialog({
  action,
}: {
  action: (prev: any, f: FormData) => any;
}) {
  const [s, formAction] = useFormState(action, { message: null });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pause className="mr-2 h-4 w-4" /> Opschorten
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abonnement opschorten</DialogTitle>
          <DialogDescription>
            De status verandert in SUSPENDED. Je kunt later hervatten.
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
            <Button type="submit" variant="outline">
              Opschorten
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <Ban className="mr-2 h-4 w-4" /> Annuleren
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abonnement annuleren</DialogTitle>
          <DialogDescription>
            Deze actie kan niet ongedaan gemaakt worden.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reden</Label>
            <Textarea name="reason" rows={3} required />
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

function TerminateDialog({
  action,
}: {
  action: (prev: any, f: FormData) => any;
}) {
  const [s, formAction] = useFormState(action, { message: null });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" className="ml-1">
          <RotateCcw className="mr-2 h-4 w-4" /> Beëindigen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abonnement beëindigen</DialogTitle>
          <DialogDescription>
            Status TERMINATED. Definitief.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reden</Label>
            <Textarea name="reason" rows={3} required />
          </div>
          {s?.message ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {s.message}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="destructive">
              Beëindigen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceTrackerDialog({
  subscriptionId,
  oldTrackerId,
  options,
  action,
}: {
  subscriptionId: string;
  oldTrackerId: string;
  options: { id: string; label: string }[];
  action: (prev: any, f: FormData) => any;
}) {
  const [s, formAction] = useFormState(action, { message: null });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ArrowRightLeft className="h-3.5 w-3.5" /> Vervangen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tracker vervangen</DialogTitle>
          <DialogDescription>
            Oude tracker koppeling wordt direct verbroken en nieuwe actief
            gemaakt.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="oldTrackerId" value={oldTrackerId} />
          <div className="space-y-1.5">
            <Label>Nieuwe tracker (alleen IN_STOCK)</Label>
            <Select name="newTrackerId">
              <SelectTrigger>
                <SelectValue placeholder="Kies tracker" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Oude tracker status</Label>
              <Select name="oldTrackerStatus" defaultValue="RETIRED">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_STOCK">IN_STOCK (hergebruik)</SelectItem>
                  <SelectItem value="RETIRED">RETIRED (defect/RMA)</SelectItem>
                  <SelectItem value="DEFECTIVE">DEFECTIVE</SelectItem>
                  <SelectItem value="RMA">RMA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reden</Label>
              <Select name="reason" defaultValue="REPLACEMENT">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REPLACEMENT">Vervanging (algemeen)</SelectItem>
                  <SelectItem value="RMA">RMA retour</SelectItem>
                  <SelectItem value="UPGRADE">Upgrade</SelectItem>
                  <SelectItem value="REMOVED">Verwijderd</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {s?.message ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {s.message}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit">Bevestig vervanging</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceSimDialog({
  oldSimId,
  options,
  action,
}: {
  subscriptionId: string;
  oldSimId: string;
  options: { id: string; label: string }[];
  action: (prev: any, f: FormData) => any;
}) {
  const [s, formAction] = useFormState(action, { message: null });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ArrowRightLeft className="h-3.5 w-3.5" /> Vervangen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>SIM vervangen</DialogTitle>
          <DialogDescription>
            Oude SIM koppeling wordt direct verbroken.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="oldSimId" value={oldSimId} />
          <div className="space-y-1.5">
            <Label>Nieuwe SIM (alleen IN_STOCK)</Label>
            <Select name="newSimId">
              <SelectTrigger>
                <SelectValue placeholder="Kies SIM" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Oude SIM status</Label>
              <Select name="oldSimStatus" defaultValue="RETIRED">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_STOCK">IN_STOCK (hergebruik)</SelectItem>
                  <SelectItem value="RETIRED">RETIRED</SelectItem>
                  <SelectItem value="BLOCKED">BLOCKED</SelectItem>
                  <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reden</Label>
              <Select name="reason" defaultValue="REPLACEMENT">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REPLACEMENT">Vervanging</SelectItem>
                  <SelectItem value="RMA">RMA retour</SelectItem>
                  <SelectItem value="UPGRADE">Upgrade</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {s?.message ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {s.message}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit">Bevestig vervanging</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
