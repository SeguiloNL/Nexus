"use client";

import Image from "next/image";
import { authenticate, type State } from "../actions";
import { useFormState } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const initialState: State = { message: null, errors: {} };

function LoginForm() {
  const [state, formAction] = useFormState(authenticate, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="email">E-mailadres</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="naam@voorbeeld.nl"
        />
        {state?.errors?.email ? (
          <p className="text-sm text-red-600">{state.errors.email[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Wachtwoord</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
        {state?.errors?.password ? (
          <p className="text-sm text-red-600">{state.errors.password[0]}</p>
        ) : null}
      </div>

      {state?.message ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-base text-red-700 md:text-sm md:py-2"
        >
          {state.message}
        </div>
      ) : null}

      <Button
        type="submit"
        className="w-full"
      >
        Inloggen
      </Button>
    </form>
  );
}

export default function LoginPage() {
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
          <h2 className="mb-5 text-lg font-semibold text-gray-900 sm:mb-6 sm:text-xl">
            Inloggen
          </h2>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Neem contact op met je beheerder voor accountgegevens.
        </p>
      </div>
    </div>
  );
}
