import { auth } from "@/auth";
import { findManyProducts } from "@/server/services/product.service";
import { ProductList } from "./_components/product-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "product")) {
    throw new PermissionError("Je mag geen producten bekijken.");
  }

  const [result] = await Promise.all([
    findManyProducts({ page: 1, perPage: 500 }),
  ]);

  const canCreate = canUserRole(session.user.role, "create", "product");
  const canEdit = canUserRole(session.user.role, "edit", "product");

  return (
    <ProductList
      products={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
    />
  );
}
