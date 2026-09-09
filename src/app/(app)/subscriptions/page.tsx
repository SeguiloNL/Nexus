import { auth } from "@/auth";
import { findManySubscriptions } from "@/server/services/subscription.service";
import { SubscriptionList } from "./_components/subscription-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen bekijken.");
  }

  const result = await findManySubscriptions({
    page: 1,
    perPage: 500,
  });

  return (
    <SubscriptionList
      subscriptions={result.data as any}
      canCreate={canUserRole(session.user.role, "create", "subscription")}
      canEdit={canUserRole(session.user.role, "edit", "subscription")}
      canDelete={canUserRole(session.user.role, "delete", "subscription")}
    />
  );
}
