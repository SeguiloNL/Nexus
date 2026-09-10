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
  requirePermission(user.role, "create", "customer");

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

  const ctx = { userId: user.id, userRole: user.role };
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
  requirePermission(user.role, "edit", "customer");

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

  const ctx = { userId: user.id, userRole: user.role };
  await updateCustomer(customerId, validated.data, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function deleteCustomerAction(customerId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "customer");

  const ctx = { userId: user.id, userRole: user.role };
  await softDeleteCustomer(customerId, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect("/customers");
}

export async function exportCustomersCsvAction(): Promise<Response> {
  const user = await getCurrentUser();
  requirePermission(user.role, "export", "customer");

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
  requirePermission(user.role, "import", "customer");

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
  requirePermission(user.role, "import", "customer");

  if (!prev.preview?.valid.length) {
    return { ...prev, message: "Geen geldige rijen om te importeren." };
  }

  const ctx = { userId: user.id, userRole: user.role };
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
