"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  CheckSquare,
  User,
  CreditCard,
  Cpu,
  Truck,
  FileCheck2,
  RotateCcw,
  Play,
  PlayCircle,
  RefreshCw,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DataTable,
  type ColumnDef,
} from "@/components/data-table/data-table";
import {
  ActivationOrderStatusBadge,
  TrackerStatusBadge,
  SimStatusBadge,
  CustomerStatusBadge,
} from "@/components/ui/status-badges";
import {
  formatCurrency,
  formatDate,
  formatImei,
  formatIccid,
  formatLicensePlate,
} from "@/lib/formatters";
import { toast } from "sonner";
import type { OrderActionState } from "../actions";
import type { UserRole } from "@/types/enums";
import { canUserRole } from "@/lib/auth/session";

type CustomerOption = {
  id: string;
  customerNumber: string;
  companyName: string;
  status: string;
  parentCustomerId: string | null;
};
type ProductOption = {
  id: string;
  productCode: string;
  name: string;
  monthlyPrice: number;
  description: string | null;
};
type TrackerOption = {
  id: string;
  serialNumber: string;
  imei: string;
  brand: string | null;
  model: string | null;
  status: string;
};
type SimOption = {
  id: string;
  iccid: string;
  imsi: string;
  msisdn: string | null;
  provider: string | null;
  status: string;
};
type VehicleOption = {
  id: string;
  licensePlate: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
};

interface Props {
  role: UserRole;
  customerOptions: CustomerOption[];
  productOptions: ProductOption[];
  trackerStock: TrackerOption[];
  simStock: SimOption[];
  vehiclesByCustomerMap: Record<string, VehicleOption[]>;
  initialOrder?: null | {
    id: string;
    customerId: string;
    subCustomerId: string | null;
    productId: string;
    desiredStartDate: string;
    monthlyPrice: number;
    billingCycle: string;
    trackerId: string | null;
    simId: string | null;
    vehicleId: string | null;
    internalNotes: string | null;
    status: string;
    orderNumber: string;
  };
  createAction: (
    prev: OrderActionState,
    f: FormData
  ) => Promise<OrderActionState>;
  updateAction: (
    orderId: string,
    prev: OrderActionState,
    f: FormData
  ) => Promise<OrderActionState>;
  markReadyAction: (id: string) => Promise<any>;
  completeActivationAction: (id: string) => Promise<any>;
  validateAndSubscribeSimAction: (
    simId: string,
    orderId?: string
  ) => Promise<any>;
}

const STEP_NAMES = [
  { icon: User, label: "Klant" },
  { icon: CreditCard, label: "Product" },
  { icon: Cpu, label: "Tracker" },
  { icon: CreditCard, label: "SIM" },
  { icon: Truck, label: "Voertuig" },
  { icon: FileCheck2, label: "Controle" },
];

