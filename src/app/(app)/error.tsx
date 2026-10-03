"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShieldAlert, ArrowLeft, Mail, LogOut, RefreshCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppErrorBoundary] Onverwachte fout:", error);
  }, [error]);

  const isPermissionError =
    error.name === "PermissionError" ||
    (typeof error.message === "string" &&
      (error.message.includes("Onvoldoende rechten") ||
        error.message.includes("mag") && error.message.includes("niet") ||
        error.message.includes("toegang") && error.message.includes("niet")));

  if (isPermissionError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center">
            <Image
              src="/nexus-logo-full.png"
              alt="Nexus logo"
              width={2172}
              height={724}
              priority
              className="h-16 w-auto object-contain"
            />
          </div>

          <div
            role="alert"
            aria-live="polite"
            aria-labelledby="error-403-heading"
            className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-200"
          >
            <div className="flex flex-col items-center text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100" aria-hidden="true">
                <ShieldAlert className="h-8 w-8 text-red-600" />
              </div>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-600">
                Onvoldoende rechten
              </p>

              <h1
                id="error-403-heading"
                className="text-2xl font-bold tracking-tight text-gray-900"
              >
                Geen toegang tot deze pagina
              </h1>

              <p className="mt-4 text-base text-gray-600 leading-relaxed">
                Je hebt niet de benodigde rechten om deze pagina te bekijken.
                Neem contact op met je beheerder als je denkt dat dit
                onterecht is.
              </p>

              <div className="mt-8 flex w-full flex-col gap-3">
                <Button
                  asChild
                  variant="success"
                  className="w-full justify-center"
                >
                  <Link href="/dashboard">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Terug naar dashboard
                  </Link>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-center"
                >
                  <a
                    href="mailto:support@seguilo.nl?subject=Toegang%20aanvragen%20Nexus&body=Hallo,%0D%0A%0D%0AIk%20zou%20graag%20extra%20toegang%20willen%20voor%20de%20Nexus%20applicatie.%0D%0A%0D%0AMijn%20account:%20[vul%20hier%20je%20e-mailadres%20in]%0D%0A%0D%0AGewenste%20toegang:%20[omschrijf%20welke%20pagina%20of%20functionaliteit%20je%20nodig%20hebt]%0D%0A%0D%0AMet%20vriendelijke%20groet,"
                    aria-label="Contact opnemen met applicatiebeheerder via e-mail"
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    Contact opnemen met beheerder
                  </a>
                </Button>
              </div>

              <div className="mt-6">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 underline-offset-4 hover:text-gray-800 hover:underline"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Uitloggen / andere gebruiker
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <Image
            src="/nexus-logo-full.png"
            alt="Nexus logo"
            width={2172}
            height={724}
            priority
            className="h-16 w-auto object-contain"
          />
        </div>

        <div
          role="alert"
          aria-live="assertive"
          aria-labelledby="error-generic-heading"
          className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-200"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100" aria-hidden="true">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>

            <h1
              id="error-generic-heading"
              className="text-2xl font-bold tracking-tight text-gray-900"
            >
              Er ging iets mis
            </h1>

            <p className="mt-4 text-base text-gray-600 leading-relaxed">
              Er trad een onverwachte fout op tijdens het laden van deze
              pagina. Probeer het opnieuw of neem contact op met je
              beheerder als het probleem aanhoudt.
            </p>

            {typeof error.message === "string" && error.message.length > 0 ? (
              <div className="mt-5 w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-left">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Technische details
                </p>
                <p className="mt-1 font-mono text-xs text-gray-600 break-words">
                  {error.message}
                </p>
              </div>
            ) : null}

            <div className="mt-8 flex w-full flex-col gap-3">
              <Button
                onClick={reset}
                variant="default"
                className="w-full justify-center"
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                Opnieuw proberen
              </Button>

              <Button
                asChild
                variant="outline"
                className="w-full justify-center"
              >
                <Link href="/dashboard">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Terug naar dashboard
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
