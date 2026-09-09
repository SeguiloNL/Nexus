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
import type { VehicleActionState } from "../actions";

type ParentOption = { id: string; label: string };

type VehicleFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    customerId: string;
    licensePlate: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
    description: string | null;
    notes: string | null;
  }>;
  customerOptions: ParentOption[];
  action: (
    prev: VehicleActionState,
    formData: FormData
  ) => Promise<VehicleActionState>;
  vehicleId?: string;
};

export function VehicleForm({
  mode,
  initial,
  customerOptions,
  action,
  vehicleId,
}: VehicleFormProps) {
  const [state, formAction] = useFormState<VehicleActionState>(action as any, {
    errors: undefined,
    message: null,
  });

  useEffect(() => {
    if (state?.message && !state.errors) toast.error(state.message);
  }, [state?.message, state?.errors]);

  const customerDisabled = mode === "edit";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/vehicles">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuw voertuig" : "Voertuig bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Voeg een voertuig toe aan een klant."
              : "Voertuig bijwerken."}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {vehicleId ? (
          <input type="hidden" name="vehicleId" value={vehicleId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>Voertuig identificatie.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {mode === "create" ? (
                  <div className="space-y-2">
                    <Label htmlFor="customerId">
                      Klant <span className="text-red-600">*</span>
                    </Label>
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
                ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="licensePlate">Kenteken</Label>
                  <Input
                    id="licensePlate"
                    name="licensePlate"
                    defaultValue={initial?.licensePlate ?? ""}
                    placeholder="bijv. AB-12-CD"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vin">VIN (chassisnummer)</Label>
                  <Input
                    id="vin"
                    name="vin"
                    defaultValue={initial?.vin ?? ""}
                    placeholder="17 karakters"
                  />
                  {state?.errors?.vin ? (
                    <p className="text-xs text-red-600">
                      {state.errors.vin.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="brand">Merk</Label>
                  <Input
                    id="brand"
                    name="brand"
                    defaultValue={initial?.brand ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    name="model"
                    defaultValue={initial?.model ?? ""}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Beschrijving</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={initial?.description ?? ""}
                  placeholder="Uitvoering, kleuren, opties…"
                />
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
                  rows={12}
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
            <Link href="/vehicles">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
