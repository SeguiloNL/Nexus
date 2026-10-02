import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyUsers } from "@/server/services/user.service";
import { findManyRoles } from "@/server/services/role.service";
import { findManyCustomers } from "@/server/services/customer.service";
import { UserList } from "./_components/user-list";
import { UserRole, RoleScope, CustomerType } from "@/types/enums";
import { hasMinRole } from "@/lib/rbac";

function parseNumber(
  value: string | string[] | undefined | null,
  fallback: number
): number {
  if (value === undefined || value === null) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  const n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(
  value: string | string[] | undefined | null
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function parseString<T extends string = string>(
  value: string | string[] | undefined | null
): T | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || undefined) as T | undefined;
}

function parseDate(
  value: string | string[] | undefined | null
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : raw;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: {
    error?: string;
    page?: string;
    perPage?: string;
    sort?: string;
    order?: string;
    search?: string;
    role?: string;
    scope?: string;
    roleId?: string;
    customerId?: string;
    isActive?: string;
    lastLoginBefore?: string;
    lastLoginAfter?: string;
  };
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

  const page = parseNumber(searchParams?.page, 1);
  const perPage = Math.min(parseNumber(searchParams?.perPage, 50), 500);
  const sort = parseString(searchParams?.sort) ?? "createdAt";
  const orderRaw = parseString(searchParams?.order);
  const order: "asc" | "desc" =
    orderRaw === "asc" || orderRaw === "desc" ? orderRaw : "desc";

  const filterParams = {
    page,
    perPage,
    sort,
    order,
    search: parseString(searchParams?.search),
    role: parseString<UserRole>(searchParams?.role),
    scope: parseString<RoleScope>(searchParams?.scope),
    roleId: parseString(searchParams?.roleId),
    customerId: parseString(searchParams?.customerId),
    isActive: parseBoolean(searchParams?.isActive),
    lastLoginBefore: parseDate(searchParams?.lastLoginBefore),
    lastLoginAfter: parseDate(searchParams?.lastLoginAfter),
  };

  let roles: any[] = [];
  try {
    roles = (await findManyRoles()) as any[];
  } catch (_e) {
    roles = [];
  }

  const [usersResult, customers] = await Promise.all([
    findManyUsers(filterParams, ctx),
    findManyCustomers({
      page: 1,
      perPage: 1000,
      viewerRole: session.user.role,
      customerScope: session.user.customerIds ?? undefined,
    }),
  ]);

  const appliedFilters = {
    page: usersResult.page,
    perPage: usersResult.perPage,
    total: usersResult.total,
    totalPages: usersResult.totalPages,
    sort,
    order,
    search: filterParams.search ?? null,
    role: filterParams.role ?? null,
    scope: filterParams.scope ?? null,
    roleId: filterParams.roleId ?? null,
    customerId: filterParams.customerId ?? null,
    isActive:
      filterParams.isActive === undefined
        ? null
        : (filterParams.isActive as boolean),
    lastLoginBefore: filterParams.lastLoginBefore ?? null,
    lastLoginAfter: filterParams.lastLoginAfter ?? null,
  };

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
      pagination={appliedFilters}
    />
  );
}
