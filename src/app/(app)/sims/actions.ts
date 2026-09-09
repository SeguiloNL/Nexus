"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
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
  type SimCsvImportRow,
} from "@/server/services/sim.service";

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
  requirePermission(user.role, "create", "sim");

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

  const ctx = { userId: user.id, userRole: user.role };
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
  requirePermission(user.role, "edit", "sim");

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

  const ctx = { userId: user.id, userRole: user.role };
  await updateSim(simId, validated.data, ctx);

  revalidatePath("/sims");
  revalidatePath(`/sims/${simId}`);
  redirect(`/sims/${simId}`);
}

export async function deleteSimAction(simId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "sim");

  const ctx = { userId: user.id, userRole: user.role };
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
  requirePermission(user.role, "import", "sim");

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
  requirePermission(user.role, "import", "sim");

  if (!prev.preview?.valid.length) {
    return { ...prev, message: "Geen geldige rijen om te importeren." };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const result = await bulkImportSims(prev.preview.valid, ctx);

  revalidatePath("/sims");
  return { ...prev, committed: result };
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
