import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SubscriptionForm } from "../_components/subscription-form";
import { createSubscriptionAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function NewSubscriptionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen aanmaken.");
  }

  const [customers, products] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, companyName: true, customerNumber: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, productCode: true, name: true, monthlyPrice: true, billingCycle: true },
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
        billingCycle: p.billingCycle,
      }))}
      action={createSubscriptionAction as any}
    />
  );
}
