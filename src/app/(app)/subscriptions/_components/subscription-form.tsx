"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { useEffect } from "react";
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
import type { SubscriptionActionState } from "../actions";
import { BillingCycle, SubscriptionStatus } from "@/types/enums";
import { formatDateISO } from "@/lib/utils";

type Option = { id: string; label: string };

type SubscriptionFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    subscriptionNumber: string;
    customerId: string;
    productId: string;
    startDate: Date | string;
    endDate: Date | string | null;
    status: SubscriptionStatus;
    monthlyPrice: number;
    billingCycle: BillingCycle;
    notes: string | null;
  }>;
  customerOptions: Option[];
  productOptions: Option[];
  action: (
    prev: SubscriptionActionState,
    formData: FormData
  ) => Promise<SubscriptionActionState>;
  subscriptionId?: string;
};

export function SubscriptionForm({
  mode,
  initial,
  customerOptions,
  productOptions,
  action,
  subscriptionId,
}: SubscriptionFormProps) {
  const [state, formAction] = useFormState<SubscriptionActionState>(action as any, {
    errors: undefined,
    message: null,
  });

  useEffect(() => {
    if (state?.message && !state.errors && !state.subscriptionId) {
      toast.error(state.message);
    }
  }, [state?.message, state?.errors, state?.subscriptionId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/subscriptions">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuw abonnement" : "Abonnement bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Maak een nieuw abonnement aan (concept)."
              : `Abonnement ${initial?.subscriptionNumber ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {subscriptionId ? (
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>
                Basisinformatie van het abonnement.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-1">
                <Label htmlFor="customerId">Klant *</Label>
                <Select
                  name="customerId"
                  defaultValue={initial?.customerId}
                  disabled={mode === "edit"}
                >
                  <SelectTrigger id="customerId" className="mt-1.5">
                    <SelectValue placeholder="Selecteer klant" />
                  </SelectTrigger>
                  <SelectContent>
                    {customerOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state?.errors?.customerId ? (
                  <p className="mt-1 text-sm text-red-600">
                    {state.errors.customerId[0]}
                  </p>
                ) : null}
              </div>

              <div className="md:col-span-1">
                <Label htmlFor="productId">Product *</Label>
                <Select name="productId" defaultValue={initial?.productId}>
                  <SelectTrigger id="productId" className="mt-1.5">
                    <SelectValue placeholder="Selecteer product" />
                  </SelectTrigger>
                  <SelectContent>
                    {productOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state?.errors?.productId ? (
                  <p className="mt-1 text-sm text-red-600">
                    {state.errors.productId[0]}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="startDate">Startdatum *</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={formatDateISO(initial?.startDate)}
                  className="mt-1.5"
                />
                {state?.errors?.startDate ? (
                  <p className="mt-1 text-sm text-red-600">
                    {state.errors.startDate[0]}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="endDate">Einddatum</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  defaultValue={formatDateISO(initial?.endDate ?? undefined)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="monthlyPrice">Maandprijs (€) *</Label>
                <Input
                  id="monthlyPrice"
                  name="monthlyPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initial?.monthlyPrice}
                  className="mt-1.5"
                />
                {state?.errors?.monthlyPrice ? (
                  <p className="mt-1 text-sm text-red-600">
                    {state.errors.monthlyPrice[0]}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="billingCycle">Facturatiecyclus</Label>
                <Select
                  name="billingCycle"
                  defaultValue={
                    (initial?.billingCycle as unknown as string) ??
                    BillingCycle.MONTHLY
                  }
                >
                  <SelectTrigger id="billingCycle" className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BillingCycle.MONTHLY}>
                      Per maand
                    </SelectItem>
                    <SelectItem value={BillingCycle.QUARTERLY}>
                      Per kwartaal
                    </SelectItem>
                    <SelectItem value={BillingCycle.YEARLY}>Per jaar</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "create" ? (
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select
                    name="status"
                    defaultValue={
                      (initial?.status as unknown as string) ??
                      SubscriptionStatus.DRAFT
                    }
                  >
                    <SelectTrigger id="status" className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SubscriptionStatus.DRAFT}>
                        Concept
                      </SelectItem>
                      <SelectItem value={SubscriptionStatus.PENDING_ACTIVATION}>
                        Te activeren
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="md:col-span-2">
                <Label htmlFor="notes">Opmerkingen</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  defaultValue={initial?.notes ?? undefined}
                  placeholder="Optionele opmerkingen"
                  className="mt-1.5"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acties</CardTitle>
              <CardDescription>
                Sla de wijzigingen op.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button type="submit" className="w-full">
                <Save className="mr-2 h-4 w-4" /> Opslaan
              </Button>
              {state?.message && !state.errors ? (
                <p className="text-sm text-amber-600">{state.message}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
