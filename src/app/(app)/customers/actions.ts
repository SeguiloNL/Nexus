"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildCsv, csvDownloadResponse, filenameTimestamp } from "@/lib/csv";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
} from "@/server/validators/customer";
import {
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
  previewCustomerCsvImport,
  bulkImportCustomers,
  type CustomerCsvImportRow,
} from "@/server/services/customer.service";
import {
  createContactService,
  deleteContactService,
  updateContactService,
} from "@/server/services/contact.service";
import type {
  CreateContactInput,
  UpdateContactInput,
} from "@/server/validators/contact";
import { CreateContactSchema, UpdateContactSchema, DeleteContactSchema } from "@/server/validators/contact";
import { runInserveCustomerImport } from "@/server/services/inserve-customer-import.service";
import type { ImportSummary } from "@/server/services/inserve-customer-import.service";
import { pickAuth } from "@/lib/rbac";
import { RoleScope, SyncJobId, SyncJobStatus, SyncJobTrigger } from "@/types/enums";
import { getSyncJobConfig, createSyncJobRun } from "@/server/services/sync-schedule.service";

export type CustomerActionState = {
  errors?: Partial<Record<keyof CreateCustomerInput, string[]>>;
  message?: string | null;
  customerId?: string;
};

export async function createCustomerAction(
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "create", "customer");

  const data = {
    customerNumber: formData.get("customerNumber") || undefined,
    companyName: formData.get("companyName"),
    parentCustomerId: formData.get("parentCustomerId") || null,
    address: formData.get("address") || null,
    postalCode: formData.get("postalCode") || null,
    city: formData.get("city") || null,
    country: formData.get("country") || null,
    contactPerson: formData.get("contactPerson") || null,
    phone: formData.get("phone") || null,
    email: formData.get("email") || null,
    kvkNr: formData.get("kvkNr") || null,
    btwNr: formData.get("btwNr") || null,
    inserveCompanyId: formData.get("inserveCompanyId") || null,
    status: (formData.get("status") as CreateCustomerInput["status"]) ??
      undefined,
    type: (formData.get("type") as CreateCustomerInput["type"]) ?? undefined,
    notes: formData.get("notes") || null,
  };

  if (data.parentCustomerId === "none" || data.parentCustomerId === "") {
    data.parentCustomerId = null;
  }

  const validated = CreateCustomerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as CustomerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const customer = await createCustomer(validated.data, ctx);

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "customer");

  const data: {
    companyName?: string;
    parentCustomerId?: string | null;
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    kvkNr?: string | null;
    btwNr?: string | null;
    inserveCompanyId?: number | string | null;
    status?: CreateCustomerInput["status"];
    type?: CreateCustomerInput["type"] | null;
    notes?: string | null;
  } = {
    companyName: (formData.get("companyName") as string) || undefined,
    parentCustomerId: (formData.get("parentCustomerId") as string) ?? null,
    address: (formData.get("address") as string) ?? null,
    postalCode: (formData.get("postalCode") as string) ?? null,
    city: (formData.get("city") as string) ?? null,
    country: (formData.get("country") as string) ?? null,
    contactPerson: (formData.get("contactPerson") as string) ?? null,
    phone: (formData.get("phone") as string) ?? null,
    email: (formData.get("email") as string) ?? null,
    kvkNr: (formData.get("kvkNr") as string) ?? null,
    btwNr: (formData.get("btwNr") as string) ?? null,
    inserveCompanyId: (formData.get("inserveCompanyId") as string) ?? null,
    status: (formData.get("status") as CreateCustomerInput["status"]) ??
      undefined,
    type: (formData.get("type") as CreateCustomerInput["type"]) ?? undefined,
    notes: (formData.get("notes") as string) ?? null,
  };

  if (data.parentCustomerId === "none" || data.parentCustomerId === "") {
    data.parentCustomerId = null;
  }

  const validated = UpdateCustomerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as CustomerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  await updateCustomer(customerId, validated.data, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function deleteCustomerAction(customerId: string) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "customer");

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  await softDeleteCustomer(customerId, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect("/customers");
}

export async function exportCustomersCsvAction(): Promise<Response> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "export", "customer");

  const rows = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { customerNumber: "asc" },
  });

  const headers = [
    "customerNumber",
    "companyName",
    "parentCustomerId",
    "address",
    "postalCode",
    "city",
    "country",
    "contactPerson",
    "phone",
    "email",
    "kvkNr",
    "btwNr",
    "status",
    "inserveCompanyId",
    "createdAt",
    "notes",
  ];

  const csvRows: Array<Array<unknown>> = rows.map((c) => [
    c.customerNumber,
    c.companyName,
    c.parentCustomerId ?? "",
    c.address ?? "",
    c.postalCode ?? "",
    c.city ?? "",
    c.country ?? "",
    c.contactPerson ?? "",
    c.phone ?? "",
    c.email ?? "",
    c.kvkNr ?? "",
    c.btwNr ?? "",
    c.status,
    c.inserveCompanyId ?? "",
    c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    c.notes ?? "",
  ]);

  const csv = buildCsv(headers, csvRows);
  const filename = `klanten-${filenameTimestamp()}.csv`;
  return csvDownloadResponse(filename, csv);
}

