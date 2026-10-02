import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { AuditLogList } from "./_components/audit-log-list";
import { PermissionError } from "@/lib/rbac";
import type { AuditAction } from "@/types/enums";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: { page?: string; entityType?: string; action?: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "audit_log")) {
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
    viewerUserId: user.id,
    viewerRole: user.role,
  });

  return <AuditLogList logs={result.data as any} totalCount={result.total} viewerRole={user.role} />;
}
