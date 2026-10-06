import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  sendPasswordResetEmail,
  type EmailSendResult,
} from "@/server/services/email.service";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_RATE_LIMIT_MS = 15 * 60 * 1000;

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export interface CreateTokenResult {
  ok: boolean;
  emailSent: boolean;
  /**
   * Altijd generiek om user enumeration te voorkomen:
   * "Als dit e-mailadres bij ons bekend is, ontvangt u een e-mail met instructies."
   */
  message: string;
  emailResult?: EmailSendResult;
  error?: string;
}

export async function createAndSendPasswordResetToken(
  rawEmail: string
): Promise<CreateTokenResult> {
  const email = rawEmail.trim().toLowerCase();
  const genericMessage =
    "Als dit e-mailadres bij ons bekend is, ontvangt u een e-mail met instructies om uw wachtwoord te herstellen.";

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isActive: true },
    });

    if (!user || user.isActive === false) {
      return {
        ok: false,
        emailSent: false,
        message: genericMessage,
      };
    }

    const rateLimitCutoff = new Date(Date.now() - TOKEN_RATE_LIMIT_MS);
    const recentToken = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: rateLimitCutoff },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    if (recentToken) {
      return {
        ok: false,
        emailSent: false,
        message: genericMessage,
      };
    }

    const rawBytes = crypto.randomBytes(32);
    const plainToken = bytesToBase64Url(rawBytes);
    const tokenHash = sha256Hex(plainToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          OR: [
            { expiresAt: { lt: new Date() } },
            { usedAt: { not: null } },
          ],
        },
      }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
        select: { id: true },
      }),
    ]);

    const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(plainToken)}`;

    const emailResult = await sendPasswordResetEmail({
      toEmail: user.email,
      toName: user.name || "gebruiker",
      resetUrl,
      expiresAt,
    });

    if (!emailResult.dryRun && emailResult.error) {
      return {
        ok: false,
        emailSent: false,
        message: genericMessage,
        emailResult,
        error: `SMTP fout: ${emailResult.error}`,
      };
    }

    return {
      ok: true,
      emailSent: emailResult.dryRun ? false : true,
      message: genericMessage,
      emailResult,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      emailSent: false,
      message: genericMessage,
      error: err,
    };
  }
}

export interface ConsumeTokenResult {
  ok: boolean;
  userId?: string;
  userEmail?: string;
  error?: "expired" | "used" | "invalid" | "unknown";
}

export async function consumePasswordResetToken(
  plainToken: string
): Promise<ConsumeTokenResult> {
  if (!plainToken || typeof plainToken !== "string") {
    return { ok: false, error: "invalid" };
  }

  const tokenHash = sha256Hex(plainToken.trim());

  try {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { email: true, isActive: true } },
      },
    });

    if (!record) {
      return { ok: false, error: "invalid" };
    }
    if (!record.user || record.user.isActive === false) {
      return { ok: false, error: "invalid" };
    }
    if (record.usedAt) {
      return { ok: false, error: "used" };
    }
    if (record.expiresAt.getTime() < Date.now()) {
      return { ok: false, error: "expired" };
    }

    await prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
      select: { id: true },
    });

    return {
      ok: true,
      userId: record.userId,
      userEmail: record.user.email,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "unknown", userId: undefined, userEmail: err };
  }
}

export function passwordResetTokenErrorToMessage(
  err: ConsumeTokenResult["error"]
): string {
  switch (err) {
    case "expired":
      return "Deze wachtwoord reset link is verlopen. Vraag een nieuwe link aan.";
    case "used":
      return "Deze wachtwoord reset link is al gebruikt. Vraag een nieuwe link aan.";
    case "invalid":
      return "Deze wachtwoord reset link is ongeldig. Controleer de link of vraag een nieuwe aan.";
    case "unknown":
    default:
      return "Er is iets misgegaan bij het verwerken van de reset link. Probeer het opnieuw.";
  }
}
