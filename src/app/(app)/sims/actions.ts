"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildCsv, csvDownloadResponse, filenameTimestamp } from "@/lib/csv";
import {
  CreateSimSchema,
  UpdateSimSchema,
  type CreateSimInput,
} from "@/server/validators/sim";
import {
  createSim,
  softDeleteSim,
  updateSim,
  previewSimCsvImport,
  bulkImportSims,
  bulkSoftDeleteSims,
  type SimCsvImportRow,
} from "@/server/services/sim.service";
import { syncActiveSimsUsageFromSimhuis, syncUsageForSingleSim } from "@/server/services/simhuis-sim-sync.service";
import type { PerSimUsageSyncResult } from "@/server/services/simhuis-sim-sync.service";
import {
  suspendSimById,
  unsuspendSimById,
  refreshSimStatusById,
  type SimSuspendResult,
  type SimSuspendError,
  type SimStatusRefreshResult,
} from "@/server/services/simhuis-asset.service";
import { hasMinRole } from "@/lib/rbac";
import { UserRole, RoleScope } from "@/types/enums";
import { assertNoProviderNameLeak } from "@/lib/providers/provider-leak-guard";

export type SimActionState = {
  errors?: Partial<Record<keyof CreateSimInput, string[]>>;
  message?: string | null;
  simId?: string;
};

export type SimCsvImportActionState = {
  message?: string | null;
  preview?: any;
  committed?: { count: number; ids: string[] } | null;
  rows?: SimCsvImportRow[];
};

export async function createSimAction(
  _prev: SimActionState,
  formData: FormData
): Promise<SimActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "create", "sim");

  const data = {
    iccid: formData.get("iccid") || undefined,
    msisdn: formData.get("msisdn") || null,
    imsi: formData.get("imsi") || null,
    provider: formData.get("provider") || undefined,
    simType: formData.get("simType") || null,
    apn: formData.get("apn") || null,
    status: (formData.get("status") as CreateSimInput["status"]) ?? undefined,
    providerActivationDate: formData.get("providerActivationDate") || null,
    providerDeactivationDate:
      formData.get("providerDeactivationDate") || null,
    notes: formData.get("notes") || null,
  };

  const validated = CreateSimSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as SimActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const sim = await createSim(validated.data, ctx);

  revalidatePath("/sims");
  redirect(`/sims/${sim.id}`);
}

export async function updateSimAction(
  simId: string,
  _prev: SimActionState,
  formData: FormData
): Promise<SimActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "sim");

  const data: any = {
    msisdn: formData.get("msisdn") || null,
    imsi: formData.get("imsi") || null,
    provider: formData.get("provider") || undefined,
    simType: formData.get("simType") || null,
    apn: formData.get("apn") || null,
    status: (formData.get("status") as CreateSimInput["status"]) ?? undefined,
    providerActivationDate: formData.get("providerActivationDate") || null,
    providerDeactivationDate:
      formData.get("providerDeactivationDate") || null,
    notes: formData.get("notes") || null,
  };

  const validated = UpdateSimSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as SimActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  await updateSim(simId, validated.data, ctx);

  revalidatePath("/sims");
  revalidatePath(`/sims/${simId}`);
  redirect(`/sims/${simId}`);
}

export async function deleteSimAction(simId: string) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "sim");

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  await softDeleteSim(simId, ctx);

  revalidatePath("/sims");
  revalidatePath(`/sims/${simId}`);
  redirect("/sims");
}

export async function previewSimCsvAction(
  _prev: SimCsvImportActionState,
  formData: FormData
): Promise<SimCsvImportActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "import", "sim");

  const file = formData.get("file") as File | null;
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    return { message: "Upload een geldig CSV-bestand." };
  }

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const preview = previewSimCsvImport(rows);
    return { preview, rows };
  } catch (e) {
    return { message: "Fout bij parsen van CSV: " + (e as Error).message };
  }
}

export async function commitSimCsvAction(
  prev: SimCsvImportActionState,
  _formData: FormData
): Promise<SimCsvImportActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "import", "sim");

  if (!prev.preview?.valid.length) {
    return { ...prev, message: "Geen geldige rijen om te importeren." };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const result = await bulkImportSims(prev.preview.valid, ctx);

  revalidatePath("/sims");
  return { ...prev, committed: result };
}

