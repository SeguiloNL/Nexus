"use client";

import Image from "next/image";
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
  FileText,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole, RoleScope, ResourceType } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth.d";
import { canUserRole } from "@/lib/auth/session";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  action: "view";
  resource:
    | "dashboard"
    | "customer"
    | "tracker"
    | "sim"
    | "vehicle"
    | "product"
    | "subscription"
    | "invoice"
    | "activation_order"
    | "user"
    | "audit_log"
    | "setting"
    | "role";
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    action: "view",
    resource: "dashboard",
  },
  {
    label: "Klanten",
    href: "/customers",
    icon: Users,
    action: "view",
    resource: "customer",
  },
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
    label: "Facturen",
    href: "/invoices",
    icon: FileText,
    action: "view",
    resource: "invoice",
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
    label: "Rollen",
    href: "/roles",
    icon: Shield,
    action: "view",
    resource: "role",
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
  roleId: string | null;
  roleScope: RoleScope | null;
  permissions: PermissionBits | null;
};

export function Sidebar({
  userRole,
  roleId: _roleId,
  roleScope,
  permissions,
}: SidebarProps) {
  const pathname = usePathname();

  let authzArg: PermissionBits | UserRole | string | null = null;
  if (permissions) {
    let meaningful = false;
    outer: for (const k of Object.keys(permissions) as Array<keyof PermissionBits>) {
      const e = (permissions as any)[k];
      if (e && (e.read || e.write)) {
        meaningful = true;
        break outer;
      }
    }
    if (meaningful) authzArg = permissions;
  }
  if (!authzArg && userRole) authzArg = userRole;
  if (!authzArg && _roleId) authzArg = _roleId;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (roleScope === "CUSTOMER") {
      if (
        item.resource !== "dashboard" &&
        item.resource !== "customer" &&
        item.resource !== "tracker" &&
        item.resource !== "sim" &&
        item.resource !== "vehicle" &&
        item.resource !== "subscription" &&
        item.resource !== "invoice"
      ) {
        return false;
      }
    }
    if (item.resource === "dashboard") return true;
    return canUserRole(authzArg, item.action, item.resource as ResourceType);
  });

  return (
    <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white md:block">
      <div className="flex h-20 items-center border-b border-slate-200 px-5">
        <Image
          src="/nexus-logo-full.png"
          alt="Nexus logo"
          width={2172}
          height={724}
          priority
          className="h-12 w-auto object-contain"
        />
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
