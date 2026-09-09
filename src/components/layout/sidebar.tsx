"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Box,
  CreditCard,
  Car,
  Receipt,
  ClipboardList,
  FileKey2,
  History,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/enums";
import { canUserRole } from "@/lib/auth/session";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  action: "view";
  resource: "dashboard" | "customer" | "tracker" | "sim" | "vehicle" | "product" | "subscription" | "activation_order" | "user" | "audit_log" | "setting";
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    action: "view",
    resource: "dashboard",
  },
  { label: "Klanten", href: "/customers", icon: Users, action: "view", resource: "customer" },
  {
    label: "Trackers",
    href: "/trackers",
    icon: Box,
    action: "view",
    resource: "tracker",
  },
  {
    label: "SIM-kaarten",
    href: "/sims",
    icon: CreditCard,
    action: "view",
    resource: "sim",
  },
  {
    label: "Voertuigen",
    href: "/vehicles",
    icon: Car,
    action: "view",
    resource: "vehicle",
  },
  {
    label: "Producten",
    href: "/products",
    icon: FileKey2,
    action: "view",
    resource: "product",
  },
  {
    label: "Abonnementen",
    href: "/subscriptions",
    icon: Receipt,
    action: "view",
    resource: "subscription",
  },
  {
    label: "Activaties",
    href: "/activations",
    icon: ClipboardList,
    action: "view",
    resource: "activation_order",
  },
  {
    label: "Gebruikers",
    href: "/users",
    icon: Users,
    action: "view",
    resource: "user",
  },
  {
    label: "Auditlog",
    href: "/audit-log",
    icon: History,
    action: "view",
    resource: "audit_log",
  },
  {
    label: "Instellingen",
    href: "/settings",
    icon: Settings,
    action: "view",
    resource: "setting",
  },
];

type SidebarProps = {
  userRole: UserRole | null | undefined;
};

function DashboardNavItem() {
  // speciaal geval: dashboard is altijd zichtbaar
  return { action: "view" as const, resource: "customer" as const };
}

export function Sidebar({ userRole }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) => {
    // Dashboard is altijd zichtbaar voor ingelogden
    if (item.resource === "dashboard") return true;
    // Overige items via RBAC canUserRole
    const perm = DashboardNavItem();
    return canUserRole(userRole, item.action, item.resource as never);
  });

  return (
    <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white md:block">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white font-bold">
          S
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">
            Seguilo STM
          </div>
          <div className="text-[11px] text-slate-500 leading-tight">
            Telematics Manager
          </div>
        </div>
      </div>
      <nav className="space-y-1 px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
