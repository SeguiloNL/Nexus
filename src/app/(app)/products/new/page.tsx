import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { ProductForm } from "../_components/product-form";
import { createProductAction } from "../actions";
import { PermissionError } from "@/lib/rbac";

export default async function NewProductPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "product")) {
    throw new PermissionError("Je mag geen producten aanmaken.");
  }

  return (
    <ProductForm
      mode="create"
      action={createProductAction as any}
    />
  );
}
