import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyUsers } from "@/server/services/user.service";
import { findManyRoles } from "@/server/services/role.service";
import { findManyCustomers } from "@/server/services/customer.service";
import { UserList } from "./_components/user-list";
import { canUserRole, canUserRoleAsync } from "@/lib/auth/session";
import { PermissionError, requirePermission } from "@/lib/rbac";

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const authzRole = session.user.role ?? session.user.roleId ?? session.user.permissions ?? "";
  const canView =
    canUserRole(authzRole, "view", "user") ||
    (await canUserRoleAsync(session.user.roleId ?? session.user.role ?? "", "view", "user"));

  if (!canView) {
    try {
      await requirePermission(
        session.user.permissions ?? session.user.roleId ?? "",
        "view",
        "user"
      );
    } catch (_e) {
      throw new PermissionError(
        "Onvoldoende rechten: je hebt geen toestemming om gebruikers te bekijken."
      );
    }
  }

  const canCreate =
    canUserRole(authzRole, "create", "user") ||
    (await canUserRoleAsync(session.user.roleId ?? "", "create", "user"));
  const canEdit =
    canUserRole(authzRole, "edit", "user") ||
    (await canUserRoleAsync(session.user.roleId ?? "", "edit", "user"));
  const canDelete =
    canUserRole(authzRole, "delete", "user") ||
    (await canUserRoleAsync(session.user.roleId ?? "", "delete", "user"));

  const ctx = {
    userId: session.user.id,
    userRole: session.user.role,
    roleId: session.user.roleId,
    roleScope: session.user.roleScope,
    permissions: session.user.permissions,
    customerScope: session.user.customerIds,
  };
  const [usersResult, roles, customers] = await Promise.all([
    findManyUsers({ page: 1, perPage: 500 }, ctx),
    findManyRoles(),
    findManyCustomers({
      page: 1,
      perPage: 1000,
      viewerRole: session.user.role,
      customerScope: session.user.customerIds ?? undefined,
    }),
  ]);

  return (
    <UserList
      users={usersResult.data as any}
      roles={roles as any}
      customers={customers.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      currentUserId={session.user.id}
      viewerRoleScope={session.user.roleScope ?? null}
      errorMessage={searchParams?.error ?? null}
    />
  );
}
