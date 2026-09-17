"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateProductSchema,
  UpdateProductSchema,
  type CreateProductInput,
} from "@/server/validators/product";
import {
  createProduct,
  updateProduct,
  bulkSetActiveProducts,
} from "@/server/services/product.service";

export type ProductActionState = {
  errors?: Partial<Record<keyof CreateProductInput, string[]>>;
  message?: string | null;
  productId?: string;
};

export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "product");

  const isActive = formData.get("isActive");
  const data = {
    name: formData.get("name") || undefined,
    productCode: formData.get("productCode") || undefined,
    description: formData.get("description") || null,
    monthlyPrice: formData.get("monthlyPrice")
      ? Number(formData.get("monthlyPrice"))
      : undefined,
    currency: formData.get("currency") || undefined,
    btwPercentage: formData.get("btwPercentage")
      ? Number(formData.get("btwPercentage"))
      : undefined,
    inserveArticleId: formData.get("inserveArticleId") || null,
    isActive: isActive === "on" || isActive === "true",
  };

  const validated = CreateProductSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as ProductActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const product = await createProduct(validated.data, ctx);

  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

export async function updateProductAction(
  productId: string,
  _prev: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "product");

  const isActive = formData.get("isActive");
  const data: any = {
    name: (formData.get("name") as string) || undefined,
    productCode: (formData.get("productCode") as string) || undefined,
    description: (formData.get("description") as string) || null,
    monthlyPrice: formData.get("monthlyPrice")
      ? Number(formData.get("monthlyPrice"))
      : undefined,
    currency: (formData.get("currency") as string) || undefined,
    btwPercentage: formData.get("btwPercentage")
      ? Number(formData.get("btwPercentage"))
      : undefined,
    inserveArticleId: formData.get("inserveArticleId") || null,
    isActive: isActive !== null ? isActive === "on" || isActive === "true" : undefined,
  };

  const validated = UpdateProductSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as ProductActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  await updateProduct(productId, validated.data, ctx);

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}`);
}

export type BulkActionState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  count?: number;
};

function parseIdsFormData(formData: FormData): string[] {
  const raw = formData.get("ids");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
  } catch {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function bulkActivateProductsAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "product");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen producten geselecteerd." };
  const ctx = { userId: user.id, userRole: user.role };
  try {
    const result = await bulkSetActiveProducts(ids, true, ctx);
    revalidatePath("/products");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} product(en) geactiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function bulkDeactivateProductsAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "product");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen producten geselecteerd." };
  const ctx = { userId: user.id, userRole: user.role };
  try {
    const result = await bulkSetActiveProducts(ids, false, ctx);
    revalidatePath("/products");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} product(en) gedeactiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
