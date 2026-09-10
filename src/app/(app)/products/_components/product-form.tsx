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
import type { ProductActionState } from "../actions";

type ProductFormProps = {
  mode: "create" | "edit";
  initial?: Partial<{
    name: string;
    productCode: string;
    description: string | null;
    monthlyPrice: number;
    currency: string;
    btwPercentage: number | null;
    inserveArticleId: number | null;
    isActive: boolean;
  }>;
  action: (
    prev: ProductActionState,
    formData: FormData
  ) => Promise<ProductActionState>;
  productId?: string;
};

export function ProductForm({
  mode,
  initial,
  action,
  productId,
}: ProductFormProps) {
  const [state, formAction] = useFormState<ProductActionState>(action as any, {
    errors: undefined,
    message: null,
  });

  useEffect(() => {
    if (state?.message && !state.errors) toast.error(state.message);
  }, [state?.message, state?.errors]);

  const identifiersDisabled = mode === "edit";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/products">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "create" ? "Nieuw product" : "Product bewerken"}
          </h1>
          <p className="text-sm text-slate-500">
            {mode === "create"
              ? "Voeg een nieuw abonnementsproduct toe."
              : `Product ${initial?.productCode ?? ""} bijwerken.`}
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-6">
        {productId ? (
          <input type="hidden" name="productId" value={productId} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Algemeen</CardTitle>
              <CardDescription>Naam en omschrijving.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="productCode">
                    Productcode <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="productCode"
                    name="productCode"
                    required
                    disabled={identifiersDisabled}
                    defaultValue={initial?.productCode ?? ""}
                  />
                  {state?.errors?.productCode ? (
                    <p className="text-xs text-red-600">
                      {state.errors.productCode.join(", ")}
                    </p>
                  ) : null}
                </div>
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Omschrijving</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={5}
                  defaultValue={initial?.description ?? ""}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <CardDescription>
                Maandelijks tarief en beschikbaarheid.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="monthlyPrice">
                    Prijs / mnd <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="monthlyPrice"
                    name="monthlyPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={
                      initial?.monthlyPrice !== undefined
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
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-2">
                  <Label htmlFor="inserveArticleId">Inserve Artikel-ID</Label>
                  <Input
                    id="inserveArticleId"
                    name="inserveArticleId"
                    type="number"
                    defaultValue={
                      initial?.inserveArticleId !== undefined && initial?.inserveArticleId !== null
                        ? String(initial.inserveArticleId)
                        : ""
                    }
                  />
                  <p className="text-xs text-slate-500">
                    Wordt automatisch aangemaakt in Inserve bij sync indien leeg.
                  </p>
                  {state?.errors?.inserveArticleId ? (
                    <p className="text-xs text-red-600">
                      {state.errors.inserveArticleId.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

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
                    Onzichtbaar voor nieuwe orders wanneer uitgevinkt.
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
            <Link href="/products">Annuleren</Link>
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" /> Opslaan
          </Button>
        </div>
      </form>
    </div>
  );
}
