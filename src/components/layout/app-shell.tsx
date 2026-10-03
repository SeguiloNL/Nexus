"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Toaster } from "@/components/ui/sonner";

type AppShellProps = {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
};

type MobileNavContextValue = {
  mobileNavOpen: boolean;
  toggleMobileNav: () => void;
  closeMobileNav: () => void;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    return { mobileNavOpen: false, toggleMobileNav: () => {}, closeMobileNav: () => {} };
  }
  return ctx;
}

export function AppShell({ sidebar, header, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const toggleMobileNav = useCallback(() => {
    setMobileNavOpen((prev) => !prev);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const ctxValue = useMemo<MobileNavContextValue>(
    () => ({ mobileNavOpen, toggleMobileNav, closeMobileNav }),
    [mobileNavOpen, toggleMobileNav, closeMobileNav]
  );

  return (
    <MobileNavContext.Provider value={ctxValue}>
      <div className="flex min-h-screen min-h-[100dvh] bg-slate-50 text-slate-900">
        {sidebar}
        <div className="flex min-h-screen min-h-[100dvh] flex-1 flex-col">
          {header}
          <main className="flex-1 px-3 py-6 sm:px-6 lg:px-8 pb-[var(--safe-bottom)]">
            {children}
          </main>
        </div>
        <Toaster
          position="top-center"
          toastOptions={{
            className: "!max-w-[calc(100vw-2rem)] sm:!max-w-md",
          }}
        />
      </div>
    </MobileNavContext.Provider>
  );
}
