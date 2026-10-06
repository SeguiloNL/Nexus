"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import {
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from "@/server/validators/user";
import {
  createAndSendPasswordResetToken,
  consumePasswordResetToken,
  passwordResetTokenErrorToMessage,
} from "@/server/services/password-reset.service";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";

export type State = {
  errors?: {
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
    token?: string[];
  };
  message?: string | null;
  /** "error" | "success" | null – om styling te differentiëren */
  messageType?: "error" | "success" | null;
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

export async function requestPasswordReset(
  prevState: State,
  formData: FormData
): Promise<State> {
  const validatedFields = ForgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Controleer je gegevens.",
      messageType: "error",
    };
  }

  try {
    const result = await createAndSendPasswordResetToken(
      validatedFields.data.email
    );

    if (result.error) {
      console.warn(
        `[password-reset] create token warning voor ${validatedFields.data.email}: ${result.error}`
      );
    }

    return {
      message: result.message,
      messageType: "success",
    };
  } catch (error) {
    const strError = String(error);
    const isNextRedirect =
      (error instanceof Error && "digest" in error) ||
      strError.includes("NEXT_REDIRECT") ||
      strError.includes("DIGEST");
    if (isNextRedirect) {
      throw error;
    }
    console.error("[password-reset] requestPasswordReset error:", error);
    return {
      message:
        "Als dit e-mailadres bij ons bekend is, ontvangt u een e-mail met instructies om uw wachtwoord te herstellen.",
      messageType: "success",
    };
  }
}

export async function resetPassword(
  prevState: State,
  formData: FormData
): Promise<State> {
  const validatedFields = ResetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Controleer je gegevens.",
      messageType: "error",
    };
  }

  try {
    const consumeResult = await consumePasswordResetToken(
      validatedFields.data.token
    );

    if (!consumeResult.ok || !consumeResult.userId) {
      return {
        message: passwordResetTokenErrorToMessage(consumeResult.error),
        messageType: "error",
      };
    }

    const newHash = await hashPassword(validatedFields.data.password);

    await prisma.user.update({
      where: { id: consumeResult.userId },
      data: { passwordHash: newHash },
      select: { id: true },
    });
  } catch (error) {
    const strError = String(error);
    const isNextRedirect =
      (error instanceof Error && "digest" in error) ||
      strError.includes("NEXT_REDIRECT") ||
      strError.includes("DIGEST");
    if (isNextRedirect) {
      throw error;
    }
    console.error("[password-reset] resetPassword error:", error);
    return {
      message:
        "Er is iets misgegaan bij het wijzigen van je wachtwoord. Probeer het opnieuw of vraag een nieuwe link aan.",
      messageType: "error",
    };
  }

  redirect("/login?reset=success");
}
