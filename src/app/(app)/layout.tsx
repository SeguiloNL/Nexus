import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

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
          userName={session.user.name ?? "Gebruiker"}
          userEmail={session.user.email ?? ""}
          userRole={session.user.role}
          roleName={user.roleName ?? null}
          customerIds={user.customerIds ?? []}
        />
      }
    >
      {children}
    </AppShell>
  );
}
