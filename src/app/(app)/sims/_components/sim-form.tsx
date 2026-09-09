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
import type { SimActionState } from "../actions";
import type { SimStatus } from "@prisma/client";

type SimFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    iccid: string;
    msisdn: string | null;
    imsi: string | null;
    provider: string;
    simType: string | null;
    apn: string | null;
    status: SimStatus;
    providerActivationDate: Date | string | null;
    providerDeactivationDate: Date | string | null;
    notes: string | null;
  }>;
  action: (prev: SimActionState, formData: FormData) => Promise<SimActionState>;
  simId?: string;
};

function toDateStr(v: Date | string | null | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export function SimForm({
  mode,
  initial,
  action,
  simId,
}: SimFormProps) {
  const [state, formAction] = useFormState<SimActionState>(
    action as any,
    { errors: undefined, message: null }
  );

  useEffect(() => {
    if (state?.message && !state.errors) {
      toast.error(state.message);
    }
  }, [state?.message, state?.errors]);

  const iccidDisabled = mode === "edit";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/sims">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuwe SIM-kaart" : "SIM bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Voeg een nieuwe SIM-kaart toe aan de voorraad."
              : `SIM ${initial?.iccid ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {simId ? (
          <input type="hidden" name="simId" value={simId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>
                Identificatie en provider van de SIM-kaart.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="iccid">ICCID <span className="text-red-600">*</span></Label>
                  <Input
                    id="iccid"
                    name="iccid"
                    required
                    disabled={iccidDisabled}
                    placeholder="19-20 cijfers, beginnend met 89"
                    defaultValue={initial?.iccid ?? ""}
                  />
                  {state?.errors?.iccid ? (
                    <p className="text-xs text-red-600">
                      {state.errors.iccid.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="msisdn">MSISDN (telefoonnr)</Label>
                  <Input
                    id="msisdn"
                    name="msisdn"
                    defaultValue={initial?.msisdn ?? ""}
                    placeholder="+316xxxxxxxx"
                  />
                  {state?.errors?.msisdn ? (
                    <p className="text-xs text-red-600">
                      {state.errors.msisdn.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="imsi">IMSI</Label>
                  <Input
                    id="imsi"
                    name="imsi"
                    defaultValue={initial?.imsi ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider">Provider <span className="text-red-600">*</span></Label>
                  <Input
                    id="provider"
                    name="provider"
                    required
                    defaultValue={initial?.provider ?? ""}
                  />
                  {state?.errors?.provider ? (
                    <p className="text-xs text-red-600">
                      {state.errors.provider.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="simType">SIM type</Label>
                  <Input
                    id="simType"
                    name="simType"
                    defaultValue={initial?.simType ?? ""}
                    placeholder="bijv. eSIM, MFF2, 2FF"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apn">APN</Label>
                  <Input
                    id="apn"
                    name="apn"
                    defaultValue={initial?.apn ?? ""}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    name="status"
                    defaultValue={
                      (initial?.status as SimStatus) ?? "IN_STOCK"
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Kies een status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN_STOCK">Op voorraad</SelectItem>
                      <SelectItem value="ACTIVE">Actief</SelectItem>
                      <SelectItem value="SUSPENDED">Geschorst</SelectItem>
                      <SelectItem value="TERMINATED">Beëindigd</SelectItem>
                      <SelectItem value="DEFECTIVE">Defect</SelectItem>
                      <SelectItem value="RMA">RMA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerActivationDate">Activatiedatum</Label>
                  <Input
                    id="providerActivationDate"
                    name="providerActivationDate"
                    type="date"
                    defaultValue={toDateStr(initial?.providerActivationDate)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerDeactivationDate">Einddatum</Label>
                  <Input
                    id="providerDeactivationDate"
                    name="providerDeactivationDate"
                    type="date"
                    defaultValue={toDateStr(initial?.providerDeactivationDate)}
                  />
                </div>
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
                  rows={14}
                  placeholder="Billing references, tariefplannen, PIN/PUK, etc."
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
            <Link href="/sims">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