export function ActivationWizard({
  role,
  customerOptions,
  productOptions,
  trackerStock,
  simStock,
  vehiclesByCustomerMap,
  initialOrder,
  createAction,
  updateAction,
  markReadyAction,
  completeActivationAction,
  validateAndSubscribeSimAction,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const openOrderId = initialOrder?.id ?? null;

  const canEditPrice = canUserRole(role, "edit", "product");
  const canActivateSim = canUserRole(role, "edit", "sim") && canUserRole(role, "edit", "activation_order");

  const isAdmin = canActivateSim;

  const [step, setStep] = useState(
    Number(sp?.get("step") ?? (initialOrder?.status === "READY" ? 6 : 1))
  );
  const [form, setForm] = useState<{
    customerId: string;
    subCustomerId: string | null;
    productId: string;
    desiredStartDate: string;
    monthlyPrice: string;
    billingCycle: string;
    trackerId: string | null;
    simId: string | null;
    vehicleId: string | null;
    internalNotes: string;
  }>(() => ({
    customerId: initialOrder?.customerId ?? "",
    subCustomerId: initialOrder?.subCustomerId ?? null,
    productId: initialOrder?.productId ?? "",
    desiredStartDate:
      initialOrder?.desiredStartDate ??
      new Date().toISOString().substring(0, 10),
    monthlyPrice:
      initialOrder?.monthlyPrice != null
        ? String(initialOrder.monthlyPrice)
        : String(productOptions[0]?.monthlyPrice ?? 0),
    billingCycle: initialOrder?.billingCycle ?? "MONTHLY",
    trackerId: initialOrder?.trackerId ?? null,
    simId: initialOrder?.simId ?? null,
    vehicleId: initialOrder?.vehicleId ?? null,
    internalNotes: initialOrder?.internalNotes ?? "",
  }));

  useEffect(() => {
    const p = productOptions.find((x) => x.id === form.productId);
    if (p && !form.monthlyPrice) {
      setForm((f) => ({ ...f, monthlyPrice: String(p.monthlyPrice) }));
    }
  }, [form.productId, productOptions, form.monthlyPrice]);

  const selectedCustomer = customerOptions.find(
    (c) => c.id === form.customerId
  );
  const selectedSub = form.subCustomerId
    ? customerOptions.find((c) => c.id === form.subCustomerId)
    : null;
  const selectedProduct = productOptions.find(
    (p) => p.id === form.productId
  );
  const selectedTracker = trackerStock.find(
    (t) => t.id === form.trackerId
  );
  const selectedSim = simStock.find((s) => s.id === form.simId);
  const vehiclesOfCustomer = form.customerId
    ? vehiclesByCustomerMap[form.customerId] ?? []
    : [];
  const selectedVehicle = vehiclesOfCustomer.find(
    (v) => v.id === form.vehicleId
  );

  const mainCustomerId = form.customerId;
  const subCustomers = useMemo(
    () =>
      customerOptions.filter(
        (c) => c.parentCustomerId === mainCustomerId
      ),
    [customerOptions, mainCustomerId]
  );

  const stepErrors: Record<number, string[]> = {};
  if (!form.customerId) stepErrors[1] = ["Kies een klant."];

  stepErrors[2] = [];
  if (!form.productId) stepErrors[2].push("Kies product.");
  if (!form.desiredStartDate) stepErrors[2].push("Gewenste startdatum ontbreekt.");
  if (stepErrors[2].length === 0) delete stepErrors[2];

  if (!form.trackerId) stepErrors[3] = ["Kies tracker (IN_STOCK/RESERVED)."];
  if (!form.simId) stepErrors[4] = ["Kies SIM (IN_STOCK/RESERVED)."];

  const isReadyErrors: string[] = [];
  if (!form.customerId) isReadyErrors.push("Klant ontbreekt.");
  if (!form.productId) isReadyErrors.push("Product ontbreekt.");
  if (!form.desiredStartDate) isReadyErrors.push("Gewenste startdatum ontbreekt.");
  if (!form.trackerId) isReadyErrors.push("Tracker ontbreekt.");
  if (!form.simId) isReadyErrors.push("SIM ontbreekt.");

  async function persistAsDraft() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v != null && v !== "") fd.append(k, String(v));
    }
    if (initialOrder) {
      await updateAction(initialOrder.id, { message: null }, fd);
    } else {
      const res = await createAction({ message: null }, fd);
      if (res?.message) toast.error(res.message);
    }
  }

  async function markReadyAndActivate(fromStep6: boolean) {
    if (isReadyErrors.length) {
      toast.error("Nog niet volledig: " + isReadyErrors.join(", "));
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v != null && v !== "") fd.append(k, String(v));
    }
    let orderId = openOrderId;
    if (!orderId) {
      const res = await createAction({ message: null }, fd);
      if (res?.orderId) orderId = res.orderId;
      else if (res?.message) {
        toast.error(res.message);
        return;
      }
    } else {
      await updateAction(orderId, { message: null }, fd);
    }
    if (!orderId) {
      toast.error("Order kon niet worden opgeslagen.");
      return;
    }
    try {
      const rr = await markReadyAction(orderId);
      if (rr?.message) {
        toast.error(rr.message);
        return;
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Kon niet READY maken.");
      return;
    }
    if (fromStep6) {
      try {
        await completeActivationAction(orderId);
      } catch (e: any) {
        toast.error("Activatie mislukt: " + (e?.message ?? "onbekend"));
      }
    }
  }

  const busy = false;

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
            <h1 className="text-2xl font-bold tracking-tight">
              {openOrderId
                ? `Activatie ${initialOrder?.orderNumber ?? ""} bewerken`
                : "Nieuwe activatie"}
            </h1>
            <p className="text-sm text-slate-500">
              {openOrderId ? (
                <>
                  Status:{" "}
                  <ActivationOrderStatusBadge
                    status={initialOrder!.status as any}
                  />
                </>
              ) : (
                "Klant, product en assets selecteren, dan activeren."
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={async () => {
              await persistAsDraft();
              toast.success("Opgeslagen als DRAFT.");
              router.push("/activations");
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2" /> Opslaan als concept
          </Button>
        </div>
      </div>

      <Stepper step={step} setStep={setStep} errors={stepErrors} editable={!initialOrder || initialOrder.status === "DRAFT"} />

      <div className="space-y-6">
        {step === 1 && (
          <StepCustomer
            form={form}
            setForm={setForm}
            customerOptions={customerOptions}
            subCustomers={subCustomers}
          />
        )}
        {step === 2 && (
          <StepProduct
            form={form}
            setForm={setForm}
            productOptions={productOptions}
            priceEditable={canEditPrice}
          />
        )}
        {step === 3 && (
          <StepTracker
            form={form}
            setForm={setForm}
            options={trackerStock}
          />
        )}
        {step === 4 && (
          <StepSim
            form={form}
            setForm={setForm}
            options={simStock}
            isAdmin={isAdmin}
            orderId={openOrderId}
            validateAndSubscribeSimAction={validateAndSubscribeSimAction}
          />
        )}
        {step === 5 && (
          <StepVehicle
            form={form}
            setForm={setForm}
            customerId={form.customerId}
            options={vehiclesOfCustomer}
          />
        )}
        {step === 6 && (
          <StepReview
            form={form}
            customer={selectedCustomer ?? null}
            sub={selectedSub ?? null}
            product={selectedProduct ?? null}
            tracker={selectedTracker ?? null}
            sim={selectedSim ?? null}
            vehicle={selectedVehicle ?? null}
            isReadyErrors={isReadyErrors}
            onActivate={async () => markReadyAndActivate(true)}
            busy={busy}
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button
          variant="outline"
          disabled={step <= 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
        >
          Vorige
        </Button>
        <div className="text-xs text-slate-500">
          Stap {step} van {STEP_NAMES.length}
        </div>
        {step < 6 ? (
          <Button
            onClick={() => setStep((s) => Math.min(STEP_NAMES.length, s + 1))}
          >
            Volgende <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            disabled={isReadyErrors.length > 0 || busy}
            onClick={async () => markReadyAndActivate(true)}
          >
            <Play className="h-4 w-4 mr-2" /> Activeer bevestigen
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({
  step,
  setStep,
  errors,
  editable,
}: {
  step: number;
  setStep: (n: number) => void;
  errors: Record<number, string[]>;
  editable: boolean;
}) {
  return (
    <nav aria-label="Stappen">
      <ol className="flex flex-wrap items-center gap-2">
        {STEP_NAMES.map((s, i) => {
          const n = i + 1;
          const completed = step > n;
          const active = step === n;
          const Icon = s.icon;
          const disabled = !editable;
          return (
            <li key={n} className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStep(n)}
                className={[
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : completed
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  errors[n]?.length ? "border-red-300 bg-red-50 text-red-700" : "",
                  disabled ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <span className="flex items-center justify-center">
                  {completed ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : errors[n]?.length ? (
                    <Circle className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span>
                  <span className="sr-only">Stap {n}:</span> {s.label}
                </span>
                {errors[n]?.length ? (
                  <span className="sr-only">
                    {errors[n].join(", ")}
                  </span>
                ) : null}
              </button>
              {n < STEP_NAMES.length ? (
                <Separator className="hidden w-6 sm:block" orientation="horizontal" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepCustomer({
  form,
  setForm,
  customerOptions,
  subCustomers,
}: {
  form: any;
  setForm: (v: any) => void;
  customerOptions: CustomerOption[];
  subCustomers: CustomerOption[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stap 1 — Klant</CardTitle>
        <CardDescription>
          Kies een hoofdklant en optioneel een subklant.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Hoofdklant *</Label>
          <Select
            value={form.customerId || ""}
            onValueChange={(v) =>
              setForm({ ...form, customerId: v, subCustomerId: null })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Zoek en selecteer klant..." />
            </SelectTrigger>
            <SelectContent>
              {customerOptions
                .filter((c) => !c.parentCustomerId)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex items-center gap-2">
                      <span>{c.companyName}</span>
                      <span className="text-xs text-slate-400">
                        {c.customerNumber}
                      </span>
                      <CustomerStatusBadge status={c.status as any} />
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Subklant (optioneel)</Label>
          <Select
            value={form.subCustomerId || ""}
            onValueChange={(v) =>
              setForm({ ...form, subCustomerId: v || null })
            }
            disabled={!form.customerId || !subCustomers.length}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  form.customerId
                    ? subCustomers.length
                      ? "Kies subklant"
                      : "Geen subklanten voor deze klant"
                    : "Kies eerst hoofdklant"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {subCustomers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <span>{c.companyName}</span>
                    <span className="text-xs text-slate-400">
                      {c.customerNumber}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function StepProduct({
  form,
  setForm,
  productOptions,
  priceEditable,
}: {
  form: any;
  setForm: (v: any) => void;
  productOptions: ProductOption[];
  priceEditable: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stap 2 — Product en facturatie</CardTitle>
        <CardDescription>
          Kies een actief product en startdatum. Alleen ADMIN kan prijs aanpassen.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label>Product *</Label>
          <Select
            value={form.productId || ""}
            onValueChange={(v) => {
              const p = productOptions.find((x) => x.id === v);
              setForm({
                ...form,
                productId: v,
                monthlyPrice: p
                  ? String(p.monthlyPrice)
                  : form.monthlyPrice,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Kies een product" />
            </SelectTrigger>
            <SelectContent>
              {productOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="space-y-0.5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.productCode} · {formatCurrency(String(p.monthlyPrice))}
                      /mnd
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Gewenste startdatum *</Label>
          <Input
            type="date"
            value={form.desiredStartDate || ""}
            onChange={(e) =>
              setForm({ ...form, desiredStartDate: e.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="monthlyPrice">
            Maandprijs (EUR){priceEditable ? " *" : ""}
          </Label>
          <Input
            id="monthlyPrice"
            type="number"
            step="0.01"
            min="0"
            disabled={!priceEditable}
            value={form.monthlyPrice}
            onChange={(e) =>
              setForm({ ...form, monthlyPrice: e.target.value })
            }
          />
          {!priceEditable ? (
            <p className="text-xs text-slate-400">
              Prijs is vastgesteld (alleen ADMIN kan aanpassen).
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Facturatiecyclus</Label>
          <Select
            value={form.billingCycle}
            onValueChange={(v) => setForm({ ...form, billingCycle: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MONTHLY">Maandelijks</SelectItem>
              <SelectItem value="QUARTERLY">Per kwartaal</SelectItem>
              <SelectItem value="YEARLY">Per jaar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-3 space-y-2">
          <Label>Interne opmerkingen (optioneel)</Label>
          <Textarea
            rows={3}
            value={form.internalNotes}
            onChange={(e) =>
              setForm({ ...form, internalNotes: e.target.value })
            }
            placeholder="Bijzonderheden m.b.t. deze activatie..."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PickTable<T extends { id: string }>({
  title,
  description,
  columns,
  rows,
  selectedId,
  onSelect,
}: {
  title: string;
  description: string;
  columns: ColumnDef<T>[];
  rows: T[];
  selectedId: string | null;
  onSelect: (row: T) => void;
}) {
  const rowClick: ColumnDef<T> = {
    id: "select",
    header: "",
    cell: ({ row }) => {
      const checked = row.original.id === selectedId;
      return (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant={checked ? "default" : "outline"}
            onClick={() => onSelect(row.original)}
          >
            {checked ? (
              <>
                <CheckSquare className="h-4 w-4 mr-1" /> Gekozen
              </>
            ) : (
              <>Kies</>
            )}
          </Button>
        </div>
      );
    },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={[...columns, rowClick]}
          searchPlaceholder="Zoeken..."
        />
      </CardContent>
    </Card>
  );
}

function StepTracker({
  form,
  setForm,
  options,
}: {
  form: any;
  setForm: (v: any) => void;
  options: TrackerOption[];
}) {
  const cols: ColumnDef<TrackerOption>[] = [
    {
      accessorKey: "serialNumber",
      header: "Serienummer",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.serialNumber}</span>
      ),
    },
    {
      accessorKey: "imei",
      header: "IMEI",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatImei(row.original.imei)}
        </span>
      ),
    },
    {
      header: "Merk / Model",
      cell: ({ row }) => (
        <div>
          <div>{row.original.brand ?? "—"}</div>
          <div className="text-xs text-slate-500">{row.original.model ?? ""}</div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <TrackerStatusBadge status={row.original.status as any} />
      ),
    },
  ];
  return (
    <PickTable<TrackerOption>
      title="Stap 3 — Tracker"
      description="Kies een tracker die IN_STOCK of RESERVED is. Al deze statussen komen in aanmerking voor activatie."
      columns={cols}
      rows={options}
      selectedId={form.trackerId}
      onSelect={(r) => setForm({ ...form, trackerId: r.id })}
    />
  );
}

const TARGET_PRODUCT_NAME_FOR_UI = "Seguilo B.V. ROPD LR 0.40 OU per MB 0.0029 EUR SMS";

type ActivateSimDialogProps = {
  sim: SimOption;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  isPending: boolean;
  resultMessage?: string | null;
  resultOk?: boolean | null;
};

function ActivateSimDialog({
  sim,
  open,
  onOpenChange,
  onConfirm,
  isPending,
  resultMessage,
  resultOk,
}: ActivateSimDialogProps) {
  const submittedRef = useRef(false);
  const emergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPendingClient, setIsPendingClient] = useState(false);

  const combinedPending = isPending || isPendingClient;

  useEffect(() => {
    if (open === false && submittedRef.current && !combinedPending) {
      submittedRef.current = false;
      setIsPendingClient(false);
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    }
  }, [open, combinedPending]);

  useEffect(() => {
    return () => {
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    };
  }, []);

  async function handleConfirm() {
    if (submittedRef.current || combinedPending) return;
    submittedRef.current = true;
    setIsPendingClient(true);
    if (emergencyTimerRef.current) clearTimeout(emergencyTimerRef.current);
    emergencyTimerRef.current = setTimeout(() => {
      console.warn("[wizard-step4] ⏹️ Activeren noodstop na 30s timeout.");
      submittedRef.current = false;
      setIsPendingClient(false);
      emergencyTimerRef.current = null;
    }, 30_000);
    try {
      await onConfirm();
    } finally {
      setTimeout(() => {
        submittedRef.current = false;
        setIsPendingClient(false);
        if (emergencyTimerRef.current) {
          clearTimeout(emergencyTimerRef.current);
          emergencyTimerRef.current = null;
        }
      }, 0);
    }
  }

  const simLabel = sim.msisdn ? formatIccid(sim.iccid) + " (" + sim.msisdn + ")" : formatIccid(sim.iccid);
  const showResult = resultMessage !== undefined && resultMessage !== null && resultMessage !== "" && !combinedPending;

  return (
    <Dialog open={open} onOpenChange={combinedPending ? () => {} : onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={combinedPending}
          aria-busy={combinedPending}
          aria-disabled={combinedPending}
          className="gap-1"
        >
          {combinedPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Bezig met activeren…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Activeren
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simkaart activeren?</DialogTitle>
          <DialogDescription asChild>
            <div aria-live="polite" className="space-y-3 text-sm">
              <div>
                Je staat op het punt om deze SIM-kaart te activeren:
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <div>
                  <span className="font-semibold">SIM:</span> {simLabel}
                </div>
                <div>
                  <span className="font-semibold">ICCID:</span>{" "}
                  <span className="font-mono text-xs">{sim.iccid}</span>
                </div>
                <div>
                  <span className="font-semibold">Product:</span>{" "}
                  <span className="text-slate-900">{TARGET_PRODUCT_NAME_FOR_UI}</span>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Na activering wordt de SIM-kaart direct gebonden aan het bovenstaande product en
                account. Deze actie kan niet ongedaan worden gemaakt via een enkele klik;
                gebruik &quot;Deblokkeren&quot; voor tijdelijk geblokkeerde SIM&apos;s.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {showResult && (
          <div
            role="alert"
            aria-live="polite"
            className={
              resultOk
                ? "rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-start gap-2"
                : "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2"
            }
          >
            {resultOk ? (
              <CheckCircle className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4 mt-0.5 text-red-600 shrink-0" aria-hidden="true" />
            )}
            <div className="space-y-0.5">
              <p className="font-medium">
                {resultOk ? "Voltooid" : "Fout"}
              </p>
              <p className={resultOk ? "text-emerald-800" : "text-red-700"}>
                {resultMessage}
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-end pt-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              disabled={combinedPending}
              onClick={() => {
                if (!combinedPending) submittedRef.current = false;
              }}
            >
              Annuleren
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="default"
            onClick={handleConfirm}
            disabled={combinedPending || (showResult && resultOk === true)}
            aria-busy={combinedPending}
            aria-disabled={combinedPending || (showResult && resultOk === true)}
          >
            {combinedPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Bezig met activeren…
              </>
            ) : showResult && resultOk === true ? (
              <>
                <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                Sluiten
              </>
            ) : (
              <>Activeren</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepSim({
  form,
  setForm,
  options,
  isAdmin,
  orderId,
  validateAndSubscribeSimAction,
}: {
  form: any;
  setForm: (v: any) => void;
  options: SimOption[];
  isAdmin: boolean;
  orderId: string | null;
  validateAndSubscribeSimAction: (simId: string, orderId?: string) => Promise<any>;
}) {
  const [activateOpen, setActivateOpen] = useState(false);
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateResult, setActivateResult] = useState<{
    message: string | null;
    ok: boolean | null;
  }>({ message: null, ok: null });

  const selectedSim = useMemo(
    () => options.find((s) => s.id === form.simId) ?? null,
    [options, form.simId]
  );

  const canActivateThisSim = useMemo(() => {
    if (!isAdmin) return false;
    if (!selectedSim) return false;
    const s = String(selectedSim.status ?? "").toUpperCase();
    return s === "IN_STOCK" || s === "RESERVED";
  }, [isAdmin, selectedSim]);

  async function handleActivateConfirm() {
    if (!selectedSim) return;
    setActivateBusy(true);
    setActivateResult({ message: null, ok: null });
    try {
      const res = await validateAndSubscribeSimAction(selectedSim.id, orderId ?? undefined);
      if (res && res.ok) {
        const msg =
          res.pendingConfirmation
            ? res.message ?? "Het activatieverzoek is verwerkt. De activatie wordt nog gecontroleerd."
            : res.message ?? "Simkaart geactiveerd.";
        setActivateResult({ message: msg, ok: true });
        if (!res.pendingConfirmation) {
          toast.success(res.message ?? "Simkaart geactiveerd.");
        } else {
          toast.message(res.message ?? "Activatie in behandeling.", {
            description: "De actuele SIM-status wordt op de achtergrond bijgewerkt.",
          });
        }
        if (res.confirmedStatus === "ACTIVE") {
          try {
            const fresh = [...options].map((o) =>
              o.id === selectedSim.id ? { ...o, status: "ACTIVE" as any } : o
            );
            setForm({ ...form, simId: selectedSim.id });
            void fresh;
          } catch {}
        }
      } else {
        const msg =
          res?.message ?? res?.error?.detail ?? "Activeren mislukte. Probeer het opnieuw.";
        setActivateResult({ message: msg, ok: false });
        toast.error(msg);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Onverwachte fout tijdens activeren.");
      setActivateResult({ message: msg, ok: false });
      toast.error(msg);
    } finally {
      setActivateBusy(false);
    }
  }

  useEffect(() => {
    if (activateOpen === false) {
      setTimeout(() => setActivateResult({ message: null, ok: null }), 200);
    }
  }, [activateOpen]);
  const cols: ColumnDef<SimOption>[] = [
    {
      accessorKey: "iccid",
      header: "ICCID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatIccid(row.original.iccid)}
        </span>
      ),
    },
    {
      accessorKey: "imsi",
      header: "IMSI",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.imsi}</span>
      ),
    },
    {
      accessorKey: "msisdn",
      header: "Nummer",
      cell: ({ row }) => (
        <span>{row.original.msisdn ?? <span className="text-slate-400">—</span>}</span>
      ),
    },
    {
      accessorKey: "provider",
      header: "Provider",
      cell: ({ row }) => row.original.provider ?? "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <SimStatusBadge status={row.original.status as any} />
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <PickTable<SimOption>
        title="Stap 4 — SIM-kaart"
        description={
          isAdmin
            ? "Kies een SIM (IN_STOCK of RESERVED). Indien nodig kun je de gekozen SIM direct activeren via de Simhuis API."
            : "Kies een SIM (IN_STOCK of RESERVED)."
        }
        columns={cols}
        rows={options}
        selectedId={form.simId}
        onSelect={(r) => setForm({ ...form, simId: r.id })}
      />
      {selectedSim && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex flex-row items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-600" aria-hidden="true" />
              Geselecteerde SIM-kaart
            </CardTitle>
            <CardDescription className="text-xs">
              Activeer de SIM direct bij de provider voordat je de activatie-orde voltooit.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="font-medium">ICCID:</span>{" "}
                <span className="font-mono text-xs">{formatIccid(selectedSim.iccid)}</span>
              </div>
              <div>
                <span className="font-medium">Status:</span>{" "}
                <SimStatusBadge status={selectedSim.status as any} />
              </div>
              {selectedSim.msisdn && (
                <div>
                  <span className="font-medium">Nummer:</span> {selectedSim.msisdn}
                </div>
              )}
              <div>
                <span className="font-medium">Provider:</span> {selectedSim.provider ?? "—"}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row sm:justify-end gap-2">
            {canActivateThisSim ? (
              selectedSim ? (
                <ActivateSimDialog
                  sim={selectedSim}
                  open={activateOpen}
                  onOpenChange={(o) => {
                    if (!activateBusy) {
                      setActivateOpen(o);
                    }
                  }}
                  onConfirm={handleActivateConfirm}
                  isPending={activateBusy}
                  resultMessage={activateResult.message}
                  resultOk={activateResult.ok}
                />
              ) : null
            ) : (
              <div className="text-xs text-slate-500 italic" aria-live="polite">
                {!isAdmin
                  ? "Alleen beheerders kunnen SIM-kaarten activeren."
                  : !selectedSim
                    ? "Kies eerst een SIM-kaart uit de tabel."
                    : "Deze SIM kan niet direct worden geactiveerd (verkeerde status). Gebruik Deblokkeren voor reeds geactiveerde, geblokkeerde SIM's."}
              </div>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function StepVehicle({
  form,
  setForm,
  customerId,
  options,
}: {
  form: any;
  setForm: (v: any) => void;
  customerId: string;
  options: VehicleOption[];
}) {
  if (!customerId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stap 5 — Voertuig (optioneel)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            Kies eerst een klant in stap 1 om beschikbare voertuigen te zien.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cols: ColumnDef<VehicleOption>[] = [
    {
      accessorKey: "licensePlate",
      header: "Kenteken",
      cell: ({ row }) => {
        const v = row.original.licensePlate;
        return v ? (
          <span className="font-mono">{formatLicensePlate(v)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      header: "Merk / Model",
      cell: ({ row }) => (
        <div>
          <div>{row.original.brand ?? "—"}</div>
          <div className="text-xs text-slate-500">
            {row.original.model ?? ""}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "vin",
      header: "VIN",
      cell: ({ row }) =>
        row.original.vin ? (
          <span className="font-mono text-xs">{row.original.vin}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      header: "Omschrijving",
      accessorKey: "description",
      cell: ({ row }) =>
        row.original.description ?? <span className="text-slate-400">—</span>,
    },
  ];

  return (
    <PickTable<VehicleOption>
      title="Stap 5 — Voertuig (optioneel)"
      description="Koppel optioneel een voertuig van de gekozen klant. Je kunt ook later toewijzen."
      columns={cols}
      rows={options}
      selectedId={form.vehicleId}
      onSelect={(r) =>
        setForm({
          ...form,
          vehicleId: r.id === form.vehicleId ? null : r.id,
        })
      }
    />
  );
}

function StepReview({
  form,
  customer,
  sub,
  product,
  tracker,
  sim,
  vehicle,
  isReadyErrors,
  onActivate,
  busy,
}: {
  form: any;
  customer: CustomerOption | null;
  sub: CustomerOption | null;
  product: ProductOption | null;
  tracker: TrackerOption | null;
  sim: SimOption | null;
  vehicle: VehicleOption | null;
  isReadyErrors: string[];
  onActivate: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="space-y-6">
      {isReadyErrors.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
          <div className="font-semibold">Nog niet alle velden zijn ingevuld:</div>
          <ul className="list-disc pl-5">
            {isReadyErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <InfoCard
          title="Klant"
          rows={[
            ["Hoofdklant", customer ? (
              <Link href={`/customers/${customer.id}`} className="underline-offset-4 hover:underline">{customer.companyName} ({customer.customerNumber})</Link>
            ) : null],
            ["Sub-klant", sub ? (
              <Link href={`/customers/${sub.id}`} className="underline-offset-4 hover:underline">{sub.companyName} ({sub.customerNumber})</Link>
            ) : "—"],
          ]}
        />
        <InfoCard
          title="Product & facturatie"
          rows={[
            ["Product", product ? `${product.name} (${product.productCode})` : "—"],
            ["Omschrijving", product?.description ?? "—"],
            [
              "Gewenste start",
              form.desiredStartDate
                ? formatDate(new Date(form.desiredStartDate))
                : "—",
            ],
            [
              "Maandprijs",
              form.monthlyPrice
                ? formatCurrency(String(form.monthlyPrice))
                : "—",
            ],
            ["Cyclus", form.billingCycle ?? "MONTHLY"],
          ]}
        />
        <InfoCard
          title="Assets"
          rows={[
            [
              "Tracker",
              tracker ? (
                <Link href={`/trackers/${tracker.id}`} className="flex flex-col">
                  <span>{tracker.serialNumber}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {formatImei(tracker.imei)}
                  </span>
                </Link>
              ) : null,
            ],
            [
              "SIM",
              sim ? (
                <Link href={`/sims/${sim.id}`} className="flex flex-col">
                  <span className="font-mono text-xs">{formatIccid(sim.iccid)}</span>
                  <span className="text-xs text-slate-500">{sim.msisdn ?? sim.provider}</span>
                </Link>
              ) : null,
            ],
            [
              "Voertuig",
              vehicle ? (
                <Link href={`/vehicles/${vehicle.id}`}>
                  {vehicle.licensePlate
                    ? formatLicensePlate(vehicle.licensePlate)
                    : `${vehicle.brand ?? ""} ${vehicle.model ?? ""}` || "—"}
                </Link>
              ) : null,
            ],
          ]}
        />
      </div>

      {form.internalNotes ? (
        <InfoCard
          title="Interne opmerkingen"
          rows={[["Notities", <p key="notes" className="whitespace-pre-wrap text-sm">{form.internalNotes}</p>]]}
        />
      ) : null}

      <Card className="border-slate-300">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Bevestig activatie</CardTitle>
            <CardDescription>
              Bij klikken wordt eerst het order READY gemaakt, daarna direct de
              6-staps transactionele activatie uitgevoerd.
            </CardDescription>
          </div>
          <Button disabled={isReadyErrors.length > 0 || busy} onClick={onActivate}>
            <Play className="h-4 w-4 mr-2" /> Activeer nu
          </Button>
        </CardHeader>
      </Card>
    </div>
  );
}

function InfoCard({
  title,
  rows,
}: {
  title: string;
  rows: (readonly [string, React.ReactNode])[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 border-b last:border-0 pb-2 last:pb-0">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {k}
            </div>
            <div>{v ?? <span className="text-slate-400">—</span>}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
