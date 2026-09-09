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

  return (
    <AppShell
      sidebar={<Sidebar userRole={session.user.role} />}
      header={
        <Header
          userName={session.user.name ?? "Gebruiker"}
          userEmail={session.user.email ?? ""}
          userRole={session.user.role}
        />
      }
    >
      {children}
    </AppShell>
  );
}
