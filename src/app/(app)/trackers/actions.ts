"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildCsv, csvDownloadResponse, filenameTimestamp } from "@/lib/csv";
import {
  CreateTrackerSchema,
  UpdateTrackerSchema,
  type CreateTrackerInput,
} from "@/server/validators/tracker";
import {
  createTracker,
  softDeleteTracker,
  updateTracker,
  previewTrackerCsvImport,
  bulkImportTrackers,
  type CsvImportRow,
} from "@/server/services/tracker.service";

export type TrackerActionState = {
  errors?: Partial<Record<keyof CreateTrackerInput, string[]>>;
  message?: string | null;
  trackerId?: string;
};

export type CsvImportActionState = {
  message?: string | null;
  preview?: any;
  committed?: { count: number; ids: string[] } | null;
  rows?: CsvImportRow[];
};

export async function createTrackerAction(
  _prev: TrackerActionState,
  formData: FormData
): Promise<TrackerActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "tracker");

  const data = {
    serialNumber: formData.get("serialNumber") || undefined,
    imei: formData.get("imei") || undefined,
    brand: formData.get("brand") || undefined,
    model: formData.get("model") || undefined,
    hardwareType: formData.get("hardwareType") || null,
    firmwareVersion: formData.get("firmwareVersion") || null,
    purchaseDate: formData.get("purchaseDate") || null,
    supplier: formData.get("supplier") || null,
    status: (formData.get("status") as CreateTrackerInput["status"]) ??
      undefined,
    notes: formData.get("notes") || null,
  };

  const validated = CreateTrackerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as TrackerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const tracker = await createTracker(validated.data, ctx);

  revalidatePath("/trackers");
  redirect(`/trackers/${tracker.id}`);
}

export async function updateTrackerAction(
  trackerId: string,
  _prev: TrackerActionState,
  formData: FormData
): Promise<TrackerActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "tracker");

  const data: any = {
    brand: (formData.get("brand") as string) || undefined,
    model: (formData.get("model") as string) || undefined,
    hardwareType: (formData.get("hardwareType") as string) || null,
    firmwareVersion: (formData.get("firmwareVersion") as string) || null,
    purchaseDate: (formData.get("purchaseDate") as string) || null,
    supplier: (formData.get("supplier") as string) || null,
    status: (formData.get("status") as CreateTrackerInput["status"]) ??
      undefined,
    notes: (formData.get("notes") as string) || null,
  };

  const validated = UpdateTrackerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as TrackerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  await updateTracker(trackerId, validated.data, ctx);

  revalidatePath("/trackers");
  revalidatePath(`/trackers/${trackerId}`);
  redirect(`/trackers/${trackerId}`);
}

export async function deleteTrackerAction(trackerId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "tracker");

  const ctx = { userId: user.id, userRole: user.role };
  await softDeleteTracker(trackerId, ctx);

  revalidatePath("/trackers");
  revalidatePath(`/trackers/${trackerId}`);
  redirect("/trackers");
}

export async function previewTrackerCsvAction(
  _prev: CsvImportActionState,
  formData: FormData
): Promise<CsvImportActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "import", "tracker");

  const file = formData.get("file") as File | null;
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    return { message: "Upload een geldig CSV-bestand." };
  }

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const preview = previewTrackerCsvImport(rows);
    return { preview, rows };
  } catch (e) {
    return { message: "Fout bij parsen van CSV: " + (e as Error).message };
  }
}

export async function commitTrackerCsvAction(
  prev: CsvImportActionState,
  _formData: FormData
): Promise<CsvImportActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "import", "tracker");

  if (!prev.preview?.valid.length) {
    return { ...prev, message: "Geen geldige rijen om te importeren." };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const result = await bulkImportTrackers(prev.preview.valid, ctx);

  revalidatePath("/trackers");
  return { ...prev, committed: result };
}

export async function exportTrackersCsvAction(): Promise<Response> {
  const user = await getCurrentUser();
  requirePermission(user.role, "export", "tracker");

  const rows = await prisma.tracker.findMany({
    where: { deletedAt: null },
    orderBy: { serialNumber: "asc" },
  });

  const headers = [
    "serialNumber",
    "imei",
    "brand",
    "model",
    "hardwareType",
    "firmwareVersion",
    "purchaseDate",
    "supplier",
    "status",
    "createdAt",
    "notes",
  ];

  const csvRows: Array<Array<unknown>> = rows.map((t) => [
    t.serialNumber,
    t.imei,
    t.brand ?? "",
    t.model ?? "",
    t.hardwareType ?? "",
    t.firmwareVersion ?? "",
    t.purchaseDate instanceof Date ? t.purchaseDate.toISOString().slice(0, 10) : t.purchaseDate ?? "",
    t.supplier ?? "",
    t.status,
    t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    t.notes ?? "",
  ]);

  const csv = buildCsv(headers, csvRows);
  const filename = `trackers-${filenameTimestamp()}.csv`;
  return csvDownloadResponse(filename, csv);
}

function parseCsv(text: string): CsvImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ""));

  const keyMap: Record<string, keyof CsvImportRow> = {
    serialnumber: "serialNumber",
    "serial number": "serialNumber",
    serienummer: "serialNumber",
    imei: "imei",
    brand: "brand",
    merk: "brand",
    model: "model",
    hardwaretype: "hardwareType",
    "hardware type": "hardwareType",
    firmwareversion: "firmwareVersion",
    "firmware version": "firmwareVersion",
    firmware: "firmwareVersion",
    purchasedate: "purchaseDate",
    "purchase date": "purchaseDate",
    datum: "purchaseDate",
    supplier: "supplier",
    leverancier: "supplier",
    notes: "notes",
    notities: "notes",
    opmerkingen: "notes",
  };

  const rows: CsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj: any = {};
    headers.forEach((h, idx) => {
      const key = keyMap[h] || (h as keyof CsvImportRow);
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
