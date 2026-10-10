"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  saveInserveSettings,
  getInserveSettingsMasked,
  saveNavixySettings,
  getNavixySettingsMasked,
  saveSmtpSettings,
  getSmtpSettingsMasked,
  getSmtpSettings,
} from "@/server/services/app-setting.service";
import { inserveClient } from "@/server/integrations/inserve/client";
import { navixyClient } from "@/server/integrations/navixy/client";
import {
  syncAvailableSimsFromSimhuis,
} from "@/server/services/simhuis-sim-sync.service";
import {
  InserveSettingsSchema,
  type InserveSettingsInput,
  NavixySettingsSchema,
  type NavixySettingsInput,
  SmtpSettingsSchema,
  type SmtpSettingsInput,
} from "@/server/validators/setting";
import {
  SaveSyncScheduleSchema,
  ResetSyncScheduleSchema,
  TriggerSyncJobSchema,
  type SaveSyncScheduleInput,
} from "@/server/validators/schedule";
import type {
  InserveSettingsMasked,
  NavixySettingsMasked,
  SmtpSettingsMasked,
} from "@/server/validators/setting";
import { prisma } from "@/lib/prisma";
import {
  completeSyncJobRun,
  createSyncJobRun,
  getSchedulerHealth,
  getSyncJobConfig,
  listRecentSyncJobRuns,
  listSyncJobConfigs,
  resetSyncJobConfig,
  saveSyncJobConfig,
} from "@/server/services/sync-schedule.service";
import {
  syncActiveSimsUsageFromSimhuis,
} from "@/server/services/simhuis-sim-sync.service";
import {
  syncAllPendingToInserve,
} from "@/server/services/inserve-batch-sync.service";
import {
  runUsageAlertNotificationCycle,
} from "@/server/services/sim-usage-alert.service";
import {
  runInserveCustomerImport,
} from "@/server/services/inserve-customer-import.service";
import {
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
  type RoleScope,
} from "@/types/enums";

export type InserveSettingsActionState = {
  errors?: Partial<Record<keyof InserveSettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

export type NavixySettingsActionState = {
  errors?: Partial<Record<keyof NavixySettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

export type SmtpSettingsActionState = {
  errors?: Partial<Record<keyof SmtpSettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

const formStr = (v: FormDataEntryValue | null): string =>
  typeof v === "string" ? v : "";

/* ========================= Inserve ========================= */

export async function getInserveSettingsAction(): Promise<InserveSettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return null;
  }
  return getInserveSettingsMasked();
}

export async function saveInserveSettingsAction(
  _prev: InserveSettingsActionState,
  formData: FormData
): Promise<InserveSettingsActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");

  const rawSubdomain = formData.get("subdomain");
  const rawApiKey = formData.get("apiKey");

  const data: InserveSettingsInput = {
    subdomain: typeof rawSubdomain === "string" ? rawSubdomain : "",
    apiKey: typeof rawApiKey === "string" ? rawApiKey : "",
  };

  const validated = InserveSettingsSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as InserveSettingsActionState["errors"],
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    const ctx = { userId: user.id, userRole: user.role };
    await saveInserveSettings(validated.data, ctx);
    revalidatePath("/settings");
    return {
      success: true,
      message: "Inserve API-instellingen zijn opgeslagen.",
    };
  } catch (err) {
    console.error("[settings] Failed to save Inserve settings:", err);
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}

/* ========================= Navixy ========================= */

export async function getNavixySettingsAction(): Promise<NavixySettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) return null;
  return getNavixySettingsMasked();
}

export async function saveNavixySettingsAction(
  _prev: NavixySettingsActionState,
  formData: FormData
): Promise<NavixySettingsActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");

  const data: NavixySettingsInput = {
    baseUrl: formStr(formData.get("baseUrl")),
    authMode:
      (formStr(formData.get("authMode")) as "panel" | "user" | "direct") || "panel",
    panelLogin: formStr(formData.get("panelLogin")),
    panelPassword: formStr(formData.get("panelPassword")),
    userLogin: formStr(formData.get("userLogin")),
    userPassword: formStr(formData.get("userPassword")),
    directHash: formStr(formData.get("directHash")),
    createMethod:
      (formStr(formData.get("createMethod")) as "create" | "clone" | "register") ||
      "create",
    defaultUserId: formStr(formData.get("defaultUserId")),
    defaultTariffId: formStr(formData.get("defaultTariffId")),
    defaultCloneSourceTrackerId: formStr(formData.get("defaultCloneSourceTrackerId")),
    endpointPanelAuth:
      formStr(formData.get("endpointPanelAuth")) || "/panel/account/auth",
    endpointUserAuth:
      formStr(formData.get("endpointUserAuth")) || "/user/session/auth",
    endpointPanelTracker:
      formStr(formData.get("endpointPanelTracker")) || "/panel/tracker",
    endpointUserTracker:
      formStr(formData.get("endpointUserTracker")) || "/user/tracker",
  };

  const validated = NavixySettingsSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as NavixySettingsActionState["errors"],
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    const ctx = { userId: user.id, userRole: user.role };
    await saveNavixySettings(validated.data, ctx);
    revalidatePath("/settings");
    return {
      success: true,
      message: "Navixy API-instellingen zijn opgeslagen.",
    };
  } catch (err) {
    console.error("[settings] Failed to save Navixy settings:", err);
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}

