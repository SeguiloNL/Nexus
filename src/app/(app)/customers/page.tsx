import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManyCustomers, getCustomerHierarchyTree } from "@/server/services/customer.service";
import { CustomerList } from "./_components/customer-list";
import { CustomerHierarchyTreeCard } from "./_components/customer-hierarchy-tree";

export default async function CustomersPage() {
  const user = await requireUser();

  if (!canUserRole(user.permissions, "view", "customer")) {
    redirectForbidden();
  }

  const [result, hierarchy] = await Promise.all([
    findManyCustomers({
      page: 1,
      perPage: 500,
      viewerRole: user.role,
      customerScope: user.customerIds,
    }),
    getCustomerHierarchyTree(null, {
      customerScope: user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(user.permissions, "create", "customer");
  const canEdit = canUserRole(user.permissions, "edit", "customer");
  const canDelete = canUserRole(user.permissions, "delete", "customer");
  const canExport = canUserRole(user.permissions, "export", "customer");
  const canImport = canUserRole(user.permissions, "import", "customer");

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
