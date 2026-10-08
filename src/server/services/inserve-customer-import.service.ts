import { prisma } from "@/lib/prisma";
import type { Customer } from "@prisma/client";
import type { InserveCompany } from "../integrations/inserve/types";
import { inserveClient, InserveApiError } from "../integrations/inserve/client";
import {
  listAllCompanies,
  resolveNexusFieldFromCompany,
  listCompanyCustomFields,
} from "../integrations/inserve/service";
import { logAudit } from "./audit.service";
import { generateCustomerNumber } from "@/lib/identifiers";
import {
  getSyncJobConfig,
  createSyncJobRun,
  completeSyncJobRun,
} from "./sync-schedule.service";
import {
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
  RoleScope,
  AuditAction,
} from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

export type ImportUserCtx = {
  userId: string;
  userRole?: unknown | null;
  roleId?: string | null;
  roleScope?: RoleScope | null;
  permissions?: PermissionBits | null;
  customerIds?: string[] | null;
};

export type NexusFieldResolution =
  | { status: "active"; rawValue: string }
  | { status: "inactive"; rawValue: string }
  | { status: "missing" }
  | { status: "empty" }
  | { status: "fetch_error"; errorMessage: string }
  | { status: "parse_error"; errorMessage: string };

export interface ImportSummary {
  runId: string | null;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  fetched: number;
  activeFilterPassed: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: {
    inactive_or_missing_nexus_field: number;
    missing_required_fields: number;
    fetch_error_nexus: number;
    other: number;
  };
  failed: number;
  errorMessage?: string | null;
  pagesProcessed: number;
  totalExpected: number;
  possibleUnlinkedMatches?: Array<{
    inserveCompanyId: number;
    inserveName: string;
    inserveKvkNr?: string | null;
    inserveEmail?: string | null;
    inservePostalCode?: string | null;
    nexusCustomerId?: string | null;
    nexusCompanyName?: string | null;
    reason: "kvk" | "email" | "name_postcode";
  }>;
  previouslyActiveNowInactive?: Array<{
    customerId: string;
    inserveCompanyId: number;
    companyName: string;
  }>;
  skippedDetails?: Array<{
    companyId?: number | null;
    companyName?: string | null;
    reason: string;
  }>;
  failedDetails?: Array<{
    companyId?: number | null;
    companyName?: string | null;
    error: string;
  }>;
}

const MAPPED_FIELDS: Array<
  | "companyName"
  | "customerNumber"
  | "address"
  | "postalCode"
  | "city"
  | "country"
  | "phone"
  | "email"
  | "kvkNr"
  | "btwNr"
> = [
  "companyName",
  "customerNumber",
  "address",
  "postalCode",
  "city",
  "country",
  "phone",
  "email",
  "kvkNr",
  "btwNr",
];

export function resolveNexusFieldValue(
  company: InserveCompany,
  customFetchErr?: Error | null
): NexusFieldResolution {
  if (customFetchErr) {
    return {
      status: "fetch_error",
      errorMessage: (customFetchErr.message ?? "Onbekende fout").slice(0, 500),
    };
  }
  const res = resolveNexusFieldFromCompany(company);
  if (res.status === "missing") return { status: "missing" };
  if (res.status === "empty") return { status: "empty" };
  if (res.status === "parse_error") {
    return { status: "parse_error", errorMessage: res.error };
  }
  const val = res.value.trim().toLowerCase();
  if (val === "actief") return { status: "active", rawValue: res.value };
  return { status: "inactive", rawValue: res.value };
}

export async function enrichCompanyWithCustomFields(
  company: InserveCompany
): Promise<InserveCompany> {
  const hasAnyFields =
    Array.isArray(company.custom_fields) ||
    Array.isArray(company.company_fields) ||
    Array.isArray(company.extra_fields) ||
    Array.isArray(company.fields);
  if (hasAnyFields) return company;
  try {
    const fields = await listCompanyCustomFields(company.id);
    if (Array.isArray(fields) && fields.length > 0) {
      return { ...company, custom_fields: fields };
    }
    return company;
  } catch (e: any) {
    if (e instanceof InserveApiError && e.statusCode === 404) {
      return company;
    }
    throw e;
  }
}

function normalizeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export function mapCompanyToCustomerFields(c: InserveCompany) {
  const parts = [c.address_1, c.address_2].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0
  );
  const address = parts.length > 0 ? parts.join(" ") : null;
  return {
    companyName: c.name?.trim() ?? "",
    inserveCompanyId: c.id,
    customerNumber: normalizeString(c.debtor_code),
    address,
    postalCode: normalizeString(c.postal_code),
    city: normalizeString(c.city),
    country: normalizeString(c.country),
    phone: normalizeString(c.telephone),
    email: normalizeString(c.email),
    kvkNr: normalizeString(c.kvk_nr),
    btwNr: normalizeString(c.btw_nr),
  };
}

