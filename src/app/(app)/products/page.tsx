import { requireUser, canUserRole } from "@/lib/auth/session";
import { findManyProducts } from "@/server/services/product.service";
import { ProductList } from "./_components/product-list";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function ProductsPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "product")) {
    throw new PermissionError("Je mag geen producten bekijken.");
  }

  const [result] = await Promise.all([
    findManyProducts({ page: 1, perPage: 500 }),
  ]);

  const canCreate = canUserRole(user.permissions, "create", "product");
  const canEdit = canUserRole(user.permissions, "edit", "product");

  return (
    <ProductList
      products={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
    />
  );
}
