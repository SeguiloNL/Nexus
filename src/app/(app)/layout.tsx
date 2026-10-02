import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser, canUserRole } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();

  return (
    <AppShell
      sidebar={
        <Sidebar
          userRole={user.role}
          roleId={user.roleId ?? null}
          roleScope={user.roleScope ?? null}
          permissions={user.permissions ?? null}
        />
      }
      header={
        <Header
          userName={user.name ?? "Gebruiker"}
          userEmail={user.email ?? ""}
          userRole={user.role}
          roleName={user.roleName ?? null}
          customerIds={user.customerIds ?? []}
        />
      }
    >
      {children}
    </AppShell>
  );
}
