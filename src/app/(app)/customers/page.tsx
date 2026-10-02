import { auth } from "@/auth";
import { findManyCustomers, getCustomerHierarchyTree } from "@/server/services/customer.service";
import { CustomerList } from "./_components/customer-list";
import { CustomerHierarchyTreeCard } from "./_components/customer-hierarchy-tree";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function CustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!canUserRole(session.user.permissions, "view", "customer")) {
    throw new PermissionError("Je mag geen klanten bekijken.");
  }

  const [result, hierarchy] = await Promise.all([
    findManyCustomers({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
      customerScope: session.user.customerIds,
    }),
    getCustomerHierarchyTree(null, {
      customerScope: session.user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(session.user.permissions, "create", "customer");
  const canEdit = canUserRole(session.user.permissions, "edit", "customer");
  const canDelete = canUserRole(session.user.permissions, "delete", "customer");
  const canExport = canUserRole(session.user.permissions, "export", "customer");
  const canImport = canUserRole(session.user.permissions, "import", "customer");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-6">
        <CustomerHierarchyTreeCard
          title="Klant hiërarchie"
          description="Navigeer door resellers, partners en klanten."
          nodes={hierarchy as any}
        />
      </div>
      <CustomerList
        customers={result.data as any}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
        canImport={canImport}
      />
    </div>
  );
}
