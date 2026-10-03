import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ShieldAlert, ArrowLeft, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Toegang geweigerd | Nexus",
  robots: { index: false, follow: false },
};

export default function ForbiddenPage() {
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
          aria-labelledby="forbidden-heading"
          className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-200"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100" aria-hidden="true">
              <ShieldAlert className="h-8 w-8 text-red-600" />
            </div>

            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-600">
              Foutcode 403
            </p>

            <h1
              id="forbidden-heading"
              className="text-2xl font-bold tracking-tight text-gray-900"
            >
              Geen toegang tot deze pagina
            </h1>

            <p className="mt-4 text-base text-gray-600 leading-relaxed">
              Je hebt niet de benodigde rechten om deze pagina te bekijken of
              deze actie uit te voeren. Dit is geen technische storing — je
              account heeft eenvoudigweg onvoldoende machtigingen.
            </p>

            <div className="mt-6 w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-left">
              <p className="text-sm font-medium text-gray-700">
                Wat kun je nu doen?
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
                    aria-hidden="true"
                  />
                  <span>
                    Teruggaan naar de startpagina en een andere pagina
                    proberen
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
                    aria-hidden="true"
                  />
                  <span>
                    Contact opnemen met je applicatiebeheerder om extra
                    toegang aan te vragen
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span
                    className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
                    aria-hidden="true"
                  />
                  <span>
                    Indien nodig uitloggen en met een ander account
                    aanmelden
                  </span>
                </li>
              </ul>
            </div>

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

        <p className="mt-6 text-center text-xs text-gray-500">
          Geen e-mailclient geconfigureerd? Neem dan contact op via
          support@seguilo.nl
        </p>
      </div>
    </div>
  );
}
