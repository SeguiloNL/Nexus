import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManyInvoices } from "@/server/services/invoice.service";
import type { InvoiceStatus } from "@/types/enums";
import { InvoiceList } from "./_components/invoice-list";

export default async function InvoicesPage(props: {
  searchParams: Promise<{
    page?: string;
    perPage?: string;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    status?: string;
    issueDateFrom?: string;
    issueDateTo?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "invoice")) {
    redirectForbidden();
  }

  const sp = await props.searchParams;
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const page = sp.page ? Number(sp.page) || 1 : 1;
  const perPage = sp.perPage ? Number(sp.perPage) || 25 : 25;
  const status = sp.status as InvoiceStatus | undefined;

  const result = await findManyInvoices(
    {
      page,
      perPage,
      sort: sp.sort,
      order: sp.order,
      search: sp.search,
      status,
      issueDateFrom: sp.issueDateFrom ? new Date(sp.issueDateFrom) : undefined,
      issueDateTo: sp.issueDateTo ? new Date(sp.issueDateTo) : undefined,
    },
    ctx
  );

  return <InvoiceList result={result} />;
}
