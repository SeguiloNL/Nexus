"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { SaveNotificationSettingsSchema } from "@/server/validators/user";
import {
  AlertThresholdLevel,
  NotificationChannel,
  type AlertThresholdLevel as AlertThresholdLevelType,
} from "@prisma/client";
import { PermissionError, hasMinRole } from "@/lib/rbac";
import {
  sendTestEmail,
  formatSmtpErrorForUser,
  renderSmtpErrorPlain,
} from "@/server/services/email.service";
import { getSmtpSettings } from "@/server/services/app-setting.service";
import {
  DEFAULT_THRESHOLD_LEVELS,
  resolveUserThresholdLevels,
  resolveUserCheckIntervalMinutes,
} from "@/server/services/sim-usage-alert.service";
import { UserRole } from "@/types/enums";

export async function getMyNotificationSettingsAction() {
  const user = await requireUser();
  const row = await prisma.userNotificationSettings.findUnique({
    where: { userId: user.id },
  });
  const roleScope = (user.roleScope as "INTERNAL" | "CUSTOMER" | "RESELLER" | "PARTNER" | undefined) ?? null;
  if (row) {
    const levels = resolveUserThresholdLevels(row);
    const interval = resolveUserCheckIntervalMinutes(row);
    return {
      enabledEmail: row.enabledEmail,
      notificationEmail: row.notificationEmail ?? null,
      enabledDataThresholdAlert: row.enabledDataThresholdAlert,
      dataThresholdPercent: row.dataThresholdPercent,
      thresholdLevels: levels,
      usageAlertCheckIntervalMinutes: interval,
      notifyAllSims:
        roleScope === "INTERNAL" && hasMinRole(user.role, UserRole.ADMIN)
          ? row.notifyAllSims
          : false,
      lastNotificationAt: row.lastNotificationAt ?? null,
      _roleScope: roleScope,
    };
  }
  return {
    enabledEmail: true,
    notificationEmail: null,
    enabledDataThresholdAlert: true,
    dataThresholdPercent: 80,
    thresholdLevels: DEFAULT_THRESHOLD_LEVELS,
    usageAlertCheckIntervalMinutes: 60,
    notifyAllSims: false,
    lastNotificationAt: null,
    _roleScope: roleScope,
  };
}

