import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManySubscriptions } from "@/server/services/subscription.service";
import { SubscriptionList } from "./_components/subscription-list";
import { generateMonthlyInvoicesAction } from "./actions";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "subscription")) {
    redirectForbidden();
  }

  const result = await findManySubscriptions({
    page: 1,
    perPage: 500,
    customerScope: user.customerIds,
  });

  return (
    <SubscriptionList
      subscriptions={result.data as any}
      canCreate={canUserRole(user.permissions, "create", "subscription")}
      canEdit={canUserRole(user.permissions, "edit", "subscription")}
      canDelete={canUserRole(user.permissions, "delete", "subscription")}
      canGenerateInvoices={canUserRole(user.permissions, "create", "invoice")}
      generateMonthlyInvoicesAction={generateMonthlyInvoicesAction}
    />
  );
}
