import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { ProductForm } from "../_components/product-form";
import { createProductAction } from "../actions";

export default async function NewProductPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "product")) {
    redirectForbidden();
  }

  return (
    <ProductForm
      mode="create"
      action={createProductAction as any}
    />
  );
}
