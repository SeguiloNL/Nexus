import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
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
  const session = await auth();
  if (!session?.user) redirect("/login");
  requirePermission(session.user.role, "view", "invoice");

  const sp = await props.searchParams;
  const ctx = { userId: session.user.id, userRole: session.user.role };
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
