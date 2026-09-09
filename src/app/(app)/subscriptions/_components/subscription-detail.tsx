"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Edit,
  History,
  Receipt,
  Car,
  CreditCard,
  Navigation,
  Pause,
  Play,
  Ban,
  Skull,
  ClipboardList,
  Plus,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SubscriptionStatusBadge,
  TrackerStatusBadge,
  SimStatusBadge,
  BillingCycleLabel,
  AssignmentReasonLabel,
  AuditActionBadge,
} from "@/components/ui/status-badges";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatImei,
  formatIccid,
  formatMsisdn,
  formatLicensePlate,
  formatVin,
} from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole, TrackerStatus, SimStatus, BillingCycle } from "@/types/enums";
import { SubscriptionStatus } from "@/types/enums";
import {
  updateSubscriptionAction,
  updateSubscriptionStatusAction,
  assignTrackerAction,
  unassignTrackerAction,
  replaceTrackerAction,
  assignSimAction,
  unassignSimAction,
  replaceSimAction,
} from "../actions";
import { SubscriptionForm } from "./subscription-form";
import type { Subscription, TrackerAssignment, SimAssignment } from "@prisma/client";

type DetailSubscription = Subscription & {
  customer: { id: string; companyName: string; customerNumber: string };
  product: {
    id: string;
    name: string;
    productCode: string;
    description: string | null;
    monthlyPrice: number;
  };
  trackerAssignments: Array<
    TrackerAssignment & {
      tracker: {
        id: string;
        serialNumber: string;
        imei: string;
        brand: string;
        model: string;
        status: TrackerStatus;
      };
      vehicle: {
        id: string;
        licensePlate: string | null;
        vin: string | null;
        brand: string | null;
        model: string | null;
      } | null;
    }
  >;
  simAssignments: Array<
    SimAssignment & {
      sim: {
        id: string;
        iccid: string;
        msisdn: string | null;
        provider: string;
        status: SimStatus;
      };
    }
  >;
};

type AssignmentHistory = {
  trackers: Array<
    TrackerAssignment & {
      tracker: { id: string; serialNumber: string; imei: string };
      vehicle: { id: string; licensePlate: string | null } | null;
    }
  >;
  sims: Array<
    SimAssignment & {
      sim: { id: string; iccid: string; msisdn: string | null };
    }
  >;
};

type AuditLogs = Array<{
  id: string;
  timestamp: Date;
  action: string;
  user: { name: string; email: string } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}>;

type Option = { id: string; label: string };

type SubscriptionDetailProps = {
  subscription: DetailSubscription;
  history: AssignmentHistory;
  auditLogs: AuditLogs;
  parentOptions?: Option[];
  customerOptions: Option[];
  productOptions: Option[];
  availableTrackers: Option[];
  availableSims: Option[];
  availableVehicles: Option[];
  role: UserRole;
  subscriptionId: string;
};

function SubmitButton({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "destructive" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant as any} disabled={pending}>
      {children}
    </Button>
  );
}

