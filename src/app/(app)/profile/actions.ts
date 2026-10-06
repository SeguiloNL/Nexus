"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { SaveNotificationSettingsSchema } from "@/server/validators/user";
import { NotificationChannel, type AlertThresholdLevel } from "@prisma/client";
import { PermissionError } from "@/lib/rbac";
import {
  sendTestEmail,
  formatSmtpErrorForUser,
  renderSmtpErrorPlain,
} from "@/server/services/email.service";
import { getSmtpSettings } from "@/server/services/app-setting.service";

export async function getMyNotificationSettingsAction() {
  const user = await requireUser();
  const row = await prisma.userNotificationSettings.findUnique({
    where: { userId: user.id },
  });
  const roleScope = (user.roleScope as "INTERNAL" | "CUSTOMER" | "RESELLER" | "PARTNER" | undefined) ?? null;
  if (row) {
    return {
      enabledEmail: row.enabledEmail,
      enabledDataThresholdAlert: row.enabledDataThresholdAlert,
      dataThresholdPercent: row.dataThresholdPercent,
      notifyAllSims: roleScope === "INTERNAL" ? row.notifyAllSims : false,
      lastNotificationAt: row.lastNotificationAt ?? null,
      _roleScope: roleScope,
    };
  }
  return {
    enabledEmail: true,
    enabledDataThresholdAlert: true,
    dataThresholdPercent: 80,
    notifyAllSims: false,
    lastNotificationAt: null,
    _roleScope: roleScope,
  };
}

export async function saveNotificationSettingsAction(form: FormData) {
  const user = await requireUser();

  const payload = {
    enabledEmail: form.get("enabledEmail") === "on",
    enabledDataThresholdAlert: form.get("enabledDataThresholdAlert") === "on",
    dataThresholdPercent: Number(form.get("dataThresholdPercent") ?? 80),
    notifyAllSims: form.get("notifyAllSims") === "on",
  };

  const validated = SaveNotificationSettingsSchema.parse(payload);

  const roleScope = (user.roleScope as
    | "INTERNAL"
    | "CUSTOMER"
    | "RESELLER"
    | "PARTNER"
    | undefined) ?? null;

  let finalNotifyAllSims = validated.notifyAllSims;
  if (finalNotifyAllSims && roleScope !== "INTERNAL") {
    throw new PermissionError(
      "notifyAllSims mag alleen ingeschakeld worden door interne beheerders."
    );
  }

  const saved = await prisma.userNotificationSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      enabledEmail: validated.enabledEmail,
      enabledDataThresholdAlert: validated.enabledDataThresholdAlert,
      dataThresholdPercent: validated.dataThresholdPercent,
      notifyAllSims: finalNotifyAllSims,
      channels: { set: [NotificationChannel.EMAIL] },
    },
    update: {
      enabledEmail: validated.enabledEmail,
      enabledDataThresholdAlert: validated.enabledDataThresholdAlert,
      dataThresholdPercent: validated.dataThresholdPercent,
      notifyAllSims: finalNotifyAllSims,
      channels: { set: [NotificationChannel.EMAIL] },
    },
  });

  return {
    ok: true,
    settings: {
      enabledEmail: saved.enabledEmail,
      enabledDataThresholdAlert: saved.enabledDataThresholdAlert,
      dataThresholdPercent: saved.dataThresholdPercent,
      notifyAllSims: roleScope === "INTERNAL" ? saved.notifyAllSims : false,
    },
  };
}

export async function sendTestNotificationEmailAction(): Promise<{
  ok: boolean;
  message: string;
  dryRun?: boolean;
}> {
  const user = await requireUser();

  if (!user.email) {
    return {
      ok: false,
      message:
        "Uw account heeft geen e-mailadres ingesteld. Voeg eerst een e-mailadres toe aan uw profiel.",
    };
  }

  let smtpCtx: { host?: string; from?: string } = {};
  try {
    const s = await getSmtpSettings();
    if (s) {
      smtpCtx = { host: s.host, from: s.from };
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await sendTestEmail(user.email);
    if (result.dryRun) {
      return {
        ok: false,
        message:
          result.error ||
          "SMTP is niet geconfigureerd. Stel eerst de SMTP-instellingen in via Systeem → Instellingen.",
        dryRun: true,
      };
    }
    if (result.error || result.rejected.length > 0) {
      const raw =
        result.error ||
        (result.rejected.length > 0
          ? `Test e-mail kon niet worden afgeleverd bij ${result.rejected.join(", ")}.`
          : "Onbekende SMTP fout.");
      const friendly = formatSmtpErrorForUser(raw, {
        ...smtpCtx,
        to: user.email,
      });
      return {
        ok: false,
        message: renderSmtpErrorPlain(friendly),
      };
    }
    if (result.accepted.length > 0) {
      return {
        ok: true,
        message: `Test e-mail succesvol verzonden naar ${user.email}. Controleer uw inbox (en spamfolder).`,
      };
    }
    return {
      ok: false,
      message: "Onbekende fout bij het verzenden van de test e-mail.",
    };
  } catch (e: any) {
    const raw = e?.message || "Onbekende fout bij het verzenden van de test e-mail.";
    const friendly = formatSmtpErrorForUser(raw, {
      ...smtpCtx,
      to: user.email,
    });
    return { ok: false, message: renderSmtpErrorPlain(friendly) };
  }
}

export type _AlertThresholdLevelExport = AlertThresholdLevel;
