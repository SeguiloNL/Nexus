"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  Database,
  Boxes,
  ChevronDown,
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
    | "data_plan"
    | "subscription"
    | "invoice"
    | "activation_order"
    | "user"
    | "audit_log"
    | "setting"
    | "role";
};

type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

// Losse, altijd direct bereikbare hoofdentree (0 extra clicks).
const DASHBOARD_ITEM: NavItem = {
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  action: "view",
  resource: "dashboard",
};

// Maximaal 6 sub-items per categorie; standaard ingeklapt weergegeven.
const NAV_GROUPS: NavGroup[] = [
  {
    id: "klantbeheer",
    label: "Klantbeheer",
    icon: Users,
    items: [
      {
        label: "Klanten",
        href: "/customers",
        icon: Users,
        action: "view",
        resource: "customer",
      },
      {
        label: "Voertuigen",
        href: "/vehicles",
        icon: Car,
        action: "view",
        resource: "vehicle",
      },
      {
        label: "Trackers",
        href: "/trackers",
        icon: Box,
        action: "view",
        resource: "tracker",
      },
    ],
  },
  {
    id: "sim-data",
    label: "SIM & Data",
    icon: CreditCard,
    items: [
      {
        label: "SIM-kaarten",
        href: "/sims",
        icon: CreditCard,
        action: "view",
        resource: "sim",
      },
      {
        label: "Dataplannen",
        href: "/data-plans",
        icon: Database,
        action: "view",
        resource: "data_plan",
      },
      {
        label: "Activaties",
        href: "/activations",
        icon: ClipboardList,
        action: "view",
        resource: "activation_order",
      },
    ],
  },
  {
    id: "commercieel",
    label: "Commercieel",
    icon: Receipt,
    items: [
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
    ],
  },
  {
    id: "beheer",
    label: "Beheer",
    icon: Shield,
    items: [
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
        label: "Leveranciers",
        href: "/admin/providers",
        icon: Boxes,
        action: "view",
        resource: "setting",
      },
      {
        label: "Instellingen",
        href: "/settings",
        icon: Settings,
        action: "view",
        resource: "setting",
      },
      {
        label: "Auditlog",
        href: "/audit-log",
        icon: History,
        action: "view",
        resource: "audit_log",
      },
    ],
  },
];

// Resources die een CUSTOMER-scope gebruiker mag zien.
const CUSTOMER_ALLOWED_RESOURCES: ResourceType[] = [
  "dashboard",
  "customer",
  "tracker",
  "sim",
  "vehicle",
  "subscription",
  "invoice",
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

  function canViewItem(item: NavItem): boolean {
    if (roleScope === "CUSTOMER") {
      if (!CUSTOMER_ALLOWED_RESOURCES.includes(item.resource as ResourceType)) {
        return false;
      }
    }
    if (item.resource === "dashboard") return canAccessDashboard();
    return resolveCan(item.action, item.resource as ResourceType);
  }

  function isItemActive(href: string): boolean {
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  const showDashboard = canViewItem(DASHBOARD_ITEM);

  // Lege categorieën (geen zichtbare items voor deze rol) worden volledig verborgen.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(canViewItem),
  })).filter((group) => group.items.length > 0);

  const activeGroupId =
    visibleGroups.find((group) => group.items.some((item) => isItemActive(item.href)))?.id ?? null;

  // Categorieën starten ingeklapt; de categorie met de actieve pagina is geopend
  // zodat de gebruiker direct ziet waar hij/zij zich bevindt.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    activeGroupId ? { [activeGroupId]: true } : {}
  );

  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroups((prev) =>
      prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true }
    );
  }, [activeGroupId]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

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
        <nav
          aria-label="Hoofdnavigatie"
          className="flex-1 space-y-1 overflow-y-auto px-3 py-4 pb-[var(--safe-bottom)]"
        >
          {showDashboard ? (
            <Link
              href={DASHBOARD_ITEM.href}
              onClick={onCloseMobile}
              aria-current={isItemActive(DASHBOARD_ITEM.href) ? "page" : undefined}
              className={cn(
                "flex min-h-[48px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors active:bg-slate-100",
                isItemActive(DASHBOARD_ITEM.href)
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <LayoutDashboard className="h-5 w-5 md:h-4 md:w-4 shrink-0" />
              <span className="flex-1">{DASHBOARD_ITEM.label}</span>
            </Link>
          ) : null}

          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const open = !!openGroups[group.id];
            const groupActive = group.items.some((item) => isItemActive(item.href));
            const panelId = `nav-panel-${group.id}`;
            const toggleId = `nav-toggle-${group.id}`;
            return (
              <div key={group.id}>
                <button
                  type="button"
                  id={toggleId}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    "flex min-h-[48px] w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 active:bg-slate-100",
                    groupActive ? "text-slate-900" : "text-slate-600"
                  )}
                >
                  <GroupIcon className="h-5 w-5 md:h-4 md:w-4 shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200 ease-out",
                      open ? "rotate-180" : "rotate-0"
                    )}
                  />
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={toggleId}
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div
                    className={cn(
                      "overflow-hidden transition-[visibility] duration-200",
                      open ? "visible" : "invisible"
                    )}
                  >
                    <ul className="mt-1 space-y-1">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isItemActive(item.href);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={onCloseMobile}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex min-h-[48px] items-center gap-3 rounded-md py-0 pl-9 pr-3 text-sm font-medium transition-colors active:bg-slate-100",
                                active
                                  ? "bg-slate-100 text-slate-900"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              )}
                            >
                              <Icon className="h-5 w-5 md:h-4 md:w-4 shrink-0" />
                              <span className="flex-1">{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
