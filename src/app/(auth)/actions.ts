"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { LoginSchema } from "@/server/validators/user";

export type State = {
  errors?: {
    email?: string[];
    password?: string[];
  };
  message?: string | null;
};

export async function authenticate(
  prevState: State,
  formData: FormData
): Promise<State> {
  const validatedFields = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Controleer je gegevens.",
    };
  }

  try {
    // In useFormState Server Actions gooit signIn() GEEN NEXT_REDIRECT,
    // dus: redirect: false, daarna zelf redirect() aanroepen.
    const signInResult = await signIn("credentials", {
      email: validatedFields.data.email,
      password: validatedFields.data.password,
      redirect: false,
    });
    // signIn() met redirect: false geeft bij succes: null, bij AuthError: throw.
    // Dus: als we hier komen → login SUCCES.
    if (signInResult && typeof signInResult === "object" && "error" in signInResult) {
      return {
        message: `signIn() error: ${JSON.stringify(signInResult).slice(0, 200)}`,
      };
    }
  } catch (error) {
    // Next.js redirect() / Auth.js NEXT_REDIRECT: doorgooien (geen error!)
    const strError = String(error);
    const isNextRedirect =
      (error instanceof Error && "digest" in error) ||
      strError.includes("NEXT_REDIRECT") ||
      strError.includes("DIGEST");
    if (isNextRedirect) {
      throw error;
    }
    if (error instanceof AuthError) {
      return {
        message: `AuthError type=${error.type || "?"} — ${error.message || "Geen details"}`,
      };
    }
    return {
      message: `signIn() fail: [${error instanceof Error ? error.name : typeof error}] ${strError.slice(0, 250)}`,
    };
  }

  // We komen hier ALLEEN als login SUCCES was (geen throw).
  redirect("/dashboard");
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
