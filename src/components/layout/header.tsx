"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  UserCircle,
  Shield,
  Search,
  User,
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
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/enums";
import { logoutAction } from "@/app/(app)/actions";

type HeaderProps = {
  userName: string;
  userEmail: string;
  userRole: UserRole;
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Beheerder",
  EMPLOYEE: "Medewerker",
  VIEWER: "Alleen-lezen",
};

const ROLE_VARIANT: Record<UserRole, "success" | "info" | "muted"> = {
  ADMIN: "success",
  EMPLOYEE: "info",
  VIEWER: "muted",
};

export function Header({ userName, userEmail, userRole }: HeaderProps) {
  const router = useRouter();

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

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="hidden md:flex"
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
          {ROLE_LABELS[userRole]}
        </Badge>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 gap-2 px-2 focus:ring-0"
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
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {userName || "Gebruiker"}
                </p>
                <p className="text-xs leading-none text-slate-500">
                  {userEmail}
                </p>
                <p className="mt-1 text-[11px] leading-none">
                  <Badge variant={ROLE_VARIANT[userRole]}>
                    {ROLE_LABELS[userRole]}
                  </Badge>
                </p>
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
            <form action={logoutAction}>
              <DropdownMenuItem asChild>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 focus:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Uitloggen
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
