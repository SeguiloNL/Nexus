"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataUnit, BillingCycle } from "@/types/enums";
import type { DataPlanActionState } from "../actions";

type DataPlanFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    name: string;
    description: string | null;
    dataAmountBytes: bigint | number | null;
    dataAmountDisplayUnit: DataUnit | string | null;
    validityDays: number | null;
    validityBillingCycle: BillingCycle | string | null;
    monthlyPrice: number | null;
    currency: string | null;
    btwPercentage: number | null;
    provider: string | null;
    providerPlanRef: string | null;
    providerOfferRef: string | null;
    isActive: boolean;
    simOnlyAvailable: boolean;
  }>;
  action: (
    prev: DataPlanActionState,
    formData: FormData
  ) => Promise<DataPlanActionState>;
  dataPlanId?: string;
};

function bytesToDisplayUnitAmount(bytes: bigint | number | null | undefined, unit: DataUnit | string | null | undefined): string {
  if (!bytes || !unit) return "";
  const b = typeof bytes === "bigint" ? bytes : BigInt(bytes);
  switch (unit) {
    case DataUnit.MB:
      return String(Math.round(Number(b) / 1024 ** 2));
    case DataUnit.GB:
      return String(Math.round(Number(b) / 1024 ** 3));
    case DataUnit.TB:
      return String(Math.round(Number(b) / 1024 ** 4));
    default:
      return "";
  }
}