export type CustomerCsvImportActionState = {
  message?: string | null;
  preview?: any;
  committed?: { count: number; ids: string[] } | null;
  rows?: CustomerCsvImportRow[];
};

export async function previewCustomerCsvAction(
  _prev: CustomerCsvImportActionState,
  formData: FormData
): Promise<CustomerCsvImportActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "import", "customer");

  const file = formData.get("file") as File | null;
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    return { message: "Upload een geldig CSV-bestand." };
  }

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    const preview = previewCustomerCsvImport(rows);
    return { preview, rows };
  } catch (e) {
    return { message: "Fout bij parsen van CSV: " + (e as Error).message };
  }
}

export async function commitCustomerCsvAction(
  prev: CustomerCsvImportActionState,
  _formData: FormData
): Promise<CustomerCsvImportActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "import", "customer");

  if (!prev.preview?.valid.length) {
    return { ...prev, message: "Geen geldige rijen om te importeren." };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const result = await bulkImportCustomers(prev.preview.valid, ctx);

  revalidatePath("/customers");
  return { ...prev, committed: result };
}

function parseCsv(text: string): CustomerCsvImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ""));

  const keyMap: Record<string, keyof CustomerCsvImportRow> = {
    customernumber: "customerNumber",
    "customer number": "customerNumber",
    klantnummer: "customerNumber",
    klantnr: "customerNumber",
    companyname: "companyName",
    "company name": "companyName",
    bedrijf: "companyName",
    bedrijfsnaam: "companyName",
    naam: "companyName",
    parentcustomerid: "parentCustomerId",
    "parent customer id": "parentCustomerId",
    parentcustomer: "parentCustomerId",
    address: "address",
    adres: "address",
    straat: "address",
    postalcode: "postalCode",
    "postal code": "postalCode",
    postcode: "postalCode",
    pc: "postalCode",
    city: "city",
    plaats: "city",
    stad: "city",
    woonplaats: "city",
    country: "country",
    land: "country",
    contactperson: "contactPerson",
    "contact person": "contactPerson",
    contactpersoon: "contactPerson",
    contact: "contactPerson",
    phone: "phone",
    telefoon: "phone",
    telefoonnummer: "phone",
    tel: "phone",
    email: "email",
    e_mail: "email",
    "e-mail": "email",
    mail: "email",
    kvknr: "kvkNr",
    kvk: "kvkNr",
    "kvk nummer": "kvkNr",
    btwnr: "btwNr",
    btw: "btwNr",
    "btw nummer": "btwNr",
    vat: "btwNr",
    inservecompanyid: "inserveCompanyId",
    "inserve company id": "inserveCompanyId",
    inserve: "inserveCompanyId",
    status: "status",
    notes: "notes",
    notities: "notes",
    opmerkingen: "notes",
    opmerking: "notes",
  };

  const rows: CustomerCsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj: any = {};
    headers.forEach((h, idx) => {
      const key = keyMap[h] || (h as keyof CustomerCsvImportRow);
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

export async function startInserveCustomerImportAction(): Promise<{
  ok: boolean;
  error?: string;
  summary?: ImportSummary;
}> {
  const user = await getCurrentUser();
  await requirePermission(pickAuth(user), "import_from_inserve", "customer");

  const scope = (user.roleScope ?? "") as unknown as RoleScope;
  if (user.roleScope && scope !== RoleScope.INTERNAL) {
    return { ok: false, error: "Alleen interne gebruikers kunnen deze import starten." };
  }

  try {
    const summary = await runInserveCustomerImport({
      userId: user.id,
      userRole: (user as any).role,
      roleId: user.roleId,
      roleScope: user.roleScope as any,
      permissions: user.permissions as any,
      customerIds: user.customerIds as any,
    });
    if (summary.status === "FAILED" || summary.status === "SKIPPED") {
      return {
        ok: false,
        error: summary.errorMessage ?? (summary.status === "SKIPPED" ? "Import is overgeslagen." : "Import is gedeeltelijk mislukt."),
        summary,
      };
    }
    revalidatePath("/customers");
    revalidatePath("/customers/import");
    return { ok: true, summary };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function startInserveCustomerImportWithProgressAction(): Promise<{
  ok: boolean;
  error?: string;
  runId?: string;
  initialStatus?: "SKIPPED";
  skipMessage?: string;
}> {
  const user = await getCurrentUser();
  await requirePermission(pickAuth(user), "import_from_inserve", "customer");
  const scope = (user.roleScope ?? "") as unknown as RoleScope;
  if (user.roleScope && scope !== RoleScope.INTERNAL) {
    return { ok: false, error: "Alleen interne gebruikers kunnen deze import starten." };
  }
  try {
    const syncJobConfig = await getSyncJobConfig(SyncJobId.INSERVE_CUSTOMER_IMPORT);
    const MUTEX_STALE_MS = 10 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - MUTEX_STALE_MS);
    const bestaande = await prisma.syncJobRun.findFirst({
      where: {
        jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
        status: { in: [SyncJobStatus.QUEUED, SyncJobStatus.RUNNING] },
        startedAt: { gt: staleCutoff },
      },
      select: { id: true, startedAt: true, status: true },
    });
    if (bestaande) {
      const ageSec = Math.max(0, Math.round((Date.now() - bestaande.startedAt.getTime()) / 1000));
      return {
        ok: true,
        runId: bestaande.id,
        initialStatus: "SKIPPED",
        skipMessage: `Er is reeds een import bezig (status: ${bestaande.status}, leeftijd: ${ageSec}s).`,
      };
    }
    const created = await createSyncJobRun(prisma, {
      configId: syncJobConfig.id,
      jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
      triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
      userId: user.id ?? undefined,
      status: SyncJobStatus.RUNNING,
    });
    const runId = created.id;
    // Fire-and-forget de import zodat UI direct runId krijgt en op SSE kan subscriben.
    // Gebruik Promise.resolve().then() zodat de HTTP response eerst geschreven wordt.
    Promise.resolve()
      .then(async () => {
        try {
          await runInserveCustomerImport(
            {
              userId: user.id,
              userRole: (user as any).role,
              roleId: (user as any).roleId,
              roleScope: (user as any).roleScope,
              permissions: (user as any).permissions,
              customerIds: (user as any).customerIds,
              triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
            } as any,
            {
              skipRunManagement: true,
              preExistingRunId: runId,
              progressSubPercentStep: 5,
            }
          );
        } catch (topE: any) {
          // Bovenstaande try/catch binnen service zou moeten finalizen; hier als final safeguard ook.
          try {
            const { initProgress, finalizeProgress } = await import(
              "@/lib/progress/sync-progress-registry"
            );
            initProgress(runId);
            finalizeProgress(runId, "FAILED", {
              errorMessage: (topE as Error)?.message ?? String(topE),
            });
          } catch {
            /* noop */
          }
        }
      })
      .catch(() => {
        /* swallow */
      });
    revalidatePath("/customers");
    revalidatePath("/customers/import");
    return { ok: true, runId };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}


// ---------------- Contactpersonen actions ----------------

export type ContactActionState = {
  errors?: Partial<Record<string, string[]>>;
  message?: string | null;
  contactId?: string;
};

function formStr(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (v === null || v === undefined || typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function formNum(formData: FormData, key: string): number | undefined {
  const s = formStr(formData, key);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && Number.isInteger(n) ? n : undefined;
}

function readContactForm(
  formData: FormData,
  overrides: Partial<Record<string, unknown>> = {}
): CreateContactInput & { id?: string } {
  return {
    id: (overrides.id as string | undefined) ?? formStr(formData, "id"),
    customerId: (overrides.customerId as string | undefined) ?? formStr(formData, "customerId")!,
    firstName: formStr(formData, "firstName"),
    lastName: formStr(formData, "lastName")!,
    email: formStr(formData, "email"),
    phone: formStr(formData, "phone"),
    mobile: formStr(formData, "mobile"),
    functionTitle: formStr(formData, "functionTitle"),
    inserveContactId:
      (overrides.inserveContactId as number | undefined) ?? formNum(formData, "inserveContactId"),
  };
}

export async function createContactAction(
  customerId: string,
  _prev: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const user = await getCurrentUser();
  await requirePermission(pickAuth(user), "create", "customer");

  const data = readContactForm(formData, { customerId });
  const parsed = CreateContactSchema.safeParse(data);
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors as ContactActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const created = await createContactService(parsed.data, ctx as any);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/customers`);
    return { contactId: created.id, message: "Contactpersoon toegevoegd." };
  } catch (e: any) {
    return { message: e?.message ?? String(e) };
  }
}

export async function updateContactAction(
  customerId: string,
  contactId: string,
  _prev: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const user = await getCurrentUser();
  await requirePermission(pickAuth(user), "edit", "customer");

  const data = readContactForm(formData, { customerId, id: contactId });
  const parsed = UpdateContactSchema.safeParse({ ...data, id: contactId });
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors as ContactActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const updated = await updateContactService(contactId, parsed.data, ctx as any);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath(`/customers`);
    return { contactId: updated.id, message: "Contactpersoon bijgewerkt." };
  } catch (e: any) {
    return { message: e?.message ?? String(e) };
  }
}

export async function deleteContactAction(customerId: string, contactId: string) {
  const user = await getCurrentUser();
  await requirePermission(pickAuth(user), "delete", "customer");
  DeleteContactSchema.parse({ id: contactId });

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: user.customerId,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await deleteContactService(contactId, ctx as any);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/customers`);
  return { ok: true };
}