export function diffCustomerFields(
  existing: Customer,
  mapped: ReturnType<typeof mapCompanyToCustomerFields>
): Partial<Customer> | null {
  const diff: Partial<Customer> = {};
  for (const key of MAPPED_FIELDS) {
    const m = (mapped as any)[key];
    const e = (existing as any)[key];
    const mNorm = typeof m === "string" ? m.trim() : m ?? null;
    const eNorm = typeof e === "string" ? e.trim() : e ?? null;
    if (mNorm !== eNorm) {
      (diff as any)[key] = m ?? null;
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

async function findPossibleUnlinkedMatches(
  fetchedCompanies: InserveCompany[],
  importedKvPairs: Map<number, string>
): Promise<NonNullable<ImportSummary["possibleUnlinkedMatches"]>> {
  const importedIds = new Set(importedKvPairs.keys());
  const candidates = fetchedCompanies.filter((c) => !importedIds.has(c.id));
  if (candidates.length === 0) return [];
  const matches: NonNullable<ImportSummary["possibleUnlinkedMatches"]> = [];
  const unlinkedCustomers = await prisma.customer.findMany({
    where: { inserveCompanyId: null, deletedAt: null },
    select: {
      id: true,
      companyName: true,
      kvkNr: true,
      email: true,
      postalCode: true,
    },
  });
  for (const c of candidates) {
    const cKvk = typeof c.kvk_nr === "string" ? c.kvk_nr.trim() : "";
    const cEmail = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    const cName = typeof c.name === "string" ? c.name.trim().toLowerCase() : "";
    const cPc = typeof c.postal_code === "string" ? c.postal_code.trim().toLowerCase() : "";
    for (const nc of unlinkedCustomers) {
      if (
        cKvk &&
        nc.kvkNr &&
        cKvk === (nc.kvkNr as string).trim()
      ) {
        matches.push({
          inserveCompanyId: c.id,
          inserveName: c.name ?? `#${c.id}`,
          inserveKvkNr: c.kvk_nr ?? null,
          nexusCustomerId: nc.id,
          nexusCompanyName: nc.companyName,
          reason: "kvk",
        });
        continue;
      }
      if (
        cEmail &&
        nc.email &&
        cEmail === (nc.email as string).trim().toLowerCase()
      ) {
        matches.push({
          inserveCompanyId: c.id,
          inserveName: c.name ?? `#${c.id}`,
          inserveEmail: c.email ?? null,
          nexusCustomerId: nc.id,
          nexusCompanyName: nc.companyName,
          reason: "email",
        });
        continue;
      }
      if (
        cName &&
        nc.companyName &&
        cPc &&
        nc.postalCode &&
        cName === (nc.companyName as string).trim().toLowerCase() &&
        cPc === (nc.postalCode as string).trim().toLowerCase()
      ) {
        matches.push({
          inserveCompanyId: c.id,
          inserveName: c.name ?? `#${c.id}`,
          inservePostalCode: c.postal_code ?? null,
          nexusCustomerId: nc.id,
          nexusCompanyName: nc.companyName,
          reason: "name_postcode",
        });
      }
    }
  }
  return matches.slice(0, 200);
}

export async function runInserveCustomerImport(ctx: ImportUserCtx): Promise<ImportSummary> {
  const startedAt = new Date();

  if (ctx.roleScope && ctx.roleScope !== RoleScope.INTERNAL) {
    return makeFailedSummary(
      startedAt,
      "Import is alleen toegestaan voor interne gebruikers (scope INTERNAL).",
      null
    );
  }

  const existing = await prisma.syncJobRun.findFirst({
    where: {
      jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
      status: { in: [SyncJobStatus.QUEUED, SyncJobStatus.RUNNING] },
    },
    select: { id: true, startedAt: true },
  });
  if (existing) {
    return {
      runId: existing.id,
      status: "SKIPPED",
      startedAt,
      endedAt: new Date(),
      durationMs: 0,
      fetched: 0,
      activeFilterPassed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: {
        inactive_or_missing_nexus_field: 0,
        missing_required_fields: 0,
        fetch_error_nexus: 0,
        other: 0,
      },
      failed: 0,
      pagesProcessed: 0,
      totalExpected: 0,
      errorMessage:
        "Er is reeds een import bezig of gequeued. Wacht tot de vorige is afgerond.",
    };
  }

  const syncJobConfig = await getSyncJobConfig(SyncJobId.INSERVE_CUSTOMER_IMPORT);
  const syncJobRun = await createSyncJobRun(prisma, {
    configId: syncJobConfig.id,
    jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
    triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
    userId: ctx.userId ?? undefined,
    status: SyncJobStatus.RUNNING,
  });

  let finalStatus: SyncJobStatus = SyncJobStatus.SUCCESS;
  let finalErrorMessage: string | null = null;
  let finalErrorDetail: unknown | undefined;

  const summary: ImportSummary = {
    runId: syncJobRun.id,
    status: "SUCCESS",
    startedAt,
    endedAt: new Date(),
    durationMs: 0,
    fetched: 0,
    activeFilterPassed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: {
      inactive_or_missing_nexus_field: 0,
      missing_required_fields: 0,
      fetch_error_nexus: 0,
      other: 0,
    },
    failed: 0,
    pagesProcessed: 0,
    totalExpected: 0,
    skippedDetails: [],
    failedDetails: [],
    possibleUnlinkedMatches: [],
    previouslyActiveNowInactive: [],
  };

  const markPartialFailed = (msg: string, detail?: unknown) => {
    finalStatus = SyncJobStatus.FAILED;
    finalErrorMessage = msg;
    finalErrorDetail = detail;
    summary.status = "FAILED";
    summary.errorMessage = msg;
  };

  try {
    if (!(await inserveClient.isConfigured())) {
      markPartialFailed(
        "Inserve is niet geconfigureerd. Stel INSERVE_SUBDOMAIN en INSERVE_API_KEY in, of configureer via Instellingen → Inserve."
      );
      return finalizeSummary(
        summary,
        syncJobRun.id,
        finalStatus,
        finalErrorMessage,
        finalErrorDetail
      );
    }

    let fetchedCompanies: InserveCompany[] = [];
    try {
      const res = await listAllCompanies({
        withRelations: [
          "custom_fields",
          "company_fields",
          "extra_fields",
          "fields",
        ],
        perPage: 50,
      });
      fetchedCompanies = res.items;
      summary.fetched = res.totalFetched;
      summary.pagesProcessed = res.pagesProcessed;
      summary.totalExpected = res.totalExpected;
      if (res.totalFetched === 0) {
        markPartialFailed(
          `Inserve API gaf 0 bedrijven terug (pagina's verwerkt: ${res.pagesProcessed}, verwachte totaal volgens API: ${res.totalExpected ?? 0}). Controleer of de API-key leesrechten heeft op bedrijven, of dat het juiste endpoint en builder-parameter worden gebruikt.`
        );
      }
    } catch (e: any) {
      if (e instanceof InserveApiError) {
        if (e.statusCode === 401 || e.statusCode === 403) {
          markPartialFailed(
            `Inserve authenticatie mislukt (status ${e.statusCode}). Controleer de API-key en rechten.`
          );
          return finalizeSummary(
            summary,
            syncJobRun.id,
            finalStatus,
            finalErrorMessage,
            finalErrorDetail
          );
        }
      }
      markPartialFailed(
        `Kon bedrijven niet ophalen bij Inserve: ${e?.message ?? String(e)}`,
        { statusCode: (e as any)?.statusCode ?? null }
      );
      return finalizeSummary(
        summary,
        syncJobRun.id,
        finalStatus,
        finalErrorMessage,
        finalErrorDetail
      );
    }

    const previouslyLinkedIds = new Map<number, { id: string; companyName: string }>();
    const preExistingLinked = await prisma.customer.findMany({
      where: { inserveCompanyId: { not: null }, deletedAt: null },
      select: { id: true, inserveCompanyId: true, companyName: true },
    });
    for (const c of preExistingLinked) {
      if (c.inserveCompanyId) {
        previouslyLinkedIds.set(c.inserveCompanyId, {
          id: c.id,
          companyName: c.companyName,
        });
      }
    }
    const nowProcessedLinked = new Map<number, string>();

    for (const rawCompany of fetchedCompanies) {
      const companyId = rawCompany.id;
      let company: InserveCompany = rawCompany;
      let nexus: NexusFieldResolution;

      try {
        const hasFieldsInline =
          Array.isArray(rawCompany.custom_fields) ||
          Array.isArray(rawCompany.company_fields) ||
          Array.isArray(rawCompany.extra_fields) ||
          Array.isArray(rawCompany.fields);
        let customFetchErr: Error | null = null;
        if (!hasFieldsInline) {
          try {
            company = await enrichCompanyWithCustomFields(rawCompany);
          } catch (fe: any) {
            customFetchErr = fe instanceof Error ? fe : new Error(String(fe));
          }
        }
        nexus = resolveNexusFieldValue(company, customFetchErr);
      } catch (topErr: any) {
        nexus = {
          status: "fetch_error",
          errorMessage: (topErr?.message ?? "Onbekende fout").slice(0, 500),
        };
      }

      if (previouslyLinkedIds.has(companyId)) {
        if (nexus.status !== "active") {
          summary.previouslyActiveNowInactive!.push({
            customerId: previouslyLinkedIds.get(companyId)!.id,
            inserveCompanyId: companyId,
            companyName:
              (company.name as string | undefined) ??
              previouslyLinkedIds.get(companyId)!.companyName,
          });
          summary.skipped.inactive_or_missing_nexus_field++;
          summary.skippedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            reason:
              nexus.status === "fetch_error"
                ? `Nexus-vrij-veld: ${(nexus as any).errorMessage?.slice(0, 200)}`
                : nexus.status === "inactive"
                ? `Nexus = ${(nexus as any).rawValue} (Actief verwacht); niet bijwerken.`
                : `Nexus veld ontbreekt of is leeg; niet bijwerken.`,
          });
          nowProcessedLinked.set(
            companyId,
            previouslyLinkedIds.get(companyId)!.id
          );
          continue;
        }
      }

      if (nexus.status !== "active") {
        if (nexus.status === "fetch_error") {
          summary.skipped.fetch_error_nexus++;
          summary.failed++;
          markPartialFailed(
            "Een of meer bedrijven konden niet worden verwerkt door fouten bij het ophalen van vrije velden. Zie failedDetails."
          );
          summary.failedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            error: `Vrij veld Nexus: ${(nexus as any).errorMessage?.slice(0, 400)}`,
          });
        } else {
          summary.skipped.inactive_or_missing_nexus_field++;
          summary.skippedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            reason:
              nexus.status === "inactive"
                ? `Nexus = ${(nexus as any).rawValue} (ongelijk aan Actief)`
                : nexus.status === "empty"
                ? `Nexus veld is leeg`
                : `Nexus veld ontbreekt`,
          });
        }
        continue;
      }

      summary.activeFilterPassed++;

      if (
        !company.name ||
        typeof company.name !== "string" ||
        company.name.trim() === ""
      ) {
        summary.skipped.missing_required_fields++;
        summary.skippedDetails!.push({
          companyId,
          companyName: null,
          reason: "Bedrijfsnaam ontbreekt (verplicht veld).",
        });
        continue;
      }

      try {
        const mapped = mapCompanyToCustomerFields(company);
        const existingCustomer = previouslyLinkedIds.has(companyId)
          ? await prisma.customer.findUnique({
              where: { id: previouslyLinkedIds.get(companyId)!.id },
            })
          : await prisma.customer.findUnique({
              where: { inserveCompanyId: companyId },
            });

        if (existingCustomer) {
          nowProcessedLinked.set(companyId, existingCustomer.id);
          const diff = diffCustomerFields(existingCustomer, mapped);
          if (!diff) {
            summary.unchanged++;
            continue;
          }
          await prisma.$transaction(async (tx) => {
            const updated = await tx.customer.update({
              where: { id: existingCustomer.id },
              data: diff,
            });
            await logAudit(tx as any, {
              entityType: "customer",
              entityId: updated.id,
              action: AuditAction.UPDATE,
              userId: ctx.userId,
              oldValues: diff as any,
              newValues: diff as any,
              metadata: {
                source: "inserve_customer_import",
                inserveCompanyId: companyId,
              },
            });
          });
          summary.updated++;
        } else {
          const created = await prisma.$transaction(async (tx) => {
            const customerNumber =
              mapped.customerNumber ||
              (await generateCustomerNumber(tx as any));
            const c = await tx.customer.create({
              data: {
                companyName: mapped.companyName,
                inserveCompanyId: mapped.inserveCompanyId,
                customerNumber,
                address: mapped.address,
                postalCode: mapped.postalCode,
                city: mapped.city,
                country: mapped.country,
                phone: mapped.phone,
                email: mapped.email,
                kvkNr: mapped.kvkNr,
                btwNr: mapped.btwNr,
                status: "ACTIVE" as any,
              },
            });
            await logAudit(tx as any, {
              entityType: "customer",
              entityId: c.id,
              action: AuditAction.CREATE,
              userId: ctx.userId,
              newValues: c as unknown as Record<string, unknown>,
              metadata: {
                source: "inserve_customer_import",
                inserveCompanyId: companyId,
              },
            });
            return c;
          });
          nowProcessedLinked.set(companyId, created.id);
          summary.created++;
        }
      } catch (recordErr: any) {
        summary.failed++;
        markPartialFailed(
          "Een of meer records konden niet worden verwerkt. Zie failedDetails voor meer informatie."
        );
        summary.failedDetails!.push({
          companyId,
          companyName: (company.name as string | null) ?? null,
          error: (recordErr?.message ?? String(recordErr)).slice(0, 400),
        });
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        const summaryForAudit = {
          fetched: summary.fetched,
          active: summary.activeFilterPassed,
          created: summary.created,
          updated: summary.updated,
          unchanged: summary.unchanged,
          skipped: summary.skipped,
          failed: summary.failed,
        };
        if (summary.created > 0 || summary.updated > 0) {
          await logAudit(tx as any, {
            entityType: "sync_job_run",
            entityId: syncJobRun.id,
            action: AuditAction.INSERVE_CUSTOMERS_IMPORTED,
            userId: ctx.userId,
            newValues: summaryForAudit as any,
            metadata: {
              jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
              source: "inserve_customer_import",
            },
          });
        } else if (summary.failed > 0) {
          await logAudit(tx as any, {
            entityType: "sync_job_run",
            entityId: syncJobRun.id,
            action: AuditAction.INSERVE_CUSTOMER_IMPORT_FAILED,
            userId: ctx.userId,
            newValues: summaryForAudit as any,
            metadata: {
              jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
              source: "inserve_customer_import",
            },
          });
        }
      });
    } catch (_) {
      // audit failure is not fatal
    }

    try {
      summary.possibleUnlinkedMatches = await findPossibleUnlinkedMatches(
        fetchedCompanies,
        nowProcessedLinked
      );
    } catch (_) {
      summary.possibleUnlinkedMatches = [];
    }
  } catch (topErr: any) {
    markPartialFailed(`Import mislukt: ${topErr?.message ?? String(topErr)}`, {
      code: (topErr as any)?.code ?? null,
    });
  }

  return finalizeSummary(
    summary,
    syncJobRun.id,
    finalStatus,
    finalErrorMessage,
    finalErrorDetail
  );
}