export function SubscriptionDetail({
  subscription,
  history,
  auditLogs,
  customerOptions,
  productOptions,
  availableTrackers,
  availableSims,
  availableVehicles,
  role,
  subscriptionId,
}: SubscriptionDetailProps) {
  const canEdit = canUserRole(role, "edit", "subscription");
  const canCreate = canUserRole(role, "create", "subscription");
  const status = subscription.status as unknown as SubscriptionStatus;
  const activeTracker = subscription.trackerAssignments[0] ?? null;
  const activeSim = subscription.simAssignments[0] ?? null;
  const activeVehicle = activeTracker?.vehicle ?? null;

  const updateAction = async (prev: any, fd: FormData) =>
    updateSubscriptionAction(subscriptionId, prev, fd);

  const [, suspendForm] = useFormState(
    async (p: unknown, fd: FormData) => {
      const r = await updateSubscriptionStatusAction(subscriptionId, p, fd);
      if ((r as any)?.ok) toast.success("Abonnement opgeschort.");
      else if ((r as any)?.message) toast.error((r as any).message);
      return r;
    },
    undefined
  );
  const [, resumeForm] = useFormState(
    async (p: unknown, fd: FormData) => {
      const r = await updateSubscriptionStatusAction(subscriptionId, p, fd);
      if ((r as any)?.ok) toast.success("Abonnement hervat.");
      else if ((r as any)?.message) toast.error((r as any).message);
      return r;
    },
    undefined
  );
  const [, cancelForm] = useFormState(
    async (p: unknown, fd: FormData) => {
      const r = await updateSubscriptionStatusAction(subscriptionId, p, fd);
      if ((r as any)?.ok) toast.success("Abonnement beëindigd (cancel).");
      else if ((r as any)?.message) toast.error((r as any).message);
      return r;
    },
    undefined
  );
  const [, terminateForm] = useFormState(
    async (p: unknown, fd: FormData) => {
      const r = await updateSubscriptionStatusAction(subscriptionId, p, fd);
      if ((r as any)?.ok) toast.success("Abonnement definitief beëindigd.");
      else if ((r as any)?.message) toast.error((r as any).message);
      return r;
    },
    undefined
  );

  const [assignTrackerState, assignTrackerForm] = useFormState(
    assignTrackerAction,
    {}
  );
  const [assignSimState, assignSimForm] = useFormState(assignSimAction, {});

  useEffect(() => {
    if (assignTrackerState?.message && assignTrackerState.ok) {
      toast.success(assignTrackerState.message);
    } else if (assignTrackerState?.message && !assignTrackerState.ok) {
      toast.error(assignTrackerState.message);
    }
    if (assignSimState?.message && assignSimState.ok) {
      toast.success(assignSimState.message);
    } else if (assignSimState?.message && !assignSimState.ok) {
      toast.error(assignSimState.message);
    }
  }, [assignTrackerState, assignSimState]);

  const canSuspend = canEdit && status === SubscriptionStatus.ACTIVE;
  const canResume = canEdit && status === SubscriptionStatus.SUSPENDED;
  const canCancel =
    canEdit &&
    (status === SubscriptionStatus.ACTIVE ||
      status === SubscriptionStatus.SUSPENDED ||
      status === SubscriptionStatus.PENDING_ACTIVATION ||
      status === SubscriptionStatus.DRAFT);
  const canTerminate =
    canEdit &&
    (status === SubscriptionStatus.ACTIVE ||
      status === SubscriptionStatus.SUSPENDED);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/subscriptions">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {subscription.subscriptionNumber}
              </h1>
              <SubscriptionStatusBadge status={subscription.status as unknown as string} />
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
          {canSuspend ? (
            <form action={suspendForm}>
              <input type="hidden" name="status" value="SUSPENDED" />
              <input type="hidden" name="reason" value="Handmatig opgeschort" />
              <Button variant="outline" size="sm" type="submit">
                <Pause className="h-4 w-4 mr-1.5" /> Opschorten
              </Button>
            </form>
          ) : null}
          {canResume ? (
            <form action={resumeForm}>
              <input type="hidden" name="status" value="ACTIVE" />
              <Button variant="outline" size="sm" type="submit">
                <Play className="h-4 w-4 mr-1.5" /> Hervatten
              </Button>
            </form>
          ) : null}
          {canCancel ? (
            <form action={cancelForm}>
              <input type="hidden" name="status" value="CANCELLED" />
              <input type="hidden" name="reason" value="Geannuleerd" />
              <Button variant="outline" size="sm" type="submit">
                <Ban className="h-4 w-4 mr-1.5" /> Annuleren
              </Button>
            </form>
          ) : null}
          {canTerminate ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Skull className="h-4 w-4 mr-1.5" /> Definitief beëindigen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Abonnement definitief beëindigen?</DialogTitle>
                  <DialogDescription>
                    Dit kan niet ongedaan worden gemaakt. Status wordt
                    TERMINATED.
                  </DialogDescription>
                </DialogHeader>
                <form action={terminateForm}>
                  <input type="hidden" name="status" value="TERMINATED" />
                  <input type="hidden" name="reason" value="Beëindigd" />
                  <DialogFooter className="mt-4 gap-2">
                    <DialogTrigger asChild>
                      <Button variant="outline" type="button">
                        Annuleren
                      </Button>
                    </DialogTrigger>
                    <Button variant="destructive" type="submit">
                      Definitief beëindigen
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
          {canEdit ? (
            <Button asChild variant="default">
              <a href="#edit">
                <Edit className="h-4 w-4 mr-1.5" /> Bewerken
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">
            <Receipt className="mr-1.5 h-4 w-4" />
            Overzicht
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" />
            Geschiedenis
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ClipboardList className="mr-1.5 h-4 w-4" />
            Auditlog
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" />
              Bewerken
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Abonnement</CardTitle>
                <CardDescription>
                  {subscription.subscriptionNumber}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Product</span>
                  <span className="font-medium">{subscription.product.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Productcode</span>
                  <span>{subscription.product.productCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Maandprijs</span>
                  <span className="font-medium">
                    {formatCurrency(Number(subscription.monthlyPrice))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Facturatie</span>
                  <span>
                    <BillingCycleLabel cycle={subscription.billingCycle as unknown as string} />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Startdatum</span>
                  <span>{formatDate(subscription.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Einddatum</span>
                  <span>{formatDate(subscription.endDate)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Klant</CardTitle>
                <CardDescription>
                  {subscription.customer.customerNumber}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="font-medium">
                  <Link
                    href={`/customers/${subscription.customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {subscription.customer.companyName}
                  </Link>
                </div>
                <div className="text-slate-500">
                  <Receipt className="inline h-3.5 w-3.5 mr-1" />
                  {subscription.customer.customerNumber}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle>Tracker</CardTitle>
                  <CardDescription>Huidige toewijzing</CardDescription>
                </div>
                {canEdit ? (
                  activeTracker ? (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Edit className="h-4 w-4 mr-1" /> Vervangen
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Tracker vervangen</DialogTitle>
                          <DialogDescription>
                            Selecteer een nieuwe tracker (IN_STOCK).
                          </DialogDescription>
                        </DialogHeader>
                        <form action={replaceTrackerAction as any}>
                          <input type="hidden" name="subscriptionId" value={subscriptionId} />
                          <input type="hidden" name="oldTrackerId" value={activeTracker.trackerId} />
                          <div className="space-y-4 my-4">
                            <div>
                              <Label>Nieuwe tracker</Label>
                              <Select name="newTrackerId">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Selecteer tracker" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableTrackers.filter(t => t.id !== activeTracker.trackerId).map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Reden oude tracker</Label>
                              <Select name="oldTrackerDisposition" defaultValue="IN_STOCK">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="IN_STOCK">Op voorraad</SelectItem>
                                  <SelectItem value="RETIRED">Buiten gebruik</SelectItem>
                                  <SelectItem value="DEFECTIVE">Defect</SelectItem>
                                  <SelectItem value="RMA">RMA</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Opmerking</Label>
                              <Input name="reason" placeholder="Optioneel" className="mt-1.5" />
                            </div>
                          </div>
                          <DialogFooter>
                            <SubmitButton>Vervangen</SubmitButton>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  ) : (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus className="h-4 w-4 mr-1" /> toewijzen
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Tracker toewijzen</DialogTitle>
                          <DialogDescription>
                            Selecteer een tracker (IN_STOCK of RESERVED).
                          </DialogDescription>
                        </DialogHeader>
                        <form action={assignTrackerForm}>
                          <input type="hidden" name="subscriptionId" value={subscriptionId} />
                          <div className="space-y-4 my-4">
                            <div>
                              <Label>Tracker</Label>
                              <Select name="trackerId">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Selecteer tracker" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableTrackers.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {assignTrackerState?.errors?.trackerId ? (
                                <p className="mt-1 text-sm text-red-600">
                                  {assignTrackerState.errors.trackerId[0]}
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <Label>Voertuig (optioneel)</Label>
                              <Select name="vehicleId">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Geen voertuig" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableVehicles.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>
                                      {v.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <DialogFooter>
                            <SubmitButton>Toewijzen</SubmitButton>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )
                ) : null}
              </CardHeader>
              <CardContent className="text-sm">
                {activeTracker ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Serienummer</span>
                      <Link
                        href={`/trackers/${activeTracker.tracker.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {activeTracker.tracker.serialNumber}
                      </Link>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">IMEI</span>
                      <span className="font-mono text-xs">
                        {formatImei(activeTracker.tracker.imei)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Merk/Model</span>
                      <span>
                        {activeTracker.tracker.brand} {activeTracker.tracker.model}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Status</span>
                      <TrackerStatusBadge status={activeTracker.tracker.status as unknown as string} />
                    </div>
                    {canEdit ? (
                      <form action={unassignTrackerAction as any} className="pt-2">
                        <input type="hidden" name="trackerId" value={activeTracker.trackerId} />
                        <input type="hidden" name="subscriptionId" value={subscriptionId} />
                        <Button
                          size="sm"
                          variant="destructive"
                          type="submit"
                          className="w-full"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" /> Ontkoppelen
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-slate-500">
                    <Navigation className="h-6 w-6 mr-2 inline opacity-50" />
                    Nog geen tracker toegewezen.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle>SIM-kaart</CardTitle>
                  <CardDescription>Huidige toewijzing</CardDescription>
                </div>
                {canEdit ? (
                  activeSim ? (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Edit className="h-4 w-4 mr-1" /> Vervangen
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>SIM vervangen</DialogTitle>
                          <DialogDescription>
                            Selecteer een nieuwe SIM (IN_STOCK).
                          </DialogDescription>
                        </DialogHeader>
                        <form action={replaceSimAction as any}>
                          <input type="hidden" name="subscriptionId" value={subscriptionId} />
                          <input type="hidden" name="oldSimId" value={activeSim.simId} />
                          <div className="space-y-4 my-4">
                            <div>
                              <Label>Nieuwe SIM</Label>
                              <Select name="newSimId">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Selecteer SIM" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableSims.filter(s => s.id !== activeSim.simId).map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Reden oude SIM</Label>
                              <Select name="oldSimDisposition" defaultValue="IN_STOCK">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="IN_STOCK">Op voorraad</SelectItem>
                                  <SelectItem value="RETIRED">Buiten gebruik</SelectItem>
                                  <SelectItem value="CANCELLED">Opgezegd</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Opmerking</Label>
                              <Input name="reason" placeholder="Optioneel" className="mt-1.5" />
                            </div>
                          </div>
                          <DialogFooter>
                            <SubmitButton>Vervangen</SubmitButton>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  ) : (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus className="h-4 w-4 mr-1" /> toewijzen
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>SIM toewijzen</DialogTitle>
                          <DialogDescription>
                            Selecteer een SIM (IN_STOCK of RESERVED).
                          </DialogDescription>
                        </DialogHeader>
                        <form action={assignSimForm}>
                          <input type="hidden" name="subscriptionId" value={subscriptionId} />
                          <div className="space-y-4 my-4">
                            <div>
                              <Label>SIM</Label>
                              <Select name="simId">
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Selecteer SIM" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableSims.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {assignSimState?.errors?.simId ? (
                                <p className="mt-1 text-sm text-red-600">
                                  {assignSimState.errors.simId[0]}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <DialogFooter>
                            <SubmitButton>Toewijzen</SubmitButton>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )
                ) : null}
              </CardHeader>
              <CardContent className="text-sm">
                {activeSim ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">ICCID</span>
                      <Link
                        href={`/sims/${activeSim.sim.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {formatIccid(activeSim.sim.iccid)}
                      </Link>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">MSISDN</span>
                      <span>{formatMsisdn(activeSim.sim.msisdn)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Provider</span>
                      <span>{activeSim.sim.provider}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Status</span>
                      <SimStatusBadge status={activeSim.sim.status as unknown as string} />
                    </div>
                    {canEdit ? (
                      <form action={unassignSimAction as any} className="pt-2">
                        <input type="hidden" name="simId" value={activeSim.simId} />
                        <input type="hidden" name="subscriptionId" value={subscriptionId} />
                        <Button
                          size="sm"
                          variant="destructive"
                          type="submit"
                          className="w-full"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" /> Ontkoppelen
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-slate-500">
                    <CreditCard className="h-6 w-6 mr-2 inline opacity-50" />
                    Nog geen SIM toegewezen.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Voertuig</CardTitle>
                <CardDescription>Gekoppeld via tracker</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                {activeVehicle ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Kenteken</span>
                      <span className="font-mono">
                        {formatLicensePlate(activeVehicle.licensePlate)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">VIN</span>
                      <span className="font-mono text-xs">
                        {formatVin(activeVehicle.vin)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Merk/Model</span>
                      <span>
                        {activeVehicle.brand} {activeVehicle.model}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500">
                    <Car className="h-6 w-6 mr-2 inline opacity-50" />
                    Nog geen voertuig gekoppeld.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Opmerkingen</CardTitle>
              </CardHeader>
              <CardContent>
                {subscription.notes ? (
                  <p className="text-sm whitespace-pre-wrap">{subscription.notes}</p>
                ) : (
                  <p className="text-sm text-slate-500">Geen opmerkingen.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tracker geschiedenis</CardTitle>
              <CardDescription>Alle tracker toewijzingen</CardDescription>
            </CardHeader>
            <CardContent>
              {history.trackers.length === 0 ? (
                <p className="text-sm text-slate-500">Nog geen geschiedenis.</p>
              ) : (
                <div className="space-y-3">
                  {history.trackers.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start justify-between border-b border-slate-100 py-2 last:border-0"
                    >
                      <div>
                        <div className="font-medium text-sm">
                          {formatImei(a.tracker.imei)} · {a.tracker.serialNumber}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(a.startAt)} → {formatDateTime(a.endAt)}
                          {a.vehicle?.licensePlate ? (
                            <> · {formatLicensePlate(a.vehicle.licensePlate)}</>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <AssignmentReasonLabel reason={a.reason} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SIM geschiedenis</CardTitle>
              <CardDescription>Alle SIM toewijzingen</CardDescription>
            </CardHeader>
            <CardContent>
              {history.sims.length === 0 ? (
                <p className="text-sm text-slate-500">Nog geen geschiedenis.</p>
              ) : (
                <div className="space-y-3">
                  {history.sims.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start justify-between border-b border-slate-100 py-2 last:border-0"
                    >
                      <div>
                        <div className="font-medium font-mono text-xs">
                          {formatIccid(a.sim.iccid)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(a.startAt)} → {formatDateTime(a.endAt)}
                          {a.sim.msisdn ? <> · {formatMsisdn(a.sim.msisdn)}</> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <AssignmentReasonLabel reason={a.reason} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Auditlog</CardTitle>
              <CardDescription>
                Alle acties op dit abonnement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-slate-500">Nog geen audit entries.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2 pr-4">Tijd</th>
                        <th className="py-2 pr-4">Actie</th>
                        <th className="py-2 pr-4">Gebruiker</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100 align-top">
                          <td className="py-2 pr-4 whitespace-nowrap">
                            {formatDateTime(l.timestamp)}
                          </td>
                          <td className="py-2 pr-4">
                            <AuditActionBadge action={l.action} />
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            {l.user?.name ?? l.user?.email ?? "—"}
                          </td>
                          <td className="py-2 text-xs text-slate-600">
                            {l.newValues ? (
                              <details>
                                <summary className="cursor-pointer">
                                  Nieuwe waarden
                                </summary>
                                <pre className="mt-1 bg-slate-50 p-2 rounded">
                                  {JSON.stringify(l.newValues, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" className="mt-6">
            <SubscriptionForm
              mode="edit"
              initial={{
                subscriptionNumber: subscription.subscriptionNumber,
                customerId: subscription.customerId,
                productId: subscription.productId,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                status: status,
                monthlyPrice: Number(subscription.monthlyPrice),
                billingCycle: subscription.billingCycle as unknown as BillingCycle,
                notes: subscription.notes,
              }}
              customerOptions={customerOptions}
              productOptions={productOptions}
              action={updateAction}
              subscriptionId={subscriptionId}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