/* ========================= Smoke tests (connectivity) ========================= */

export interface ConnectionTestResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  endpoint?: string;
  message?: string;
}

export async function testInserveConnectionAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return { ok: false, error: "Onvoldoende rechten." };
  }
  const res = await inserveClient.testConnection();
  return {
    ...res,
    message: res.ok
      ? `Verbinding Inserve succesvol (${res.latencyMs}ms)`
      : res.error ?? "Verbinding Inserve mislukt.",
  };
}

export async function testNavixyConnectionAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return { ok: false, error: "Onvoldoende rechten." };
  }
  const res = await navixyClient.testConnection();
  return {
    ...res,
    message: res.ok
      ? `Verbinding Navixy succesvol (${res.latencyMs}ms)`
      : res.error ?? "Verbinding Navixy mislukt.",
  };
}

/* ========================= SMTP / E-mail notificaties ========================= */

export async function getSmtpSettingsAction(): Promise<SmtpSettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) return null;
  return getSmtpSettingsMasked();
}

export async function saveSmtpSettingsAction(
  _prev: SmtpSettingsActionState,
  formData: FormData
): Promise<SmtpSettingsActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");

  const rawHost = formStr(formData.get("host")).trim();
  const rawPort = formStr(formData.get("port")).trim();
  const rawSecure = formStr(formData.get("secure"));
  const rawUser = formStr(formData.get("smtpUser")).trim();
  const rawPassword = formStr(formData.get("smtpPassword")).trim();
  const rawFrom = formStr(formData.get("fromEmail")).trim();

  const payload = {
    host: rawHost,
    port: rawPort,
    secure: rawSecure === "on" || rawSecure === "true",
    user: rawUser.length ? rawUser : undefined,
    password: rawPassword.length ? rawPassword : undefined,
    from: rawFrom,
  };
  const parsed = SmtpSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors as Partial<
        Record<keyof SmtpSettingsInput, string[]>
      >,
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    await saveSmtpSettings(parsed.data, {
      userId: user.id,
      userRole: user.role,
    });

    const { suggestSmtpHost } = await import("@/server/services/email.service");
    const hints = suggestSmtpHost(rawHost);
    const warnings: string[] = [];
    if (hints.detectedPortInHost) {
      warnings.push(
        `Let op: er stond een poort (${hints.detectedPortInHost}) achter de hostnaam. We hebben dit automatisch opgesplitst.`
      );
    }
    if (hints.suggestion && hints.suggestion.toLowerCase() !== parsed.data.host.toLowerCase()) {
      warnings.push(
        `${hints.note || "De SMTP-hostnaam wijkt af van de bekende standaard."} Wilt u in plaats van '${rawHost}' niet '${hints.suggestion}' proberen?`
      );
    }

    revalidatePath("/settings");
    return {
      success: true,
      message: warnings.length
        ? `SMTP-instellingen opgeslagen. Let op: ${warnings.join(" | ")}`
        : "SMTP-instellingen opgeslagen.",
    };
  } catch (e: any) {
    return {
      success: false,
      message: e?.message ?? "Opslaan mislukt.",
    };
  }
}

