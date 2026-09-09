import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { AuditLogList } from "./_components/audit-log-list";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import type { AuditAction } from "@/types/enums";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: { page?: string; entityType?: string; action?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "audit_log")) {
    throw new PermissionError("Je mag geen auditlogs bekijken.");
  }

  const page = Number(searchParams?.page ?? 1);
  const entityType = searchParams?.entityType || undefined;
  const action = (searchParams?.action || undefined) as AuditAction | undefined;

  const result = await findManyAuditLogs({
    page: page || 1,
    perPage: 100,
    entityType,
    action,
    viewerUserId: session.user.id,
    viewerRole: session.user.role,
  });

  return <AuditLogList logs={result.data as any} totalCount={result.total} viewerRole={session.user.role} />;
}
