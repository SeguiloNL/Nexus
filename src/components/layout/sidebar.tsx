"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
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
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMobileNav } from "@/components/layout/app-shell";
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
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

export function Sidebar({
  userRole,
  roleId,
  roleScope,
  permissions,
  mobileOpen: mobileOpenProp,
  onCloseMobile: onCloseMobileProp,
}: SidebarProps) {
  const pathname = usePathname();
  const navCtx = useMobileNav();
  const mobileOpen = mobileOpenProp ?? navCtx.mobileNavOpen;
  const onCloseMobile = onCloseMobileProp ?? navCtx.closeMobileNav;

  useEffect(() => {
    if (!onCloseMobile) return;
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMobile();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen, onCloseMobile]);

  function permissionsMeaningfulLocal(bits: PermissionBits | null): boolean {
    if (!bits) return false;
    for (const k of Object.keys(bits) as ResourceType[]) {
      const e = bits[k];
      if (e && (e.read || e.write)) return true;
    }
    return false;
  }

  function resolveCan(action: "view", resource: ResourceType): boolean {
    const meaningful = permissionsMeaningfulLocal(permissions);

    if (meaningful) {
      return canUserRole(permissions, action, resource);
    }

    if (roleId && canUserRole(roleId, action, resource)) {
      return true;
    }
    return canUserRole(userRole ?? null, action, resource);
  }

  function canAccessDashboard(): boolean {
    const meaningful = permissionsMeaningfulLocal(permissions);
    if (meaningful) {
      return canUserRole(permissions, "view", "dashboard");
    }
    if (roleId && canUserRole(roleId, "view", "dashboard")) return true;
    return canUserRole(userRole ?? null, "view", "dashboard");
  }

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
    if (item.resource === "dashboard") return canAccessDashboard();
    return resolveCan(item.action, item.resource as ResourceType);
  });

  const drawerBackdrop = onCloseMobile ? (
    <button
      type="button"
      aria-label="Menu sluiten"
      onClick={onCloseMobile}
      className={cn(
        "fixed inset-0 z-30 bg-slate-900/50 transition-opacity duration-200 md:hidden",
        mobileOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      )}
    />
  ) : null;

  return (
    <>
      {drawerBackdrop}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out md:static md:z-auto md:w-64 md:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-hidden={!mobileOpen && !onCloseMobile ? false : undefined}
      >
        <div className="flex min-h-[64px] md:h-20 items-center justify-between border-b border-slate-200 px-5 pt-[var(--safe-top)]">
          <Link
            href="/dashboard"
            onClick={onCloseMobile}
            className="flex min-h-[48px] items-center"
          >
            <Image
              src="/nexus-logo-full.png"
              alt="Nexus logo"
              width={2172}
              height={724}
              priority
              className="h-10 md:h-12 w-auto object-contain"
            />
          </Link>
          {onCloseMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onCloseMobile}
              aria-label="Menu sluiten"
              className="md:hidden"
            >
              <X className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 pb-[var(--safe-bottom)]">
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
                onClick={onCloseMobile}
                className={cn(
                  "flex min-h-[48px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors active:bg-slate-100",
                  active
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Icon className="h-5 w-5 md:h-4 md:w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
