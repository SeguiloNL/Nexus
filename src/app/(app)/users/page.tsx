import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyUsers } from "@/server/services/user.service";
import { findManyRoles } from "@/server/services/role.service";
import { findManyCustomers } from "@/server/services/customer.service";
import { UserList } from "./_components/user-list";
import { UserRole, RoleScope } from "@/types/enums";
import { hasMinRole } from "@/lib/rbac";

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user.role ?? UserRole.VIEWER) as UserRole;

  if (!hasMinRole(userRole, UserRole.VIEWER)) {
    redirect("/");
  }

  const canView = hasMinRole(userRole, UserRole.VIEWER);
  const canCreate = hasMinRole(userRole, UserRole.ADMIN);
  const canEdit = hasMinRole(userRole, UserRole.ADMIN);
  const canDelete = hasMinRole(userRole, UserRole.ADMIN);

  if (!canView) {
    redirect("/");
  }

  const ctx = {
    userId: session.user.id,
    userRole: session.user.role,
    roleId: session.user.roleId,
    roleScope: session.user.roleScope,
    permissions: session.user.permissions,
    customerScope: session.user.customerIds,
  };

  let roles: any[] = [];
  try {
    roles = (await findManyRoles()) as any[];
  } catch (_e) {
    roles = [];
  }

  const [usersResult, customers] = await Promise.all([
    findManyUsers({ page: 1, perPage: 500 }, ctx),
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
      roles={roles}
      customers={customers.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      currentUserId={session.user.id}
      viewerRoleScope={(session.user.roleScope ?? RoleScope.INTERNAL) as any}
      errorMessage={searchParams?.error ?? null}
    />
  );
}
