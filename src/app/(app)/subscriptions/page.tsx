import { auth } from "@/auth";
import { findManySubscriptions } from "@/server/services/subscription.service";
import { SubscriptionList } from "./_components/subscription-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";
import { generateMonthlyInvoicesAction } from "./actions";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.permissions, "view", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen bekijken.");
  }

  const result = await findManySubscriptions({
    page: 1,
    perPage: 500,
    customerScope: session.user.customerIds,
  });

  return (
    <SubscriptionList
      subscriptions={result.data as any}
      canCreate={canUserRole(session.user.permissions, "create", "subscription")}
      canEdit={canUserRole(session.user.permissions, "edit", "subscription")}
      canDelete={canUserRole(session.user.permissions, "delete", "subscription")}
      canGenerateInvoices={canUserRole(session.user.permissions, "create", "invoice")}
      generateMonthlyInvoicesAction={generateMonthlyInvoicesAction}
    />
  );
}