export async function exportSimsCsvAction(): Promise<Response> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "export", "sim");

  const hasScope = user.customerIds && user.customerIds.length > 0;
  const where: any = { deletedAt: null };
  if (hasScope) {
    where.assignments = {
      some: { subscription: { customerId: { in: user.customerIds } } },
    };
  }
  const rows = await prisma.sIM.findMany({
    where,
    orderBy: { iccid: "asc" },
  });

  const headers = [
    "iccid",
    "imsi",
    "msisdn",
    "provider",
    "simType",
    "apn",
    "status",
    "providerActivationDate",
    "providerDeactivationDate",
    "createdAt",
    "notes",
  ];

  const csvRows: Array<Array<unknown>> = rows.map((s) => [
    s.iccid,
    s.imsi ?? "",
    s.msisdn ?? "",
    s.provider ?? "",
    s.simType ?? "",
    s.apn ?? "",
    s.status,
    s.providerActivationDate instanceof Date
      ? s.providerActivationDate.toISOString().slice(0, 10)
      : s.providerActivationDate ?? "",
    s.providerDeactivationDate instanceof Date
      ? s.providerDeactivationDate.toISOString().slice(0, 10)
      : s.providerDeactivationDate ?? "",
    s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    s.notes ?? "",
  ]);

  const csv = buildCsv(headers, csvRows);
  const filename = `sims-${filenameTimestamp()}.csv`;
  return csvDownloadResponse(filename, csv);
}

function parseCsv(text: string): SimCsvImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ""));

  const keyMap: Record<string, keyof SimCsvImportRow> = {
    iccid: "iccid",
    sim: "iccid",
    simkaart: "iccid",
    msisdn: "msisdn",
    telefoon: "msisdn",
    telefoonnummer: "msisdn",
    nummer: "msisdn",
    imsi: "imsi",
    provider: "provider",
    aanbieder: "provider",
    operator: "provider",
    simtype: "simType",
    "sim type": "simType",
    type: "simType",
    apn: "apn",
    provideractivationdate: "providerActivationDate",
    "activation date": "providerActivationDate",
    activatiedatum: "providerActivationDate",
    providerdeactivationdate: "providerDeactivationDate",
    "deactivation date": "providerDeactivationDate",
    deactivatiedatum: "providerDeactivationDate",
    notes: "notes",
    notities: "notes",
    opmerkingen: "notes",
  };

  const rows: SimCsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj: any = {};
    headers.forEach((h, idx) => {
      const key = keyMap[h] || (h as keyof SimCsvImportRow);
      const v = (cols[idx] ?? "").trim();
      if (v) obj[key] = v;
    });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export type BulkActionState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  count?: number;
};

function parseIdsFormData(formData: FormData): string[] {
  const raw = formData.get("ids");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
  } catch {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function bulkSoftDeleteSimsAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "sim");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen SIM-kaarten geselecteerd." };
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await bulkSoftDeleteSims(ids, ctx);
    revalidatePath("/sims");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} SIM-kaart(en) gearchiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function syncUsageSimsAction(
  _prev: BulkActionState,
  _formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "sim");
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await syncActiveSimsUsageFromSimhuis(ctx);
    revalidatePath("/sims");
    const message =
      `Usage-sync uitgevoerd. Bijgewerkt: ${result.updated}, ` +
      `overgeslagen: ${result.skipped}, gematcht: ${result.matched}, ` +
      `fouten: ${result.errors}. Duur: ${result.durationMs} ms.`;
    assertNoProviderNameLeak([message], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "syncUsageSimsAction",
      source: "sims/actions.ts (bulk usage ok)",
    });
    if (result.errors > 0) {
      const errorMsg = `${result.errors} fout(en). ${message}`;
      assertNoProviderNameLeak([errorMsg], {
        userId: user.id,
        userRole: user.role,
        roleScope: user.roleScope,
        actionName: "syncUsageSimsAction",
        source: "sims/actions.ts (bulk usage partial error)",
      });
      return {
        ok: false,
        count: result.updated,
        error: errorMsg,
      };
    }
    return {
      ok: true,
      count: result.updated,
      message,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const wrappedMsg = `Usage-sync mislukt: ${msg}`;
    assertNoProviderNameLeak([msg, wrappedMsg], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "syncUsageSimsAction",
      source: "sims/actions.ts (bulk usage catch)",
    });
    return { ok: false, error: wrappedMsg };
  }
}

export type SimUsageSyncState = {
  ok: boolean;
  message?: string;
  error?: string;
  result?: PerSimUsageSyncResult;
};

