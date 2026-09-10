"use client";

import { authenticate, type State } from "../actions";
import { useFormState } from "react-dom";

const initialState: State = { message: null, errors: {} };

function LoginForm() {
  const [state, formAction] = useFormState(authenticate, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700"
        >
          E-mailadres
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="naam@voorbeeld.nl"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        {state?.errors?.email ? (
          <p className="text-sm text-red-600">{state.errors.email[0]}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-700"
        >
          Wachtwoord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        {state?.errors?.password ? (
          <p className="text-sm text-red-600">{state.errors.password[0]}</p>
        ) : null}
      </div>

      {state?.message ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.message}
        </div>
      ) : null}

      <button
        type="submit"
        className="flex w-full justify-center rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50"
      >
        Inloggen
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Seguilo STM
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Basic Telematics Activation &amp; Subscription Manager
          </p>
        </div>

        <div className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-200">
          <h2 className="mb-6 text-xl font-semibold text-gray-900">
            Inloggen
          </h2>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          Neem contact op met je beheerder voor accountgegevens.
        </p>
        <p className="mt-2 text-center text-xs text-gray-400">
          Seed credentials (na db seeden): admin@seguilo.test / Test1234!
        </p>
      </div>
    </div>
  );
}
