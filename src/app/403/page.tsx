import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldAlert
            className="h-8 w-8 text-red-600"
            aria-hidden="true"
          />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          403 - Toegang geweigerd
        </h1>
        <p className="mt-4 text-base text-gray-600">
          Je hebt onvoldoende rechten om deze pagina te bekijken of deze actie
          uit te voeren. Neem contact op met je beheerder als je denkt dat dit
          onterecht is.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="inline-flex justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500"
          >
            Terug naar dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex justify-center text-sm text-gray-600 hover:text-gray-900"
          >
            Uitloggen / andere gebruiker
          </Link>
        </div>
      </div>
    </div>
  );
}