export function DataPlanForm({
  mode,
  initial,
  action,
  dataPlanId,
}: DataPlanFormProps) {
  const [state, formAction] = useFormState<DataPlanActionState>(action as any, {
    errors: undefined,
    message: null,
  });

  useEffect(() => {
    if (state?.message && !state.errors) toast.error(state.message);
  }, [state?.message, state?.errors]);

  const startUnit = (initial?.dataAmountDisplayUnit as DataUnit) ?? DataUnit.GB;
  const startMode: "days" | "cycle" | "unlimited" = initial?.validityDays != null
    ? "days"
    : initial?.validityBillingCycle
      ? "cycle"
      : "unlimited";
  const [validityMode, setValidityMode] = useState<"days" | "cycle" | "unlimited">(startMode);
  const [dataUnit, setDataUnit] = useState<DataUnit | "__none__">(startUnit || "__none__");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/data-plans">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuw dataplan" : "Dataplan bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Definieer een nieuw dataplan voor SIM-kaarten en abonnementen."
              : `Dataplan ${initial?.name ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {dataPlanId ? (
          <input type="hidden" name="dataPlanId" value={dataPlanId} />
        ) : null}
        <input type="hidden" name="validityMode" value={validityMode} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>Naam, omschrijving en bundel.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Naam <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  defaultValue={initial?.name ?? ""}
                />
                {state?.errors?.name ? (
                  <p className="text-xs text-red-600">
                    {state.errors.name.join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Omschrijving</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={4}
                  defaultValue={initial?.description ?? ""}
                />
                {state?.errors?.description ? (
                  <p className="text-xs text-red-600">
                    {state.errors.description.join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                <div>
                  <div className="font-medium">Databundel</div>
                  <p className="text-xs text-slate-500">
                    Hoeveelheid data en eenheid. Kies Onbeperkt om zonder datalimiet te tonen.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="dataAmount">Hoeveelheid</Label>
                    <Input
                      id="dataAmount"
                      name="dataAmount"
                      type="number"
                      min="0"
                      disabled={dataUnit === DataUnit.UNLIMITED || dataUnit === "__none__"}
                      defaultValue={bytesToDisplayUnitAmount(
                        initial?.dataAmountBytes ?? null,
                        initial?.dataAmountDisplayUnit ?? null
                      )}
                    />
                    {state?.errors?.dataAmountBytes ? (
                      <p className="text-xs text-red-600">
                        {state.errors.dataAmountBytes.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2 min-w-[180px]">
                    <Label>Eenheid</Label>
                    <Select
                      value={dataUnit}
                      onValueChange={(v) => setDataUnit(v as any)}
                      name="dataUnit"
                      defaultValue={dataUnit}
                    >
                      <SelectTrigger id="dataUnit">
                        <SelectValue placeholder="Kies eenheid" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Geen bundel —</SelectItem>
                        <SelectItem value={DataUnit.MB}>MB (Megabyte)</SelectItem>
                        <SelectItem value={DataUnit.GB}>GB (Gigabyte)</SelectItem>
                        <SelectItem value={DataUnit.TB}>TB (Terabyte)</SelectItem>
                        <SelectItem value={DataUnit.UNLIMITED}>Onbeperkt</SelectItem>
                      </SelectContent>
                    </Select>
                    {state?.errors?.dataAmountDisplayUnit ? (
                      <p className="text-xs text-red-600">
                        {state.errors.dataAmountDisplayUnit.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-200 p-4">
                <div>
                  <div className="font-medium">Geldigheid</div>
                  <p className="text-xs text-slate-500">
                    Per periode (facturatiecyclus), een vast aantal dagen, of onbeperkt.
                  </p>
                </div>
                <Tabs value={validityMode} onValueChange={(v) => setValidityMode(v as any)}>
                  <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-flex">
                    <TabsTrigger value="unlimited">Onbeperkt</TabsTrigger>
                    <TabsTrigger value="cycle">Per factuurcyclus</TabsTrigger>
                    <TabsTrigger value="days">Aantal dagen</TabsTrigger>
                  </TabsList>
                  <TabsContent value="unlimited" className="mt-3 pt-1">
                    <input type="hidden" name="validityDays" value="" />
                    <input type="hidden" name="validityBillingCycle" value="" />
                    <div className="text-sm text-slate-500">
                      Plan is doorlopend geldig totdat het handmatig gewijzigd of opgezegd wordt.
                    </div>
                  </TabsContent>
                  <TabsContent value="cycle" className="mt-3 space-y-2">
                    <Label htmlFor="validityBillingCycle">Facturatiecyclus</Label>
                    <Select
                      defaultValue={(initial?.validityBillingCycle as string) ?? BillingCycle.MONTHLY}
                      name="validityBillingCycle"
                    >
                      <SelectTrigger id="validityBillingCycle">
                        <SelectValue placeholder="Kies cyclus" />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          BillingCycle.WEEKLY,
                          BillingCycle.BIWEEKLY,
                          BillingCycle.MONTHLY,
                          BillingCycle.QUARTERLY,
                          BillingCycle.BIANNUAL,
                          BillingCycle.ANNUAL,
                        ].map((bc) => (
                          <SelectItem key={bc} value={bc}>
                            {bc.charAt(0) + bc.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TabsContent>
                  <TabsContent value="days" className="mt-3 space-y-2">
                    <Label htmlFor="validityDays">Aantal dagen</Label>
                    <Input
                      id="validityDays"
                      name="validityDays"
                      type="number"
                      min="1"
                      defaultValue={initial?.validityDays ?? ""}
                    />
                    {state?.errors?.validityDays ? (
                      <p className="text-xs text-red-600">
                        {state.errors.validityDays.join(", ")}
                      </p>
                    ) : null}
                  </TabsContent>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Prijs, provider & zichtbaarheid</CardTitle>
              <CardDescription>
                Maandelijkse kosten, provider-koppeling en zichtbaarheid in de activatiewizard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="monthlyPrice">Prijs / mnd</Label>
                  <Input
                    id="monthlyPrice"
                    name="monthlyPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={
                      initial?.monthlyPrice != null && initial?.monthlyPrice !== undefined
                        ? String(initial.monthlyPrice)
                        : ""
                    }
                  />
                  {state?.errors?.monthlyPrice ? (
                    <p className="text-xs text-red-600">
                      {state.errors.monthlyPrice.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Valuta</Label>
                  <Input
                    id="currency"
                    name="currency"
                    maxLength={3}
                    defaultValue={initial?.currency ?? "EUR"}
                  />
                  {state?.errors?.currency ? (
                    <p className="text-xs text-red-600">
                      {state.errors.currency.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="btwPercentage">BTW %</Label>
                <Input
                  id="btwPercentage"
                  name="btwPercentage"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={
                    initial?.btwPercentage !== undefined && initial?.btwPercentage !== null
                      ? String(initial.btwPercentage)
                      : "21"
                  }
                />
                {state?.errors?.btwPercentage ? (
                  <p className="text-xs text-red-600">
                    {state.errors.btwPercentage.join(", ")}
                  </p>
                ) : null}
              </div>

              <SeparatorThin />

              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Input
                  id="provider"
                  name="provider"
                  placeholder="bv. Simhuis, KPN, Vodafone"
                  defaultValue={initial?.provider ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="providerPlanRef">Provider plan ID / plan-ref</Label>
                <Input
                  id="providerPlanRef"
                  name="providerPlanRef"
                  placeholder="Interne plan-referentie bij provider"
                  defaultValue={initial?.providerPlanRef ?? ""}
                />
                <p className="text-xs text-slate-500">
                  Gebruikt bij SIM-activatie (wordt als planId doorgegeven).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="providerOfferRef">Provider offer ID / offer-ref</Label>
                <Input
                  id="providerOfferRef"
                  name="providerOfferRef"
                  placeholder="Interne offer-referentie bij provider"
                  defaultValue={initial?.providerOfferRef ?? ""}
                />
                <p className="text-xs text-slate-500">
                  Gebruikt bij SIM-activatie (wordt als offerId doorgegeven).
                </p>
              </div>

              <SeparatorThin />

              <label className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={initial?.isActive ?? true}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium">Actief</div>
                  <div className="text-slate-500 text-xs">
                    Onzichtbaar in de wizard wanneer uitgevinkt. Gebruik deactiveren in plaats van verwijderen.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  name="simOnlyAvailable"
                  defaultChecked={initial?.simOnlyAvailable ?? true}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium">Beschikbaar voor Sim-only</div>
                  <div className="text-slate-500 text-xs">
                    Plan mag gekozen worden bij Sim-only activaties. Kan aan blijven voor bestaande tracker-plannen
                    (die worden niet in de Sim-only wizard getoond als dit uitgevinkt is).
                  </div>
                </div>
              </label>
            </CardContent>
          </Card>
        </div>

        {state?.message ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.message}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
          <Button asChild variant="outline" type="button">
            <Link href="/data-plans">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}

function SeparatorThin() {
  return <div className="h-px w-full bg-slate-200 my-1" />;
}
