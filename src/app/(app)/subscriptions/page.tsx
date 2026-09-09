import { auth } from "@/auth";
import { findManySubscriptions } from "@/server/services/subscription.service";
import { SubscriptionList } from "./_components/subscription-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!canUserRole(session.user.role, "view", "subscription")) {
    redirect("/403");
  }

  const [result] = await Promise.all([
    findManySubscriptions({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
    }),
  ]);

  const canCreate = canUserRole(session.user.role, "create", "subscription");
  const canEdit = canUserRole(session.user.role, "edit", "subscription");

  return (
    <SubscriptionList
      subscriptions={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
    />
  );
}
