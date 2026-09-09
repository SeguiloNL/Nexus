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
import type { TrackerActionState } from "../actions";
import type { TrackerStatus } from "@prisma/client";

type TrackerFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    serialNumber: string;
    imei: string;
    brand: string;
    model: string;
    hardwareType: string | null;
    firmwareVersion: string | null;
    purchaseDate: Date | string | null;
    supplier: string | null;
    status: TrackerStatus;
    notes: string | null;
  }>;
  action: (prev: TrackerActionState, formData: FormData) => Promise<TrackerActionState>;
  trackerId?: string;
};

export function TrackerForm({
  mode,
  initial,
  action,
  trackerId,
}: TrackerFormProps) {
  const [state, formAction] = useFormState<TrackerActionState>(
    action as any,
    { errors: undefined, message: null }
  );

  useEffect(() => {
    if (state?.message && !state.errors) {
      toast.error(state.message);
    }
  }, [state?.message, state?.errors]);

  const identifiersDisabled = mode === "edit";
  const purchaseDateStr =
    initial?.purchaseDate instanceof Date
      ? initial.purchaseDate.toISOString().slice(0, 10)
      : initial?.purchaseDate
        ? String(initial.purchaseDate).slice(0, 10)
        : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/trackers">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuwe tracker" : "Tracker bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Voeg een nieuwe GPS-tracker toe aan de voorraad."
              : `Tracker ${initial?.serialNumber ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {trackerId ? (
          <input type="hidden" name="trackerId" value={trackerId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>
                Identificatie en kenmerken van de tracker.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="serialNumber">Serienummer <span className="text-red-600">*</span></Label>
                  <Input
                    id="serialNumber"
                    name="serialNumber"
                    required
                    disabled={identifiersDisabled}
                    defaultValue={initial?.serialNumber ?? ""}
                  />
                  {state?.errors?.serialNumber ? (
                    <p className="text-xs text-red-600">
                      {state.errors.serialNumber.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imei">IMEI <span className="text-red-600">*</span></Label>
                  <Input
                    id="imei"
                    name="imei"
                    required
                    disabled={identifiersDisabled}
                    placeholder="15 cijfers, Luhn-gevalideerd"
                    defaultValue={initial?.imei ?? ""}
                  />
                  {state?.errors?.imei ? (
                    <p className="text-xs text-red-600">
                      {state.errors.imei.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="brand">Merk <span className="text-red-600">*</span></Label>
                  <Input
                    id="brand"
                    name="brand"
                    required
                    defaultValue={initial?.brand ?? ""}
                  />
                  {state?.errors?.brand ? (
                    <p className="text-xs text-red-600">
                      {state.errors.brand.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model <span className="text-red-600">*</span></Label>
                  <Input
                    id="model"
                    name="model"
                    required
                    defaultValue={initial?.model ?? ""}
                  />
                  {state?.errors?.model ? (
                    <p className="text-xs text-red-600">
                      {state.errors.model.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="hardwareType">Hardware type</Label>
                  <Input
                    id="hardwareType"
                    name="hardwareType"
                    defaultValue={initial?.hardwareType ?? ""}
                    placeholder="bijv. OBD-II, J1939, vast"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firmwareVersion">Firmware versie</Label>
                  <Input
                    id="firmwareVersion"
                    name="firmwareVersion"
                    defaultValue={initial?.firmwareVersion ?? ""}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    name="status"
                    defaultValue={
                      (initial?.status as TrackerStatus) ?? "IN_STOCK"
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Kies een status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN_STOCK">Op voorraad</SelectItem>
                      <SelectItem value="IN_USE">In gebruik</SelectItem>
                      <SelectItem value="SUSPENDED">Geschorst</SelectItem>
                      <SelectItem value="DEFECTIVE">Defect</SelectItem>
                      <SelectItem value="RMA">RMA</SelectItem>
                      <SelectItem value="RETIRED">Uit dienst</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purchaseDate">Aankoopdatum</Label>
                  <Input
                    id="purchaseDate"
                    name="purchaseDate"
                    type="date"
                    defaultValue={purchaseDateStr}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplier">Leverancier</Label>
                <Input
                  id="supplier"
                  name="supplier"
                  defaultValue={initial?.supplier ?? ""}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Notities</CardTitle>
              <CardDescription>
                Interne notities (niet zichtbaar voor klant).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  id="notes"
                  name="notes"
                  rows={12}
                  placeholder="Aankoopcondities, garantie, specifieke configuratie…"
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
            <Link href="/trackers">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
