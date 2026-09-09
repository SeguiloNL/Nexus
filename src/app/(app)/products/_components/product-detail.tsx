"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Info,
  FileText,
  History,
  AlertTriangle,
  Sparkles,
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
import { Badge } from "@/components/ui/badge";
import { ProductForm } from "./product-form";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import type { UserRole } from "@/types/enums";
import type { Product } from "@prisma/client";
import type { SubscriptionStatus } from "@prisma/client";

type DetailProduct = Product & {
  subscriptions: Array<{
    id: string;
    subscriptionNumber: string;
    status: SubscriptionStatus;
    startDate: Date;
    endDate: Date | null;
    customer: {
      id: string;
      companyName: string;
      customerNumber: string;
    } | null;
  }>;
};

type ProductDetailProps = {
  product: DetailProduct;
  initialProduct?: Partial<{
    name: string;
    productCode: string;
    description: string | null;
    monthlyPrice: number;
    currency: string;
    isActive: boolean;
  }>;
  role: UserRole;
  updateAction: (
    productId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  productId: string;
};

export function ProductDetail({
  product,
  initialProduct,
  role,
  updateAction,
  productId,
}: ProductDetailProps) {
  const canEdit = canUserRole(role, "edit", "product");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-slate-500" />
              <h1 className="text-2xl font-bold tracking-tight">
                {product.name}
              </h1>
              {product.isActive ? (
                <Badge variant="success">Actief</Badge>
              ) : (
                <Badge variant="muted">Inactief</Badge>
              )}
            </div>
            <div className="text-sm text-slate-500">
              <span className="font-mono text-xs">{product.productCode}</span>
              {" · "}
              <span className="font-mono">
                {formatCurrency(Number(product.monthlyPrice))} / mnd (
                {product.currency})
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit ? (
            <Button asChild>
              <Link href="#edit">
                <Edit className="h-4 w-4" /> Bewerken
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="mr-1.5 h-4 w-4" /> Overzicht
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" /> Bewerken
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="subscriptions">
            <Badge className="mr-1.5">Abonnementen</Badge> (
            {product.subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Omschrijving</CardTitle>
              </CardHeader>
              <CardContent>
                {product.description ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {product.description}
                  </p>
                ) : (
                  <div className="text-sm text-slate-400">
                    Geen omschrijving.
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
                <CardDescription>Metadata</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(product.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(product.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <ProductForm
              mode="edit"
              productId={productId}
              initial={initialProduct}
              action={async (prev, form) =>
                updateAction(productId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="subscriptions" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Abonnementen op dit product
              </CardTitle>
              <CardDescription>
                Top 10 meest recente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {product.subscriptions.length ? (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Nr.</th>
                        <th className="px-3 py-2">Klant</th>
                        <th className="px-3 py-2">Periode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.subscriptions.map((s) => (
                        <tr
                          key={s.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/subscriptions/${s.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {s.subscriptionNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {s.customer ? (
                              <Link
                                href={`/customers/${s.customer.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {s.customer.companyName}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(s.startDate)}
                            {s.endDate ? ` → ${formatDate(s.endDate)}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  Nog geen abonnementen.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wijzigingsgeschiedenis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                <div>
                  Auditlog (entityType=product) komt beschikbaar zodra de
                  database actief is.
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
