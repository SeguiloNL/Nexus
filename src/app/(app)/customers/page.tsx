import { auth } from "@/auth";
import { findManyCustomers } from "@/server/services/customer.service";
import { CustomerList } from "./_components/customer-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function CustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [result] = await Promise.all([
    findManyCustomers({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
    }),
  ]);

  const canCreate = canUserRole(session.user.role, "create", "customer");
  const canEdit = canUserRole(session.user.role, "edit", "customer");
  const canDelete = canUserRole(session.user.role, "delete", "customer");

  return (
    <CustomerList
      customers={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
