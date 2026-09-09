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
import type { SubActionState } from "../actions";

type Opt = { id: string; label: string };

interface Props {
  mode: "create" | "edit";
  initial?: any;
  customerOptions: Opt[];
  productOptions: (Opt & { defaultMonthlyPrice: string; billingCycle: any })[];
  action: (prev: SubActionState, f: FormData) => Promise<SubActionState>;
  subscriptionId?: string;
  onCancel?: string;
}

export function SubscriptionForm({
  mode,
  initial,
  customerOptions,
  productOptions,
  action,
  subscriptionId,
  onCancel,
}: Props) {
  const [state, formAction] = useFormState(action as any, { message: null } as SubActionState);

  useEffect(() => {
    if (state?.message && !state.errors) toast.error(state.message);
  }, [state?.message, state?.errors]);

  const cancelHref = onCancel ?? "/subscriptions";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={cancelHref}>
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuw abonnement" : "Abonnement bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            Alleen ACTIVE abonnementen worden gefactureerd.
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
              <CardTitle>Klant, product &amp; facturatie</CardTitle>
              <CardDescription>
                Koppel abonnement aan een klant en product.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customerId">Klant *</Label>
                  <Select
                    name="customerId"
                    defaultValue={initial?.customerId}
                  >
                    <SelectTrigger id="customerId">
                      <SelectValue placeholder="Kies een klant" />
                    </SelectTrigger>
                    <SelectContent>
                      {customerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {state?.errors?.customerId ? (
                    <p className="text-xs text-red-600">
                      {state.errors.customerId.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="productId">Product *</Label>
                  <Select
                    name="productId"
                    defaultValue={initial?.productId}
                  >
                    <SelectTrigger id="productId">
                      <SelectValue placeholder="Kies product" />
                    </SelectTrigger>
                    <SelectContent>
                      {productOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {state?.errors?.productId ? (
                    <p className="text-xs text-red-600">
                      {state.errors.productId.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Startdatum *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    name="startDate"
                    defaultValue={
                      initial?.startDate
                        ? new Date(initial.startDate)
                            .toISOString()
                            .substring(0, 10)
                        : new Date().toISOString().substring(0, 10)
                    }
                  />
                  {state?.errors?.startDate ? (
                    <p className="text-xs text-red-600">
                      {state.errors.startDate.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endDate">Einddatum (optioneel)</Label>
                  <Input
                    id="endDate"
                    type="date"
                    name="endDate"
                    defaultValue={
                      initial?.endDate
                        ? new Date(initial.endDate).toISOString().slice(0, 10)
                        : ""
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingCycle">Facturatiecyclus</Label>
                  <Select
                    name="billingCycle"
                    defaultValue={initial?.billingCycle ?? "MONTHLY"}
                  >
                    <SelectTrigger id="billingCycle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Maandelijks</SelectItem>
                      <SelectItem value="QUARTERLY">Per kwartaal</SelectItem>
                      <SelectItem value="YEARLY">Per jaar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="monthlyPrice">
                    Maandprijs (EUR) *
                  </Label>
                  <Input
                    id="monthlyPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    name="monthlyPrice"
                    defaultValue={
                      initial?.monthlyPrice != null
                        ? String(initial.monthlyPrice)
                        : "0"
                    }
                  />
                  {state?.errors?.monthlyPrice ? (
                    <p className="text-xs text-red-600">
                      {state.errors.monthlyPrice.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Notities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  id="notes"
                  name="notes"
                  rows={14}
                  defaultValue={initial?.notes ?? ""}
                />
              </div>
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
            <Link href={cancelHref}>Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
