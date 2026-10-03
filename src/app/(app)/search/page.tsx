import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import GlobalSearchClient from "./_components/search-client";

export default async function GlobalSearchPage() {
  const user = await requireUser();

  const perms = user.permissions;
  const can = (resource: string) =>
    canUserRole(perms, "view", resource as any);

  const hasAnyRight =
    can("customer") ||
    can("tracker") ||
    can("sim") ||
    can("vehicle") ||
    can("product") ||
    can("subscription") ||
    can("activation_order") ||
    can("user") ||
    can("dashboard");

  if (!hasAnyRight) {
    redirectForbidden();
  }

  return <GlobalSearchClient />;
}
