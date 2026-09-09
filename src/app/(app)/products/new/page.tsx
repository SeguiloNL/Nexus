import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ProductForm } from "../_components/product-form";
import { createProductAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";

export default async function NewProductPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "product")) {
    throw new PermissionError("Je mag geen producten aanmaken.");
  }

  return (
    <ProductForm
      mode="create"
      action={createProductAction as any}
    />
  );
}
