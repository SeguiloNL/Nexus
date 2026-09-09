import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyUsers } from "@/server/services/user.service";
import { UserList } from "./_components/user-list";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "user")) {
    throw new PermissionError("Alleen beheerders kunnen gebruikers beheren.");
  }

  const canCreate = canUserRole(session.user.role, "create", "user");
  const canEdit = canUserRole(session.user.role, "edit", "user");
  const canDelete = canUserRole(session.user.role, "delete", "user");

  const result = await findManyUsers({ page: 1, perPage: 500 });

  return (
    <UserList
      users={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      currentUserId={session.user.id}
      errorMessage={searchParams?.error ?? null}
    />
  );
}
