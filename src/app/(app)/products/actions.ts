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