export async function syncUsageForSingleSimAction(
  simId: string,
  _prev: SimUsageSyncState,
  _formData: FormData
): Promise<SimUsageSyncState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "sim");
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await syncUsageForSingleSim(simId, ctx);
    revalidatePath("/sims");
    revalidatePath(`/sims/${simId}`);
    if (result.errorMessage && !result.hasAnyUsageData) {
      const genericErr = `De SIM-provider kon geen verbruiksdata leveren: ${result.errorMessage}`;
      assertNoProviderNameLeak([genericErr, result.errorMessage], {
        userId: user.id,
        userRole: user.role,
        roleScope: user.roleScope,
        actionName: "syncUsageForSingleSimAction",
        source: "sims/actions.ts",
      });
      return {
        ok: false,
        error: genericErr,
        result,
      };
    }
    const fieldsLabel =
      result.changedFields.length === 0
        ? "geen wijzigingen"
        : result.changedFields.join(", ");
    const sF = result.simhuisFields;
    function fmtBytes(v: number | null): string {
      if (v === null || v === undefined) return "—";
      try {
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
        if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
        if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${n} B`;
      } catch {
        return "—";
      }
    }
    function fmtCount(v: number | null): string {
      if (v === null || v === undefined) return "—";
      const n = Number(v);
      if (!Number.isFinite(n)) return "—";
      return `${Math.round(n)}`;
    }
    const sfLabel = sF
      ? "\n\nProvider-velden (bron):\n" +
        `  dataUsedBytes: ${fmtBytes(sF.dataUsedBytes)}  dataLimitBytes: ${fmtBytes(sF.dataLimitBytes)}  lowestDataLimitBytes: ${fmtBytes(sF.lowestDataLimitBytes)}\n` +
        `  smsUsedCount: ${fmtCount(sF.smsUsedCount)}  smsLimitCount: ${fmtCount(sF.smsLimitCount)}  lowestSmsLimitCount: ${fmtCount(sF.lowestSmsLimitCount)}\n` +
        `  productName: ${sF.productName ?? "—"}  productType: ${sF.productType ?? "—"}  simName: ${sF.simName ?? "—"}  group: ${sF.groupName ?? "—"}`
      : "";
    const msg =
      `Verbruik vernieuwd (${result.source}). ` +
      `Velden: ${fieldsLabel}. ` +
      `Duur: ${result.durationMs} ms.` +
      sfLabel;
    assertNoProviderNameLeak([msg, sfLabel], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "syncUsageForSingleSimAction",
      source: "sims/actions.ts (success path)",
    });
    return {
      ok: true,
      message: msg,
      result,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Verbruik vernieuwen mislukt: ${msg}` };
  }
}

export type SimSuspendActionState = {
  ok: boolean;
  confirmedStatus: "ACTIVE" | "SUSPENDED" | null;
  pendingConfirmation: boolean;
  message: string;
  error?: SimSuspendResult["error"];
};

function buildActionCtx(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
}

function mapErrorToFriendlyMessage(err: SimSuspendError | undefined): string {
  if (!err) return "Onbekende fout.";
  switch (err.kind) {
    case "PERMISSION":
      return "Je bent niet bevoegd deze SIM te (de)blokkeren.";
    case "INVALID_STATUS_TRANSITION":
      return err.detail;
    case "PROVIDER":
      return `Provider weigerde het verzoek: ${err.detail}. Probeer het later opnieuw of neem contact op met de beheerder.`;
    case "TIMEOUT_OR_NETWORK":
      return "Verzoek duurde te lang of mislukte. Controleer eerst de actuele SIM-status alvorens te herhalen.";
    case "NOT_FOUND":
      return "SIM is niet (meer) beschikbaar in dit account.";
    default: {
      const exhaustive: never = err;
      void exhaustive;
      return (err as any)?.detail || "Onbekende fout.";
    }
  }
}

export async function suspendSimAction(
  simId: string,
  _prev: SimSuspendActionState,
  _form: FormData
): Promise<SimSuspendActionState> {
  const user = await getCurrentUser();

  if (user.roleScope !== RoleScope.INTERNAL || !hasMinRole(user.role, UserRole.ADMIN)) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Je bent niet bevoegd deze SIM te blokkeren.",
      error: {
        kind: "PERMISSION",
        detail: "Alleen interne beheerders (ADMIN) mogen deze actie uitvoeren.",
      },
    };
  }
  await requirePermission(user.permissions ?? user.roleId ?? user.role, "edit", "sim");

  const ctx = buildActionCtx(user);
  let result: SimSuspendResult;
  try {
    result = await suspendSimById(simId, ctx);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Onverwachte fout tijdens blokkeren.",
      error: { kind: "TIMEOUT_OR_NETWORK", detail: msg },
    };
  }

  if (result.ok) {
    try {
      revalidatePath("/sims");
      revalidatePath(`/sims/${simId}`);
    } catch {}
    assertNoProviderNameLeak([result.message], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "suspendSimAction",
      source: "sims/actions.ts (suspend ok)",
    });
    return {
      ok: true,
      confirmedStatus: result.confirmedStatus,
      pendingConfirmation: result.pendingConfirmation,
      message: result.message,
    };
  }

  const friendlyErr = mapErrorToFriendlyMessage(result.error);
  assertNoProviderNameLeak([friendlyErr, result.error?.detail], {
    userId: user.id,
    userRole: user.role,
    roleScope: user.roleScope,
    actionName: "suspendSimAction",
    source: "sims/actions.ts (suspend error)",
  });
  return {
    ok: false,
    confirmedStatus: null,
    pendingConfirmation: false,
    message: friendlyErr,
    error: result.error,
  };
}

