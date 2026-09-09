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
import type { CustomerActionState } from "../actions";
import type { CustomerStatus } from "@prisma/client";

type ParentOption = { id: string; label: string };

type CustomerFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    customerNumber: string;
    companyName: string;
    parentCustomerId: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    status: CustomerStatus;
    notes: string | null;
  }>;
  parentOptions: ParentOption[];
  action: (prev: CustomerActionState, formData: FormData) => Promise<CustomerActionState>;
  customerId?: string;
};

export function CustomerForm({
  mode,
  initial,
  parentOptions,
  action,
  customerId,
}: CustomerFormProps) {
  const [state, formAction] = useFormState<CustomerActionState>(
    action as any,
    { errors: undefined, message: null }
  );

  useEffect(() => {
    if (state?.message && !state.errors) {
      toast.error(state.message);
    }
  }, [state?.message, state?.errors]);

  const customerNumberDisabled =
    mode === "edit" || Boolean(initial?.customerNumber);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/customers">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuwe klant" : "Klant bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Voeg een nieuwe klant of subklant toe."
              : `Klant ${initial?.customerNumber ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {customerId ? (
          <input type="hidden" name="customerId" value={customerId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>
                Basisgegevens van de klant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customerNumber">Klantnummer</Label>
                  <Input
                    id="customerNumber"
                    name="customerNumber"
                    placeholder="Laat leeg voor auto-generatie"
                    disabled={customerNumberDisabled}
                    defaultValue={initial?.customerNumber ?? ""}
                  />
                  {state?.errors?.customerNumber ? (
                    <p className="text-xs text-red-600">
                      {state.errors.customerNumber.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    name="status"
                    defaultValue={
                      (initial?.status as CustomerStatus) ?? "PROSPECT"
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Kies een status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROSPECT">Prospect</SelectItem>
                      <SelectItem value="ACTIVE">Actief</SelectItem>
                      <SelectItem value="SUSPENDED">Opgeschort</SelectItem>
                      <SelectItem value="INACTIVE">Inactief</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="companyName">
                  Bedrijfsnaam <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="companyName"
                  name="companyName"
                  required
                  defaultValue={initial?.companyName ?? ""}
                />
                {state?.errors?.companyName ? (
                  <p className="text-xs text-red-600">
                    {state.errors.companyName.join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="parentCustomerId">
                  Hoofdklant (optioneel, voor subklanten)
                </Label>
                <Select
                  name="parentCustomerId"
                  defaultValue={initial?.parentCustomerId ?? "none"}
                >
                  <SelectTrigger id="parentCustomerId">
                    <SelectValue placeholder="Geen hoofdklant (zelfstandig)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      Geen hoofdklant (zelfstandig)
                    </SelectItem>
                    {parentOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state?.errors?.parentCustomerId ? (
                  <p className="text-xs text-red-600">
                    {state.errors.parentCustomerId.join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactPerson">Contactpersoon</Label>
                  <Input
                    id="contactPerson"
                    name="contactPerson"
                    defaultValue={initial?.contactPerson ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={initial?.email ?? ""}
                  />
                  {state?.errors?.email ? (
                    <p className="text-xs text-red-600">
                      {state.errors.email.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefoon</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    defaultValue={initial?.phone ?? ""}
                  />
                  {state?.errors?.phone ? (
                    <p className="text-xs text-red-600">
                      {state.errors.phone.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Adres</CardTitle>
              <CardDescription>
                Facturatie-/bezoekadres van de klant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="address">Adres</Label>
                <Input
                  id="address"
                  name="address"
                  defaultValue={initial?.address ?? ""}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postcode</Label>
                  <Input
                    id="postalCode"
                    name="postalCode"
                    defaultValue={initial?.postalCode ?? ""}
                  />
                  {state?.errors?.postalCode ? (
                    <p className="text-xs text-red-600">
                      {state.errors.postalCode.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Plaats</Label>
                  <Input
                    id="city"
                    name="city"
                    defaultValue={initial?.city ?? ""}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Land</Label>
                <Input
                  id="country"
                  name="country"
                  defaultValue={initial?.country ?? "Nederland"}
                />
              </div>

              <div className="space-y-2 pt-2">
                <Label htmlFor="notes">Notities</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={5}
                  placeholder="Optionele notities (niet zichtbaar voor de klant)."
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
            <Link href="/customers">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
