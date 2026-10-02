import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { SubscriptionForm } from "../_components/subscription-form";
import { createSubscriptionAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function NewSubscriptionPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen aanmaken.");
  }

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;
  const customerScopeCustomer: any = hasScope ? { id: { in: customerIds } } : undefined;

  const [customers, products] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, ...customerScopeCustomer },
      select: { id: true, companyName: true, customerNumber: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, productCode: true, name: true, monthlyPrice: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <SubscriptionForm
      mode="create"
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      productOptions={products.map((p) => ({
        id: p.id,
        label: `${p.name} (${p.productCode} · €${String(p.monthlyPrice)}/mnd)`,
        defaultMonthlyPrice: String(p.monthlyPrice),
        billingCycle: "MONTHLY",
      }))}
      action={createSubscriptionAction as any}
    />
  );
}
