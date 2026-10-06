"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { SaveNotificationSettingsSchema } from "@/server/validators/user";
import { NotificationChannel, type AlertThresholdLevel } from "@prisma/client";
import { PermissionError } from "@/lib/rbac";

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

export type _AlertThresholdLevelExport = AlertThresholdLevel;