export async function testSmtpSendAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "edit", "setting")) {
    return { ok: false, message: "Onvoldoende rechten." };
  }
  // lazy import om cirkelvormige afhankelijkheden te vermijden
  const {
    sendTestEmail,
    resetEmailTransportCache,
    formatSmtpErrorForUser,
    renderSmtpErrorPlain,
  } = await import("@/server/services/email.service");
  resetEmailTransportCache();

  let smtpCtx: { host?: string; from?: string } = {};
  try {
    const s = await getSmtpSettings();
    if (s) smtpCtx = { host: s.host, from: s.from };
  } catch {
    /* ignore */
  }

  if (!user.email) {
    return { ok: false, message: "Uw account heeft geen geldig e-mailadres." };
  }
  const r = await sendTestEmail(user.email);
  if (r.dryRun) {
    return {
      ok: false,
      message:
        r.error ??
        "SMTP is niet geconfigureerd. Stel eerst host, poort en afzender in.",
    };
  }
  if (r.rejected.length > 0 || r.error) {
    const raw =
      r.error ?? `Verzending mislukt: ${r.rejected.join(", ")}`;
    const friendly = formatSmtpErrorForUser(raw, {
      ...smtpCtx,
      to: user.email,
    });
    return {
      ok: false,
      error: raw,
      message: renderSmtpErrorPlain(friendly),
    };
  }
  return {
    ok: true,
    message: `Test e-mail verzonden naar ${user.email} (${
      r.messageId ? r.messageId.slice(0, 60) + "…" : ""
    })`,
  };
}

/* ========================= Sync Schedule beheer (ADMIN / INTERNAL) ========================= */

export interface SyncScheduleSaveState {
  errors?: Partial<Record<keyof SaveSyncScheduleInput | "_global", string[]>>;
  message?: string | null;
  success?: boolean;
  config?: ReturnType<typeof listSyncJobConfigs> extends Promise<infer T> ? T extends (infer R)[] ? R : never : never;
}

export interface SyncScheduleResetState {
  errors?: { jobId?: string[]; _global?: string[] };
  message?: string | null;
  success?: boolean;
}

export interface SyncScheduleTriggerState {
  errors?: { jobId?: string[]; _global?: string[] };
  message?: string | null;
  success?: boolean;
  skipped?: boolean;
  summary?: string | null;
  runId?: string | null;
}

export interface SchedulerFullState {
  configs: Awaited<ReturnType<typeof listSyncJobConfigs>>;
  health: Awaited<ReturnType<typeof getSchedulerHealth>>;
  runs: Awaited<ReturnType<typeof listRecentSyncJobRuns>>;
  canEdit: boolean;
  viewerIsInternal: boolean;
}

function requireInternalWriteGuard() {
  // Handled per action for read/write distinction; helper kept for clarity.
}

export async function getSyncSchedulesAction(): Promise<SchedulerFullState | null> {
  const user = await getCurrentUser();
  if (!user || !canUserRole(user.role, "view", "setting")) {
    return null;
  }
  const canEdit = Boolean(
    canUserRole(user.role, "edit", "setting") && (user.roleScope as RoleScope) === "INTERNAL"
  );
  const [configs, health, runs] = await Promise.all([
    listSyncJobConfigs(),
    getSchedulerHealth(),
    listRecentSyncJobRuns({ limit: 50 }),
  ]);
  return {
    configs,
    health,
    runs,
    canEdit,
    viewerIsInternal: (user.roleScope as RoleScope) === "INTERNAL",
  };
}

export async function saveSyncScheduleAction(
  _prev: SyncScheduleSaveState | undefined,
  formData: FormData
): Promise<SyncScheduleSaveState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");
  if ((user.roleScope as RoleScope) !== "INTERNAL") {
    return {
      success: false,
      errors: { _global: ["Alleen interne medewerkers (INTERNAL) mogen schedules wijzigen."] },
    };
  }

  const parseNum = (k: string) => {
    const raw = formData.get(k);
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const parseBool = (k: string) => {
    const raw = formData.get(k);
    return raw === "1" || raw === "true" || raw === "on";
  };

  const data: SaveSyncScheduleInput = {
    jobId: formStr(formData.get("jobId")) as SyncJobId,
    enabled: parseBool("enabled"),
    frequency: formStr(formData.get("frequency")) as SaveSyncScheduleInput["frequency"],
    hour: parseNum("hour") ?? 0,
    minute: parseNum("minute") ?? 0,
    dayOfWeek: parseNum("dayOfWeek") ?? null,
    dayOfMonth: parseNum("dayOfMonth") ?? null,
    timezone: formStr(formData.get("timezone")) || "Europe/Amsterdam",
    comment: formStr(formData.get("comment")) || null,
  };

  const validated = SaveSyncScheduleSchema.safeParse(data);
  if (!validated.success) {
    const errors = validated.error.flatten().fieldErrors as SyncScheduleSaveState["errors"];
    return { success: false, errors, message: "Corrigeer de gemarkeerde velden." };
  }

  try {
    const saved = await prisma.$transaction(async (tx) =>
      saveSyncJobConfig(tx, validated.data, user)
    );
    revalidatePath("/settings");
    return {
      success: true,
      message: `Schedule voor ${saved.jobId} succesvol opgeslagen.`,
      config: saved as SyncScheduleSaveState["config"],
    };
  } catch (e: any) {
    const msg = e?.message ?? "Onverwachte fout bij opslaan schedule.";
    if (/conflict|overlap|dezelfde/i.test(msg)) {
      return { success: false, errors: { hour: [msg] }, message: msg };
    }
    return { success: false, errors: { _global: [msg] }, message: msg };
  }
}