function finalizeSummary(
  summary: ImportSummary,
  runId: string,
  status: SyncJobStatus,
  errorMessage: string | null,
  errorDetail: unknown | undefined
): ImportSummary {
  const endedAt = new Date();
  summary.endedAt = endedAt;
  summary.durationMs = Math.max(
    0,
    endedAt.getTime() - summary.startedAt.getTime()
  );
  summary.runId = runId;
  summary.status =
    status === SyncJobStatus.SUCCESS ? "SUCCESS" : "FAILED";
  summary.errorMessage = errorMessage;

  const recordsAffected = {
    fetched: summary.fetched,
    activeFilterPassed: summary.activeFilterPassed,
    created: summary.created,
    updated: summary.updated,
    unchanged: summary.unchanged,
    skipped: summary.skipped,
    failed: summary.failed,
    ...(summary.possibleUnlinkedMatches &&
    summary.possibleUnlinkedMatches.length > 0
      ? { possibleMatches: summary.possibleUnlinkedMatches.length }
      : {}),
    ...(summary.previouslyActiveNowInactive &&
    summary.previouslyActiveNowInactive.length > 0
      ? { previouslyActiveNowInactive: summary.previouslyActiveNowInactive.length }
      : {}),
    skippedSample: summary.skippedDetails?.slice(0, 20),
    failedSample: summary.failedDetails?.slice(0, 20),
  };

  completeSyncJobRun(prisma, {
    id: runId,
    status,
    startedAt: summary.startedAt,
    recordsAffected,
    errorMessage,
    errorDetail,
  }).catch((e) =>
    console.error(
      "[inserve-customer-import] Kon syncJobRun niet voltooien:",
      e?.message ?? String(e)
    )
  );

  return summary;
}

function makeFailedSummary(
  startedAt: Date,
  message: string,
  runId: string | null
): ImportSummary {
  const endedAt = new Date();
  return {
    runId,
    status: "FAILED",
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    fetched: 0,
    activeFilterPassed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: {
      inactive_or_missing_nexus_field: 0,
      missing_required_fields: 0,
      fetch_error_nexus: 0,
      other: 0,
    },
    failed: 0,
    errorMessage: message,
    pagesProcessed: 0,
    totalExpected: 0,
    possibleUnlinkedMatches: [],
    previouslyActiveNowInactive: [],
    skippedDetails: [],
    failedDetails: [],
  };
}