export async function saveNotificationSettingsAction(form: FormData) {
  const user = await requireUser();

  const thresholdLevelsRaw = form.getAll("thresholdLevels");
  const parsedLevels: AlertThresholdLevelType[] = Array.isArray(
    thresholdLevelsRaw
  )
    ? (thresholdLevelsRaw
        .map((v) => String(v))
        .filter(
          (v) =>
            Object.values(AlertThresholdLevel).includes(
              v as AlertThresholdLevelType
            )
        ) as AlertThresholdLevelType[])
    : [];

  const rawNotificationEmail = form.get("notificationEmail");
  const notificationEmailRaw =
    rawNotificationEmail === undefined || rawNotificationEmail === null
      ? null
      : String(rawNotificationEmail).trim();

  const payload = {
    enabledEmail: form.get("enabledEmail") === "on",
    notificationEmail:
      notificationEmailRaw === "" ? null : notificationEmailRaw,
    enabledDataThresholdAlert: form.get("enabledDataThresholdAlert") === "on",
    dataThresholdPercent: Number(form.get("dataThresholdPercent") ?? 80),
    thresholdLevels: parsedLevels,
    usageAlertCheckIntervalMinutes: Number(
      form.get("usageAlertCheckIntervalMinutes") ?? 60
    ),
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
  if (
    finalNotifyAllSims &&
    (roleScope !== "INTERNAL" || !hasMinRole(user.role, UserRole.ADMIN))
  ) {
    throw new PermissionError(
      "notifyAllSims mag alleen ingeschakeld worden door beheerders."
    );
  }

  let finalLevels: AlertThresholdLevelType[] =
    Array.isArray(validated.thresholdLevels) && validated.thresholdLevels.length > 0
      ? (validated.thresholdLevels as AlertThresholdLevelType[])
      : [];

  let fallbackPercent = validated.dataThresholdPercent ?? 80;
  if (finalLevels.length === 0) {
    if (fallbackPercent >= 100) {
      finalLevels = [AlertThresholdLevel.CRITICAL_100];
    } else if (fallbackPercent >= 90) {
      finalLevels = [AlertThresholdLevel.WARNING_90];
    } else if (fallbackPercent >= 80) {
      finalLevels = [AlertThresholdLevel.WARNING_80];
    } else if (fallbackPercent >= 70) {
      finalLevels = [AlertThresholdLevel.WARNING_70];
    } else {
      finalLevels = DEFAULT_THRESHOLD_LEVELS;
    }
    const max = Math.max(
      ...finalLevels.map((l) =>
        l === AlertThresholdLevel.CRITICAL_100
          ? 100
          : l === AlertThresholdLevel.WARNING_90
          ? 90
          : l === AlertThresholdLevel.WARNING_80
          ? 80
          : 70
      )
    );
    fallbackPercent = max;
  } else {
    const max = Math.max(
      ...finalLevels.map((l) =>
        l === AlertThresholdLevel.CRITICAL_100
          ? 100
          : l === AlertThresholdLevel.WARNING_90
          ? 90
          : l === AlertThresholdLevel.WARNING_80
          ? 80
          : 70
      )
    );
    fallbackPercent = max;
  }

  const saved = await prisma.userNotificationSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      enabledEmail: validated.enabledEmail,
      notificationEmail: validated.notificationEmail ?? null,
      enabledDataThresholdAlert: validated.enabledDataThresholdAlert,
      dataThresholdPercent: fallbackPercent,
      thresholdLevels: { set: finalLevels },
      usageAlertCheckIntervalMinutes: validated.usageAlertCheckIntervalMinutes,
      notifyAllSims: finalNotifyAllSims,
      channels: { set: [NotificationChannel.EMAIL] },
    },
    update: {
      enabledEmail: validated.enabledEmail,
      notificationEmail: validated.notificationEmail ?? null,
      enabledDataThresholdAlert: validated.enabledDataThresholdAlert,
      dataThresholdPercent: fallbackPercent,
      thresholdLevels: { set: finalLevels },
      usageAlertCheckIntervalMinutes: validated.usageAlertCheckIntervalMinutes,
      notifyAllSims: finalNotifyAllSims,
      channels: { set: [NotificationChannel.EMAIL] },
    },
  });

  return {
    ok: true,
    settings: {
      enabledEmail: saved.enabledEmail,
      notificationEmail: saved.notificationEmail ?? null,
      enabledDataThresholdAlert: saved.enabledDataThresholdAlert,
      dataThresholdPercent: saved.dataThresholdPercent,
      thresholdLevels: resolveUserThresholdLevels(saved),
      usageAlertCheckIntervalMinutes: resolveUserCheckIntervalMinutes(saved),
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

  const settingsRow = await prisma.userNotificationSettings.findUnique({
    where: { userId: user.id },
    select: { notificationEmail: true, enabledEmail: true },
  });

  const notificationEmail =
    settingsRow?.notificationEmail && settingsRow.notificationEmail.trim() !== ""
      ? settingsRow.notificationEmail.trim()
      : null;

  const toEmail = notificationEmail || user.email;

  if (!toEmail) {
    return {
      ok: false,
      message:
        "Er is geen bestemmingsadres beschikbaar. Stel een notificatie-e-mailadres in of voeg een e-mailadres toe aan uw account.",
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
    const result = await sendTestEmail(toEmail);
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
        to: toEmail,
      });
      return {
        ok: false,
        message: renderSmtpErrorPlain(friendly),
      };
    }
    if (result.accepted.length > 0) {
      const sourceNote = notificationEmail
        ? ` (notificatie-adres)`
        : ` (account-adres)`;
      return {
        ok: true,
        message: `Test e-mail succesvol verzonden naar ${toEmail}${sourceNote}. Controleer uw inbox (en spamfolder).`,
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
      to: toEmail,
    });
    return { ok: false, message: renderSmtpErrorPlain(friendly) };
  }
}

export type _AlertThresholdLevelExport = AlertThresholdLevelType;
