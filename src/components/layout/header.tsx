"use client";

import Link from "next/link";
import { useEffect, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  UserCircle,
  Shield,
  Search,
  User,
  Menu,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMobileNav } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/enums";
import { logoutAction } from "@/app/(app)/actions";

type HeaderProps = {
  userName: string;
  userEmail: string;
  userRole: UserRole;
  roleName?: string | null;
  customerIds?: string[];
  onMenuClick?: () => void;
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Beheerder",
  EMPLOYEE: "Medewerker",
  VIEWER: "Alleen-lezen",
};

const LEGACY_ROLE_VALUES = ["ADMIN", "EMPLOYEE", "VIEWER"];

function resolveRoleDisplay(
  userRole: UserRole,
  roleName: string | null | undefined
): string {
  if (
    roleName &&
    typeof roleName === "string" &&
    roleName.trim().length > 0 &&
    roleName !== "UNKNOWN" &&
    !LEGACY_ROLE_VALUES.includes(roleName)
  ) {
    return roleName;
  }
  return ROLE_LABELS[userRole] ?? "Gebruiker";
}

const ROLE_VARIANT: Record<UserRole, "success" | "info" | "muted"> = {
  ADMIN: "success",
  EMPLOYEE: "info",
  VIEWER: "muted",
};

export function Header({
  userName,
  userEmail,
  userRole,
  roleName,
  customerIds,
  onMenuClick: onMenuClickProp,
}: HeaderProps) {
  const router = useRouter();
  const navCtx = useMobileNav();
  const onMenuClick = onMenuClickProp ?? navCtx.toggleMobileNav;
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [router]);

  const initials = userName
    ? userName
        .split(" ")
        .map((p) => p.charAt(0).toUpperCase())
        .slice(0, 2)
        .join("")
    : "??";

  const handleLogout = () => {
    setMenuOpen(false);
    startTransition(async () => {
      try {
        await logoutAction();
      } catch (err) {
        const str = String(err);
        if (
          str.includes("NEXT_REDIRECT") ||
          (err instanceof Error && "digest" in err)
        ) {
          return;
        }
        router.push("/login");
      }
    });
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 min-h-[64px] items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-6 pt-[var(--safe-top)]">
      <div className="flex items-center gap-2 min-w-0">
        {onMenuClick ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMenuClick}
            aria-label="Menu openen"
            aria-controls="primary-navigation"
            className="md:hidden shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          asChild
          className="md:hidden shrink-0"
        >
          <Link href="/search" aria-label="Zoeken">
            <Search className="h-5 w-5" />
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="hidden md:flex shrink-0"
          asChild
        >
          <Link href="/search">
            <Search className="h-4 w-4" />
            <span className="ml-1">Zoeken</span>
            <kbd className="ml-3 hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline">
              ⌘K
            </kbd>
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Badge
          variant={ROLE_VARIANT[userRole]}
          className="hidden sm:inline-flex"
        >
          <Shield className="mr-1 h-3 w-3" />
          {resolveRoleDisplay(userRole, roleName)}
        </Badge>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 gap-2 px-2 focus:ring-0"
              aria-label="Profielmenu openen"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                  userRole === "ADMIN"
                    ? "bg-emerald-100 text-emerald-700"
                    : userRole === "EMPLOYEE"
                      ? "bg-sky-100 text-sky-700"
                      : "bg-slate-200 text-slate-700"
                )}
              >
                {initials}
              </span>
              <div className="hidden text-left sm:block">
                <div className="text-sm font-medium leading-tight">
                  {userName || "Gebruiker"}
                </div>
                <div className="text-xs text-slate-500 leading-tight">
                  {userEmail}
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {userName || "Gebruiker"}
                </p>
                <p className="text-xs leading-none text-slate-500">
                  {userEmail}
                </p>
                <div className="mt-1 text-[11px] leading-none">
                  <Badge variant={ROLE_VARIANT[userRole]}>
                    {resolveRoleDisplay(userRole, roleName)}
                  </Badge>
                </div>
                {customerIds && customerIds.length > 0 ? (
                  <p className="mt-1 text-[11px] leading-none text-slate-500">
                    {customerIds.length === 1
                      ? `1 klant-scope`
                      : `${customerIds.length} klant-scopes`}
                  </p>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>
                <UserCircle className="h-4 w-4" />
                Profiel
              </DropdownMenuItem>
              {userRole === "ADMIN" ? (
                <DropdownMenuItem asChild>
                  <Link href="/users">
                    <User className="h-4 w-4" />
                    Gebruikers beheren
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {userRole === "ADMIN" ? (
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Shield className="h-4 w-4" />
                    Instellingen
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={isPending}
              className="text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer data-[disabled]:pointer-events-auto data-[disabled]:opacity-70"
              role="menuitem"
              aria-busy={isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isPending ? "Uitloggen…" : "Uitloggen"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