export async function resetSyncScheduleAction(
  _prev: SyncScheduleResetState | undefined,
  formData: FormData
): Promise<SyncScheduleResetState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");
  if ((user.roleScope as RoleScope) !== "INTERNAL") {
    return {
      success: false,
      errors: { _global: ["Alleen interne medewerkers mogen schedules resetten."] },
    };
  }

  const validated = ResetSyncScheduleSchema.safeParse({
    jobId: formStr(formData.get("jobId")) as SyncJobId,
  });
  if (!validated.success) {
    return { success: false, errors: validated.error.flatten().fieldErrors as any };
  }

  try {
    await prisma.$transaction(async (tx) =>
      resetSyncJobConfig(tx, validated.data.jobId, user)
    );
    revalidatePath("/settings");
    return {
      success: true,
      message: `Schedule ${validated.data.jobId} is teruggezet naar de standaardwaarden.`,
    };
  } catch (e: any) {
    return { success: false, errors: { _global: [e?.message ?? String(e)] } };
  }
}

export async function triggerSyncJobAction(
  _prev: SyncScheduleTriggerState | undefined,
  formData: FormData
): Promise<SyncScheduleTriggerState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "setting");
  if ((user.roleScope as RoleScope) !== "INTERNAL") {
    return {
      success: false,
      errors: { _global: ["Alleen interne medewerkers mogen handmatig runs starten."] },
    };
  }

  const validated = TriggerSyncJobSchema.safeParse({
    jobId: formStr(formData.get("jobId")) as SyncJobId,
    force: formStr(formData.get("force")) === "1" || formStr(formData.get("force")) === "true",
  });
  if (!validated.success) {
    return { success: false, errors: validated.error.flatten().fieldErrors as any };
  }

  const config = await getSyncJobConfig(validated.data.jobId);
  const run = await prisma.$transaction(async (tx) =>
    createSyncJobRun(tx, {
      configId: config.id,
      jobId: validated.data.jobId,
      triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
      userId: user.id,
    })
  );
  const startedAt = run.startedAt;

  try {
    let summary: string;
    let finalStatus: SyncJobStatus = SyncJobStatus.SUCCESS;
    let recordsAffected: any = null;
    let errorMessage: string | null = null;

    if (validated.data.jobId === SyncJobId.SIMHUIS_USAGE) {
      const r = await syncActiveSimsUsageFromSimhuis({
        userId: user.id,
        userRole: user.role as any,
        triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
      });
      recordsAffected = {
        totalActiveInDb: r.totalActiveInDb,
        totalInSimhuis: r.totalInSimhuis,
        matched: r.matched,
        updated: r.updated,
        skipped: r.skipped,
        errors: r.errors,
      };
      summary =
        `Usage-sync Simhuis handmatig afgerond. Targets in DB: ${r.totalActiveInDb}. ` +
        `Simhuis totaal: ${r.totalInSimhuis}. Gematcht: ${r.matched}. Bijgewerkt: ${r.updated}. ` +
        `Overgeslagen: ${r.skipped}. Fouten: ${r.errors}. Duur: ${r.durationMs}ms.`;
      if ((r.errors ?? 0) > 0) {
        finalStatus = SyncJobStatus.FAILED;
        errorMessage = `${r.errors} SIMs gaven een fout.`;
      }
    } else if (validated.data.jobId === SyncJobId.SIMHUIS_SIMS) {
      const r = await syncAvailableSimsFromSimhuis({
        userId: user.id,
        userRole: user.role as any,
      });
      recordsAffected = {
        totalInSimhuis: r.totalInSimhuis,
        eligibleInSimhuis: r.eligibleInSimhuis,
        created: r.created,
        updated: r.updated,
        skipped: r.skipped,
        errors: r.errors,
      };
      summary =
        `SIM-voorraad handmatig bijgewerkt. Aangemaakt: ${r.created}, bijgewerkt: ${r.updated}, overgeslagen: ${r.skipped}. ` +
        `Totaal in Simhuis: ${r.totalInSimhuis}, in aanmerking: ${r.eligibleInSimhuis}. Fouten: ${r.errors}. Duur: ${r.durationMs}ms.`;
      if ((r.errors ?? 0) > 0) {
        finalStatus = SyncJobStatus.FAILED;
        errorMessage = `${r.errors} rijen gaven een fout bij sim-sync.`;
      }
    } else if (validated.data.jobId === SyncJobId.INSERVE) {
      const r = await syncAllPendingToInserve({
        userId: user.id,
        userRole: user.role as any,
      });
      recordsAffected = {
        subscriptions: {
          total: r.subscriptions.total,
          synced: r.subscriptions.synced,
          skipped: r.subscriptions.skipped,
          failed: r.subscriptions.failed,
        },
        invoices: {
          total: r.invoices.total,
          synced: r.invoices.synced,
          skipped: r.invoices.skipped,
          failed: r.invoices.failed,
        },
      };
      summary =
        `Inserve handmatig gesynchroniseerd. Sub: ok=${r.subscriptions.synced} skip=${r.subscriptions.skipped} fail=${r.subscriptions.failed}. ` +
        `Inv: ok=${r.invoices.synced} skip=${r.invoices.skipped} fail=${r.invoices.failed}. Duur: ${r.durationMs}ms.`;
      const totalFailed = r.subscriptions.failed + r.invoices.failed;
      if (totalFailed > 0) {
        finalStatus = SyncJobStatus.FAILED;
        errorMessage = `${totalFailed} Inserve-items gaven een fout.`;
      }
    } else if (validated.data.jobId === SyncJobId.SIMHUIS_USAGE_ALERT_NOTIFY) {
      const report = await runUsageAlertNotificationCycle({
        thresholdPercentOverride: undefined,
        limitUsers: undefined,
        dryRunForce: false,
      });
      recordsAffected = {
        usersChecked: report.usersChecked,
        usersWithAlerts: report.usersWithAlerts,
        usersNotified: report.usersNotified,
        usersNotifiedDryRun: report.usersNotifiedDryRun,
        userSendFailures: report.userSendFailures,
        simsAtThresholdTotal: report.simsAtThresholdTotal,
        simsReportedEmails: report.simsReportedEmails,
        simsSkippedAlreadySent: report.simsSkippedAlreadySent,
        simsSkippedScope: report.simsSkippedScope,
        alertsCreated: report.alertsCreated,
      };
      summary =
        `Usage alert notificaties afgerond. Gebruikers gecheckt: ${report.usersChecked}. ` +
        `Gebruikers gerapporteerd: ${report.usersWithAlerts}. ` +
        `Notificaties verstuurd: ${report.usersNotified}. Dry-run: ${report.usersNotifiedDryRun}. ` +
        `Falen: ${report.userSendFailures}. SIMs boven drempel: ${report.simsAtThresholdTotal}. ` +
        `Gerapporteerde SIMs: ${report.simsReportedEmails}. Overgeslagen (anti-spam): ${report.simsSkippedAlreadySent}.`;
      if (report.userSendFailures > 0) {
        finalStatus = SyncJobStatus.FAILED;
        errorMessage = `${report.userSendFailures} gebruikers konden geen e-mail ontvangen.`;
      }
    } else if (validated.data.jobId === SyncJobId.INSERVE_CUSTOMER_IMPORT) {
      const r = await runInserveCustomerImport(
        {
          userId: user.id,
          userRole: user.role as any,
          roleScope: user.roleScope as any,
          permissions: (user as any).permissions ?? null,
          customerIds: null,
        },
        {
          skipRunManagement: true,
          preExistingRunId: run.id,
        }
      );
      recordsAffected = {
        fetched: r.fetched,
        activeFilterPassed: r.activeFilterPassed,
        created: r.created,
        updated: r.updated,
        unchanged: r.unchanged,
        skipped: r.skipped,
        failed: r.failed,
        possibleUnlinkedMatches: r.possibleUnlinkedMatches?.length ?? 0,
        previouslyActiveNowInactive: r.previouslyActiveNowInactive?.length ?? 0,
        pagesProcessed: r.pagesProcessed,
        totalExpected: r.totalExpected,
      };
      const skippedTotal =
        r.skipped.inactive_or_missing_nexus_field +
        r.skipped.missing_required_fields +
        r.skipped.fetch_error_nexus +
        r.skipped.other;

      let statusLabel: string;
      if (r.status === "SUCCESS") statusLabel = "afgerond";
      else if (r.status === "PARTIAL_SUCCESS") statusLabel = "gedeeltelijk geslaagd";
      else if (r.status === "SKIPPED") statusLabel = "overgeslagen";
      else statusLabel = "❌ MISLUKT";

      const c = r.inserveCredentials;
      const credsLine = c
        ? ` | Configuratie: ${c.configured ? "OK" : "❌ NIET"} (bron: ${
              c.source === "db" ? "DB" : c.source === "env" ? "ENV" : "GEEN"
            }; subdomain: ${c.subdomainSet ? "ja" : "nee"}; apiKey: ${c.apiKeySet ? "ja" : "nee"})`
        : "";

      const t = r.timingMs;
      const firstZero = t
        ? ([
            ["inserveInit", t.inserveInit],
            ["fetchCompanies", t.fetchCompanies],
            ["fetchPreExisting", t.fetchPreExisting],
            ["processRecords", t.processRecords],
            ["findMatches", t.findMatches],
            ["finalize", t.finalize],
          ] as const)
            .filter(([k, v]) => (v ?? 0) === 0 && k !== "findMatches")
            .map(([k]) => k)
            .slice(0, 2)
        : [];
      const timingLine = firstZero.length > 0 ? ` | ⚠️ 0ms fasen: ${firstZero.join(", ")}` : "";

      const countsLine =
        `Ophaalde: ${r.fetched}, ` +
        `filterpass: ${r.activeFilterPassed}, aangemaakt: ${r.created}, bijgewerkt: ${r.updated}, ` +
        `ongewijzigd: ${r.unchanged}, overgeslagen: ${skippedTotal}, mislukt: ${r.failed}. ` +
        `API pagina's: ${r.pagesProcessed}, API-totaal: ${r.totalExpected}. Duur: ${r.durationMs}ms.`;

      const errLine =
        (r.status === "FAILED" || r.status === "PARTIAL_SUCCESS") && r.errorMessage
          ? ` | Fout: ${r.errorMessage}`
          : r.status === "SKIPPED" && r.errorMessage
          ? ` | Reden: ${r.errorMessage}`
          : "";

      summary = `Inserve klantimport ${statusLabel}. ${countsLine}${errLine}${credsLine}${timingLine}`;
      if (r.status === "FAILED" || r.failed > 0) {
        finalStatus = SyncJobStatus.FAILED;
        errorMessage =
          r.errorMessage ??
          (r.failed > 0 ? `${r.failed} records konden niet worden verwerkt.` : "Import mislukt.");
      } else if (r.status === "SKIPPED") {
        finalStatus = SyncJobStatus.SKIPPED;
      } else if (r.status === "PARTIAL_SUCCESS") {
        finalStatus = SyncJobStatus.SUCCESS;
        if (r.errorMessage && !errorMessage) {
          errorMessage = r.errorMessage;
        }
      }
    } else {
      throw new Error(`Onbekende jobId: ${validated.data.jobId}`);
    }

    await prisma.$transaction(async (tx) =>
      completeSyncJobRun(tx, {
        id: run.id,
        status: finalStatus,
        startedAt,
        recordsAffected,
        errorMessage,
        errorDetail: null,
      })
    );

    revalidatePath("/settings");
    return {
      success: finalStatus === SyncJobStatus.SUCCESS,
      message: summary,
      summary,
      runId: run.id,
    };
  } catch (e: any) {
    await prisma.$transaction(async (tx) =>
      completeSyncJobRun(tx, {
        id: run.id,
        status: SyncJobStatus.FAILED,
        startedAt,
        errorMessage: e?.message ?? "Onverwachte fout tijdens handmatige run.",
        errorDetail: { stack: e?.stack ?? null, name: e?.name ?? null },
      })
    );
    revalidatePath("/settings");
    const msg = e?.message ?? String(e);
    return {
      success: false,
      errors: { _global: [msg] },
      message: msg,
      runId: run.id,
    };
  }
}

export async function getSchedulerHealthAction() {
  const user = await getCurrentUser();
  if (!user || !canUserRole(user.role, "view", "setting")) {
    return null;
  }
  return getSchedulerHealth();
}