export async function unsuspendSimAction(
  simId: string,
  _prev: SimSuspendActionState,
  _form: FormData
): Promise<SimSuspendActionState> {
  const user = await getCurrentUser();

  if (user.roleScope !== RoleScope.INTERNAL || !hasMinRole(user.role, UserRole.ADMIN)) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Je bent niet bevoegd deze SIM te deblokkeren.",
      error: {
        kind: "PERMISSION",
        detail: "Alleen interne beheerders (ADMIN) mogen deze actie uitvoeren.",
      },
    };
  }
  await requirePermission(user.permissions ?? user.roleId ?? user.role, "edit", "sim");

  const ctx = buildActionCtx(user);
  let result: SimSuspendResult;
  try {
    result = await unsuspendSimById(simId, ctx);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Onverwachte fout tijdens deblokkeren.",
      error: { kind: "TIMEOUT_OR_NETWORK", detail: msg },
    };
  }

  if (result.ok) {
    try {
      revalidatePath("/sims");
      revalidatePath(`/sims/${simId}`);
    } catch {}
    assertNoProviderNameLeak([result.message], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "unsuspendSimAction",
      source: "sims/actions.ts (unsuspend ok)",
    });
    return {
      ok: true,
      confirmedStatus: result.confirmedStatus,
      pendingConfirmation: result.pendingConfirmation,
      message: result.message,
    };
  }

  const friendlyErrUnsuspend = mapErrorToFriendlyMessage(result.error);
  assertNoProviderNameLeak([friendlyErrUnsuspend, result.error?.detail], {
    userId: user.id,
    userRole: user.role,
    roleScope: user.roleScope,
    actionName: "unsuspendSimAction",
    source: "sims/actions.ts (unsuspend error)",
  });
  return {
    ok: false,
    confirmedStatus: null,
    pendingConfirmation: false,
    message: friendlyErrUnsuspend,
    error: result.error,
  };
}

export type SimStatusRefreshActionState = {
  ok: boolean;
  message: string;
  error?: SimSuspendError;
  previousStatus?: SimStatusRefreshResult["previousStatus"];
  refreshedStatus?: SimStatusRefreshResult["refreshedStatus"];
  simhuisStatusRaw?: SimStatusRefreshResult["simhuisStatusRaw"];
  changed?: boolean;
};

export async function refreshSimStatusAction(
  simId: string,
  _prev: SimStatusRefreshActionState,
  _form: FormData
): Promise<SimStatusRefreshActionState> {
  const user = await getCurrentUser();

  await requirePermission(user.permissions ?? user.roleId ?? user.role, "view", "sim");

  const ctx = buildActionCtx(user);
  let result: SimStatusRefreshResult;
  try {
    result = await refreshSimStatusById(simId, ctx);
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: "Onverwachte fout tijdens verversen van status.",
      error: { kind: "TIMEOUT_OR_NETWORK", detail: msg },
    };
  }

  if (result.ok) {
    try {
      revalidatePath("/sims");
      revalidatePath(`/sims/${simId}`);
    } catch {}
    assertNoProviderNameLeak([result.message], {
      userId: user.id,
      userRole: user.role,
      roleScope: user.roleScope,
      actionName: "refreshSimStatusAction",
      source: "sims/actions.ts (refresh ok)",
    });
    return {
      ok: true,
      message: result.message,
      previousStatus: result.previousStatus,
      refreshedStatus: result.refreshedStatus,
      simhuisStatusRaw: result.simhuisStatusRaw,
      changed: result.changed,
    };
  }

  const friendlyRefreshErr = mapErrorToFriendlyMessage(result.error);
  assertNoProviderNameLeak([friendlyRefreshErr, result.error?.detail], {
    userId: user.id,
    userRole: user.role,
    roleScope: user.roleScope,
    actionName: "refreshSimStatusAction",
    source: "sims/actions.ts (refresh error)",
  });
  return {
    ok: false,
    message: friendlyRefreshErr,
    error: result.error,
    previousStatus: result.previousStatus,
    refreshedStatus: result.refreshedStatus,
    simhuisStatusRaw: result.simhuisStatusRaw,
    changed: false,
  };
}
