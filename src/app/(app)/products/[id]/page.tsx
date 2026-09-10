import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findProductById } from "@/server/services/product.service";
import { ProductDetail } from "../_components/product-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { updateProductAction } from "../actions";

export default async function ProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "product")) {
    throw new PermissionError("Je mag geen producten bekijken.");
  }

  const product = await findProductById(params.id);
  if (!product) notFound();

  const productForForm = {
    ...product,
    monthlyPrice: Number(product.monthlyPrice),
    btwPercentage:
      product.btwPercentage !== null && product.btwPercentage !== undefined
        ? Number(product.btwPercentage)
        : null,
  };

  const updateAction: any = async (
    prev: any,
    formData: FormData
  ) => updateProductAction(params.id, prev, formData);

  return (
    <ProductDetail
      product={product as any}
      initialProduct={productForForm as any}
      role={session.user.role}
      updateAction={updateAction}
      productId={params.id}
    />
  );
}
