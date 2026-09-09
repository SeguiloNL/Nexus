import { auth } from "@/auth";
import { listCustomerOptions } from "@/server/services/customer.service";
import { listProductOptions } from "@/server/services/product.service";
import { SubscriptionForm } from "../_components/subscription-form";
import { canUserRole } from "@/lib/auth/session";
import { createSubscriptionAction } from "../actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewSubscriptionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!canUserRole(session.user.role, "create", "subscription")) {
    redirect("/403");
  }

  const [customerOptions, productOptions] = await Promise.all([
    listCustomerOptions(),
    listProductOptions(),
  ]);

  return (
    <SubscriptionForm
      mode="create"
      customerOptions={customerOptions}
      productOptions={productOptions}
      action={createSubscriptionAction}
    />
  );
}
