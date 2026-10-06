"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFormState } from "react-dom";
import { resetPassword, type State } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: State = { message: null, errors: {}, messageType: null };

function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(resetPassword, initialState);
  const showForm = !state?.messageType || state.messageType === "error";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="space-y-2">
        <Label htmlFor="password">Nieuw wachtwoord</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Minimaal 8 tekens"
          aria-describedby={
            state?.errors?.password ? "password-error" : undefined
          }
        />
        {state?.errors?.password ? (
          <p id="password-error" className="text-sm text-red-600">
            {state.errors.password[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Bevestig nieuw wachtwoord</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Nogmaals invoeren"
          aria-describedby={
            state?.errors?.confirmPassword
              ? "confirm-password-error"
              : undefined
          }
        />
        {state?.errors?.confirmPassword ? (
          <p id="confirm-password-error" className="text-sm text-red-600">
            {state.errors.confirmPassword[0]}
          </p>
        ) : null}
      </div>

      {state?.message && showForm ? (
        <div
          role={state.messageType === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.messageType === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-3 text-base text-red-700 md:text-sm md:py-2"
              : "rounded-md border border-green-200 bg-green-50 px-3 py-3 text-base text-green-700 md:text-sm md:py-2"
          }
        >
          {state.message}
        </div>
      ) : null}

      <Button type="submit" className="w-full" aria-busy={false}>
        Wachtwoord opslaan
      </Button>
    </form>
  );
}

export function ResetPasswordClient() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token")?.trim() || "";

  const hasToken = Boolean(token);

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center bg-gray-50 px-4 py-10 sm:px-6 sm:py-12 lg:px-8 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(2.5rem+var(--safe-bottom))]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center sm:mb-8">
          <Image
            src="/nexus-logo-full.png"
            alt="STM logo"
            width={2172}
            height={724}
            priority
            className="h-14 w-auto object-contain sm:h-20"
          />
          <h1 className="mt-4 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            STM
          </h1>
        </div>

        <div className="rounded-xl bg-white px-5 py-6 shadow-sm ring-1 ring-gray-200 sm:px-6 sm:py-8">
          {hasToken ? (
            <>
              <h2 className="mb-1 text-lg font-semibold text-gray-900 sm:mb-2 sm:text-xl">
                Nieuw wachtwoord instellen
              </h2>
              <p className="mb-5 text-sm text-gray-600 sm:mb-6">
                Voer je nieuwe wachtwoord tweemaal in om je account te
                beveiligen.
              </p>
              <ResetPasswordForm token={token} />
            </>
          ) : (
            <>
              <h2 className="mb-3 text-lg font-semibold text-gray-900 sm:mb-4 sm:text-xl">
                Link ongeldig
              </h2>
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-base text-red-700 md:text-sm md:py-2"
              >
                Deze pagina is bereikt zonder geldige wachtwoord reset link.
                Controleer of je de complete link uit de e-mail hebt gekopieerd,
                of vraag een nieuwe link aan.
              </div>
              <div className="mt-6">
                <Link
                  href="/forgot-password"
                  className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Nieuwe herstel-link aanvragen
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Weer terug naar{" "}
          <Link
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-500 underline-offset-2 hover:underline"
          >
            inloggen
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
