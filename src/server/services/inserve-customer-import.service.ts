import { prisma } from "@/lib/prisma";
import type { Customer } from "@prisma/client";
import type { InserveCompany } from "../integrations/inserve/types";
import {
  inserveClient,
  InserveApiError,
  InserveRateLimitExceededError,
  isInserveRateLimitError,
} from "../integrations/inserve/client";
import {
  listAllCompanies,
  resolveNexusFieldFromCompany,
  listCompanyCustomFields,
} from "../integrations/inserve/service";
import { logAudit, diffObject } from "./audit.service";
import { generateCustomerNumber } from "@/lib/identifiers";
import { runInserveSimAssetLink, EMPTY_SIM_LINK_SUMMARY, type SimLinkSummary } from "./inserve-sim-link.service";
import {
  getSyncJobConfig,
  createSyncJobRun,
  completeSyncJobRun,
} from "./sync-schedule.service";
import {
  initProgress,
  setStepActive,
  setStepDone,
  setStepFailed,
  setStepSkipped,
  setStepSubPercent,
  finalizeProgress,
  getCurrentState,
  subscribe,
  type SyncProgressState,
  STEPS_INSERVE_CUSTOMER_IMPORT,
} from "@/lib/progress/sync-progress-registry";
import {
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
  RoleScope,
  AuditAction,
  CustomerStatus,
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
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "SKIPPED";
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  fetched: number;
  activeFilterPassed: number;
  created: number;
  updated: number;
  unchanged: number;
  customersReactivated: number;
  customersDeactivated: number;
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
  inserveCredentials: {
    configured: boolean;
    source: "db" | "env" | "none";
    subdomainSet: boolean;
    apiKeySet: boolean;
    subdomainPrefix?: string;
  };
  timingMs: {
    total: number;
    roleScopeCheck: number;
    mutexCheck: number;
    createConfigAndRun: number;
    inserveInit: number;
    fetchCompanies: number;
    fetchPreExisting: number;
    processRecords: number;
    linkSimAssets: number;
    findMatches: number;
    finalize: number;
  };
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
  previouslyInactiveNowActive?: Array<{
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
  /**
   * Alleen gevuld wanneer de import in dry-run/proefmodus draaide
   * (`opts.dryRun === true`). Bevat de berekende wijzigingsset die *zou*
   * worden toegepast, zonder dat er ook maar één schrijfbewerking heeft
   * plaatsgevonden.
   */
  dryRun: boolean;
  plannedChanges?: PlannedChanges;
  simLink: SimLinkSummary;
}

/**
 * Beschrijft de berekende wijzigingsset van een dry-run. Alle aantallen zijn
 * op basis van de bronlezing en de diff-berekening; er is niets geschreven.
 */
export interface PlannedChanges {
  companies: {
    create: number;
    update: number;
    deactivate: number;
    reactivate: number;
    unchanged: number;
  };
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
  if (val === "actief" || val === "ja" || val === "active" || val === "yes" || val === "1" || val === "true") {
    return { status: "active", rawValue: res.value };
  }
  if (val === "inactief" || val === "nee" || val === "inactive" || val === "no" || val === "0" || val === "false") {
    return { status: "inactive", rawValue: res.value };
  }
  if (res.raw && typeof res.raw === "object") {
    try {
      const cfo = (res.raw as any).custom_field_object;
      if (cfo && Array.isArray(cfo.options)) {
        for (const opt of cfo.options) {
          const optLabel = typeof opt.label === "string" ? opt.label.trim().toLowerCase() : "";
          const optName = typeof opt.name === "string" ? opt.name.trim().toLowerCase() : "";
          const matchVal =
            val === String(opt.id ?? "").toLowerCase() ||
            val === (String(opt.value ?? "").toLowerCase()) ||
            val === optName ||
            val === optLabel;
          if (matchVal) {
            if (optLabel === "actief" || optName === "ja") return { status: "active", rawValue: res.value };
            if (optLabel === "inactief" || optName === "inactief" || optName === "nee") {
              return { status: "inactive", rawValue: res.value };
            }
          }
        }
      }
    } catch {
    }
  }
  return { status: "inactive", rawValue: res.value };
}

export async function enrichCompanyWithCustomFields(
  company: InserveCompany
): Promise<InserveCompany> {
  const hasAnyFields =
    Array.isArray((company as any).customValues) ||
    Array.isArray((company as any).custom_values) ||
    Array.isArray(company.custom_fields) ||
    Array.isArray(company.company_fields) ||
    Array.isArray(company.extra_fields) ||
    Array.isArray(company.fields);
  if (hasAnyFields) return company;
  try {
    const fields = await listCompanyCustomFields(company.id, company);
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

const ZERO_TIMING: ImportSummary["timingMs"] = {
  total: 0,
  roleScopeCheck: 0,
  mutexCheck: 0,
  createConfigAndRun: 0,
  inserveInit: 0,
  fetchCompanies: 0,
  fetchPreExisting: 0,
  processRecords: 0,
  linkSimAssets: 0,
  findMatches: 0,
  finalize: 0,
};

const ZERO_SKIPPED: ImportSummary["skipped"] = {
  inactive_or_missing_nexus_field: 0,
  missing_required_fields: 0,
  fetch_error_nexus: 0,
  other: 0,
};

const DEFAULT_UNCONFIGURED_CREDS: ImportSummary["inserveCredentials"] = {
  configured: false,
  source: "none",
  subdomainSet: false,
  apiKeySet: false,
};

export interface ImportManagementOpts {
  /**
   * Indien true: wordt mutex-check EN SyncJobRun aanmaken/aflossen OVERGESLAGEN.
   * Gebruikt door buitenste callers (bv. settings handmatige sync) die zelf al
   * een SyncJobRun RUNNING-record hebben aangemaakt en die ook zelf af zullen ronden.
   * VEREIST: preExistingRunId moet gezet zijn.
   */
  skipRunManagement?: boolean;
  /** Het run-ID van de buitenste aangemaakte SyncJobRun (wordt als summary.runId gebruikt). */
  preExistingRunId?: string;
  /**
   * Indien true: de SIM-koppelingsfase (inserve-sim-link) wordt alleen in proefcontrole-
   * modus gedraaid; er worden geen SIM/klant-wijzigingen opgeslagen.
   */
  simLinkDryRun?: boolean;
  /** Maximaal aantal pagina's voor de asset-ophaal (debug). */
  simLinkMaxPages?: number;
  /** Optionele API-endpoint hint voor assets (debug). */
  assetEndpointHint?: string;
  /**
   * Indien true: de gehele import draait in proefmodus. Er wordt wel een
   * volledige diff-berekening gedaan, maar er wordt NIETS naar de database
   * geschreven (geen customer/contact/relation create/update/delete, geen
   * audit-log). De samenvatting bevat `dryRun: true` en `plannedChanges`.
   */
  dryRun?: boolean;
  /**
   * Optionele progress callback. Wordt per stap-wijziging en maximaal 20x per
   * run voor sub-percentages (elke 5%) aangeroepen zodat UI of SSE-stream de
   * voortgang realtime kan weergeven.
   */
  onProgress?: (state: SyncProgressState) => void;
  /**
   * Hoe vaak sub-percentages gerapporteerd moeten worden voor langlopende stappen
   * als processRecords. Default = 5 → elke 5% (max 20 extra events per run).
   */
  progressSubPercentStep?: number;
}

export async function runInserveCustomerImport(
  ctx: ImportUserCtx,
  opts: ImportManagementOpts = {}
): Promise<ImportSummary> {
  const startedAt = new Date();
  const t0 = Date.now();

  const subStep = opts.progressSubPercentStep ?? 5;
  const onProgress: ((state: SyncProgressState) => void) | undefined = opts.onProgress;
  // Dry-run / proefmodus: bereken alles, schrijf niets.
  const dryRun = !!opts.dryRun;

  // Resolve run-id as soon as possible so progress can be written even when
  // preExistingRunId is not set until after step-3 (createSyncJobRun).
  let runId: string | null = opts.preExistingRunId ?? null;
  // Progress enabled? Either explicit onProgress or preExistingRunId provided
  // (in the latter case, write to the in-memory registry so SSE subscribers
  // can follow along without opts.onProgress needing to be threaded).
  const progressEnabled = !!onProgress || !!runId;

  // ---------------------------------------------------------------------------
  // GLOBAL MUTEX — voorkomt concurrerende runs van uit ELK entry point.
  // De STEP-2 mutex-check hieronder wordt overgeslagen wanneer
  // opts.skipRunManagement=true (de UI- en settings-actions maken zelf een
  // SyncJobRun aan). Zonder deze vroege check konden twee actions tegelijk
  // hun eigen mutex-check doorstaan (TOCTOU-race) en allebei een run starten,
  // waardoor de import 2x tegelijk draaide en dezelfde bedrijven herhaald
  // werden gelogd.
  //
  // Wanneer preExistingRunId is gezet, sluiten we die uit van de check (het is
  // onze eigen run).
  // ---------------------------------------------------------------------------
  const GLOBAL_MUTEX_STALE_MS = 10 * 60 * 1000;
  try {
    const globalStaleCutoff = new Date(Date.now() - GLOBAL_MUTEX_STALE_MS);
    const globalExisting = await prisma.syncJobRun.findFirst({
      where: {
        jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
        status: { in: [SyncJobStatus.QUEUED, SyncJobStatus.RUNNING] },
        startedAt: { gt: globalStaleCutoff },
        ...(runId ? { id: { not: runId } } : {}),
      },
      select: { id: true, startedAt: true, status: true },
    });
    if (globalExisting) {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - globalExisting.startedAt.getTime()) / 1000)
      );
      console.warn(
        `[Inserve] Global mutex: import overgeslagen. ` +
        `Er is reeds een run bezig (id=${globalExisting.id}, status=${globalExisting.status}, leeftijd=${ageSec}s). ` +
        `Huidige preExistingRunId=${runId ?? "(geen)"}.`
      );
      const skippedSummary: ImportSummary = {
        runId: globalExisting.id,
        status: "SKIPPED",
        startedAt,
        endedAt: new Date(),
        durationMs: Date.now() - t0,
        fetched: 0,
        activeFilterPassed: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        customersReactivated: 0,
        customersDeactivated: 0,
        skipped: { ...ZERO_SKIPPED },
        failed: 0,
        pagesProcessed: 0,
        totalExpected: 0,
        errorMessage:
          `Er is reeds een import bezig (status: ${globalExisting.status}, leeftijd: ${ageSec}s). Wacht tot de vorige is afgerond, of probeer het over 10 minuten opnieuw.`,
        timingMs: { ...ZERO_TIMING, total: Date.now() - t0, mutexCheck: Date.now() - t0 },
        possibleUnlinkedMatches: [],
        previouslyActiveNowInactive: [],
        previouslyInactiveNowActive: [],
        skippedDetails: [],
        failedDetails: [],
        dryRun,
        simLink: { ...EMPTY_SIM_LINK_SUMMARY, dryRun: false },
        inserveCredentials: DEFAULT_UNCONFIGURED_CREDS,
      };
      try {
        if (progressEnabled) {
          if (!runId) runId = globalExisting.id;
          initProgress(runId, STEPS_INSERVE_CUSTOMER_IMPORT);
          finalizeProgress(runId, "SKIPPED", {
            summary: skippedSummary,
            errorMessage: skippedSummary.errorMessage ?? undefined,
          });
        }
      } catch { /* noop */ }
      return skippedSummary;
    }
  } catch (mutexErr: any) {
    // Bij een DB-fout in de mutex-check laten we de import niet onnodig
    // stoppen; de STEP-2 check (of de caller's check) vangt het nog op.
    console.warn(`[Inserve] Global mutex check faalde (niet-fataal): ${mutexErr?.message ?? String(mutexErr)}`);
  }

  function pushProgress(state: SyncProgressState) {
    if (onProgress) {
      try {
        onProgress(state);
      } catch {
        /* listener errors must never break the sync */
      }
    }
  }
  function doSetStepActive(idx: number, detail?: Record<string, unknown>) {
    if (!progressEnabled || !runId) return;
    setStepActive(runId, idx, detail);
    // registry subscriber already emits; also mirror to explicit callback if
    // caller used opts.onProgress (via subscribe mirror below).
  }
  function doSetStepDone(idx: number, detail?: Record<string, unknown>) {
    if (!progressEnabled || !runId) return;
    setStepDone(runId, idx, detail);
  }
  function doSetStepFailed(idx: number, error: string, errorDetail?: unknown) {
    if (!progressEnabled || !runId) return;
    setStepFailed(runId, idx, error, errorDetail);
  }
  function doSetStepSkipped(idx: number, reason?: string) {
    if (!progressEnabled || !runId) return;
    setStepSkipped(runId, idx, reason);
  }
  function doSetStepSub(sub0_1: number, idxHint?: number) {
    if (!progressEnabled || !runId) return;
    setStepSubPercent(runId, sub0_1, idxHint);
  }

  function doFinalizeProgress(
    status: Exclude<SyncProgressState["overallStatus"], "PENDING" | "RUNNING">,
    finalSummary: ImportSummary,
    errorMsg?: string
  ) {
    if (!progressEnabled || !runId) return;
    finalizeProgress(runId, status, {
      errorMessage: errorMsg,
      summary: finalSummary,
    });
  }

  // STEP 0: roleScopeCheck
  try { doSetStepActive(0); } catch { /* noop */ }
  const roleScopePass = !(ctx.roleScope && ctx.roleScope !== RoleScope.INTERNAL);
  const timing = { ...ZERO_TIMING };
  timing.roleScopeCheck = Date.now() - t0;
  if (!roleScopePass) {
    const finalTiming = { ...timing, total: Date.now() - t0 };
    const summary: ImportSummary = {
      ...makeFailedSummary(
        startedAt,
        "Import is alleen toegestaan voor interne gebruikers (scope INTERNAL).",
        runId ?? opts.preExistingRunId ?? null
      ),
      timingMs: finalTiming,
      inserveCredentials: DEFAULT_UNCONFIGURED_CREDS,
    };
    try {
      if (!runId && summary.runId) runId = summary.runId;
      if (progressEnabled && runId) {
        initProgress(runId, STEPS_INSERVE_CUSTOMER_IMPORT);
        setStepActive(runId, 0);
        setStepFailed(runId, 0, summary.errorMessage!);
      }
      doFinalizeProgress("FAILED", summary, summary.errorMessage ?? undefined);
      pushProgress({} as any);
    } catch { /* noop */ }
    return summary;
  }
  try { doSetStepDone(0); } catch { /* noop */ }

  if (opts.skipRunManagement && !opts.preExistingRunId) {
    timing.total = Date.now() - t0;
    const summary: ImportSummary = {
      ...makeFailedSummary(
        startedAt,
        "Interne fout: skipRunManagement=true zonder preExistingRunId.",
        runId ?? null
      ),
      timingMs: { ...timing, total: timing.total },
      inserveCredentials: DEFAULT_UNCONFIGURED_CREDS,
    };
    try { doFinalizeProgress("FAILED", summary, summary.errorMessage ?? undefined); } catch { /* noop */ }
    return summary;
  }

  // STEP 1: Credentials + basic guards
  let credsInfo: ImportSummary["inserveCredentials"] = DEFAULT_UNCONFIGURED_CREDS;
  try { doSetStepActive(1); } catch { /* noop */ }
  try {
    const tCredentials = Date.now();
    credsInfo = await inserveClient.inspectCredentials(true);
    timing.inserveInit = Date.now() - tCredentials;

    if (!credsInfo.configured) {
      timing.total = Date.now() - t0;
      const summary: ImportSummary = {
        ...makeFailedSummary(
          startedAt,
          "Inserve is niet geconfigureerd. Stel INSERVE_SUBDOMAIN en INSERVE_API_KEY in, of configureer via Instellingen → Inserve. (Wordt nu opgehaald uit noch DB noch omgevingsvariabelen.)",
          runId ?? null
        ),
        timingMs: { ...timing, total: timing.total ?? (Date.now() - t0) },
        inserveCredentials: credsInfo,
      };
      try {
        if (progressEnabled && runId) {
          setStepActive(runId, 1);
          setStepFailed(runId, 1, summary.errorMessage!);
        }
        doFinalizeProgress("FAILED", summary, summary.errorMessage ?? undefined);
      } catch { /* noop */ }
      return summary;
    }
  } catch (credErr: any) {
    timing.total = Date.now() - t0;
    const summary: ImportSummary = {
      ...makeFailedSummary(
        startedAt,
        `Fout bij controleren van Inserve-configuratie: ${credErr?.message ?? String(credErr)}`,
        runId ?? null
      ),
      timingMs: { ...timing, total: timing.total ?? (Date.now() - t0) },
      inserveCredentials: DEFAULT_UNCONFIGURED_CREDS,
    };
    try {
      if (progressEnabled && runId) setStepFailed(runId, 1, summary.errorMessage!);
      doFinalizeProgress("FAILED", summary, summary.errorMessage ?? undefined);
    } catch { /* noop */ }
    return summary;
  }
  try { doSetStepDone(1, { configured: credsInfo.configured, source: credsInfo.source }); } catch { /* noop */ }

  // STEP 2+3: Mutex + SyncJobRun
  let syncJobRun: { id: string; configId?: string | null };
  const MUTEX_STALE_MS = 10 * 60 * 1000;
  if (opts.skipRunManagement && opts.preExistingRunId) {
    const tConfig = Date.now();
    syncJobRun = { id: opts.preExistingRunId };
    const syncJobConfig = await getSyncJobConfig(SyncJobId.INSERVE_CUSTOMER_IMPORT);
    syncJobRun.configId = syncJobConfig?.id ?? null;
    timing.createConfigAndRun = Date.now() - tConfig;
    timing.mutexCheck = 0;
    try {
      doSetStepSkipped(2, "skipRunManagement=true (buitenste beheerder)");
      doSetStepSkipped(3, "skipRunManagement=true; run reeds aangemaakt.");
    } catch { /* noop */ }
    if (progressEnabled && runId) {
      // Init now — runId was preExistingRunId, so before we emit step 4 we
      // must have a state in the registry.
      initProgress(runId, STEPS_INSERVE_CUSTOMER_IMPORT);
      // Re-fire the step closes above so registry state matches.
      setStepSkipped(runId, 2, "skipRunManagement=true");
      setStepSkipped(runId, 3, "skipRunManagement=true; run reeds aangemaakt.");
      // Registry → explicit onProgress mirror (if user passed callback).
      if (onProgress) {
        try {
          subscribe(runId, (s) => {
            try { onProgress(s); } catch { /* noop */ }
          });
        } catch { /* noop */ }
      }
    }
  } else {
    // STEP 2: mutex check
    try { doSetStepActive(2); } catch { /* noop */ }
    const t1 = Date.now();
    const staleCutoff = new Date(Date.now() - MUTEX_STALE_MS);
    const existing = await prisma.syncJobRun.findFirst({
      where: {
        jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
        status: { in: [SyncJobStatus.QUEUED, SyncJobStatus.RUNNING] },
        startedAt: { gt: staleCutoff },
      },
      select: { id: true, startedAt: true, status: true },
    });
    timing.mutexCheck = Date.now() - t1;
    if (existing) {
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - existing.startedAt.getTime()) / 1000)
      );
      timing.total = Date.now() - t0;
      const skippedSummary: ImportSummary = {
        runId: existing.id,
        status: "SKIPPED",
        startedAt,
        endedAt: new Date(),
        durationMs: Date.now() - t0,
        fetched: 0,
        activeFilterPassed: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        customersReactivated: 0,
        customersDeactivated: 0,
        skipped: { ...ZERO_SKIPPED },
        failed: 0,
        pagesProcessed: 0,
        totalExpected: 0,
        errorMessage:
          `Er is reeds een import bezig (status: ${existing.status}, leeftijd: ${ageSec}s). Wacht tot de vorige is afgerond, of probeer het over 10 minuten opnieuw.`,
        timingMs: { ...timing, total: timing.total },
        possibleUnlinkedMatches: [],
        previouslyActiveNowInactive: [],
        previouslyInactiveNowActive: [],
        skippedDetails: [],
        failedDetails: [],
        dryRun: !!opts.dryRun,
        simLink: { ...EMPTY_SIM_LINK_SUMMARY, dryRun: false },
        inserveCredentials: credsInfo,
      };
      try {
        if (progressEnabled) {
          if (!runId) runId = existing.id;
          initProgress(runId, STEPS_INSERVE_CUSTOMER_IMPORT);
          setStepActive(runId, 2);
          setStepFailed(runId, 2, skippedSummary.errorMessage!);
          finalizeProgress(runId, "SKIPPED", { summary: skippedSummary, errorMessage: skippedSummary.errorMessage ?? undefined });
        }
      } catch { /* noop */ }
      return skippedSummary;
    }
    try { doSetStepDone(2); } catch { /* noop */ }

    // STEP 3: create run
    try { doSetStepActive(3); } catch { /* noop */ }
    const t2 = Date.now();
    const syncJobConfig = await getSyncJobConfig(SyncJobId.INSERVE_CUSTOMER_IMPORT);
    if (dryRun) {
      // Dry-run: geen SyncJobRun aanmaken. Gebruik een synthetisch runId
      // voor de voortgangsregistry (indien geactiveerd).
      const syntheticId = `dryrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      syncJobRun = { id: syntheticId, configId: syncJobConfig.id };
      runId = syntheticId;
      timing.createConfigAndRun = Date.now() - t2;
    } else {
      const created = await createSyncJobRun(prisma, {
        configId: syncJobConfig.id,
        jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
        triggeredBy: SyncJobTrigger.MANUAL_ADMIN,
        userId: ctx.userId ?? undefined,
        status: SyncJobStatus.RUNNING,
      });
      syncJobRun = { id: created.id, configId: syncJobConfig.id };
      timing.createConfigAndRun = Date.now() - t2;
      runId = created.id;
    }
    if (progressEnabled && runId) {
      initProgress(runId, STEPS_INSERVE_CUSTOMER_IMPORT);
      // Re-fire the earlier step boundaries against the now-known runId so
      // state isn't missing steps 0-2 in the registry.
      setStepDone(runId, 0);
      setStepDone(runId, 1, { configured: credsInfo.configured, source: credsInfo.source });
      setStepDone(runId, 2);
      setStepActive(runId, 3);
    }
    try { doSetStepDone(3, { id: syncJobRun.id }); } catch { /* noop */ }
    if (progressEnabled && onProgress) {
      // Registry → opts.onProgress mirror (once) so explicit callback sees
      // the same updates SSE subscribers get (registry emits on every
      // setStep* mutation by default; subscribe sends 1 snapshot immediately).
      try {
        subscribe(runId!, (s) => {
          try { onProgress(s); } catch { /* noop */ }
        });
      } catch { /* noop */ }
    }
  }

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
    customersReactivated: 0,
    customersDeactivated: 0,
    skipped: { ...ZERO_SKIPPED },
    failed: 0,
    pagesProcessed: 0,
    totalExpected: 0,
    inserveCredentials: credsInfo,
    timingMs: { ...ZERO_TIMING },
    skippedDetails: [],
    failedDetails: [],
    possibleUnlinkedMatches: [],
    previouslyActiveNowInactive: [],
    previouslyInactiveNowActive: [],
    dryRun: !!opts.dryRun,
    plannedChanges: opts.dryRun
      ? {
          companies: { create: 0, update: 0, deactivate: 0, reactivate: 0, unchanged: 0 },
        }
      : undefined,
    simLink: { ...EMPTY_SIM_LINK_SUMMARY, dryRun: !!opts.simLinkDryRun },
  };

  const markPartialFailed = (msg: string, detail?: unknown, asPartialSuccess = false) => {
    finalStatus = SyncJobStatus.FAILED;
    finalErrorMessage = msg;
    finalErrorDetail = detail;
    summary.status = asPartialSuccess ? "PARTIAL_SUCCESS" : "FAILED";
    summary.errorMessage = msg;
    // Try to write progress error context (in step order guess)
    try {
      if (!progressEnabled || !runId) return;
      const activeIdx = (() => {
        for (let i = 0; i < STEPS_INSERVE_CUSTOMER_IMPORT.length; i++) {
          const entry = getCurrentState(runId!)?.steps[i];
          if (entry?.status === "ACTIVE") return i;
        }
        // Guess: step-specific markers in the message
        if (/SIM[- ]?koppel/i.test(msg)) return 8;
        if (/bedrijven|custom fields|Nexus.*verwerk/i.test(msg)) return 6;
        if (/match/i.test(msg)) return 7;
        if (/import mislukt/i.test(msg)) return 9;
        return -1;
      })();
      if (activeIdx >= 0) setStepFailed(runId, activeIdx, msg);
    } catch { /* noop */ }
  };

  const doFinalize = (overrideSummaryStatus?: ImportSummary["status"]): ImportSummary => {
    const sStatus = overrideSummaryStatus ?? (summary.status as ImportSummary["status"]);
    const tFin = Date.now();
    const finished = finalizeSummary(
      summary,
      syncJobRun.id,
      finalStatus,
      finalErrorMessage,
      finalErrorDetail,
      !opts.skipRunManagement,
      sStatus
    );
    timing.finalize = Date.now() - tFin;
    timing.total = Math.max(timing.total, Date.now() - t0);
    finished.timingMs = { ...timing };
    try {
      // STEP 9: finalize already implicitly started at doFinalize call site,
      // mark done before writing progress final state.
      if (progressEnabled && runId) {
        const cur = getCurrentState(runId);
        if (cur && cur.steps[9]?.status !== "DONE" && cur.steps[9]?.status !== "FAILED") {
          setStepDone(runId, 9, { finalStatus: sStatus });
        }
        const finalProgStatus =
          sStatus === "SUCCESS" ? "SUCCESS" as const
          : sStatus === "PARTIAL_SUCCESS" ? "PARTIAL_SUCCESS" as const
          : sStatus === "SKIPPED" ? "SKIPPED" as const
          : "FAILED" as const;
        finalizeProgress(runId, finalProgStatus, {
          errorMessage: finished.errorMessage ?? undefined,
          summary: finished,
        });
      }
    } catch { /* noop */ }
    try {
      const statStr = (sStatus === "SUCCESS") ? "SUCCES" : (sStatus === "PARTIAL_SUCCESS") ? "GESLAAGD (partieel)" : (sStatus === "SKIPPED") ? "OVERGESLAGEN" : "MISLUKT";
      console.info(
        `[Inserve] Import ${statStr}. Ophaalde=${finished.fetched} filterpass=${finished.activeFilterPassed} aangemaakt=${finished.created} bijgewerkt=${finished.updated} ongewijzigd=${finished.unchanged} overgeslagen=${finished.skipped.other + finished.skipped.inactive_or_missing_nexus_field + finished.skipped.fetch_error_nexus + finished.skipped.missing_required_fields} mislukt=${finished.failed} | duur=${finished.timingMs.total}ms (API-bedrijven:${finished.pagesProcessed}p)`
      );
      if (finished.errorMessage) {
        const lvl = (sStatus === "SUCCESS" || sStatus === "PARTIAL_SUCCESS" || sStatus === "SKIPPED") ? console.warn : console.error;
        lvl(`[Inserve]   Bericht: ${finished.errorMessage}`);
      }
    } catch {
    }
    return finished;
  };

  try {
    // STEP 11 finalize only starts at the very end — mark it PENDING
    // Credentials al gecontroleerd in [P1]; herhaal isConfigured defensief
    if (!(await inserveClient.isConfigured())) {
      markPartialFailed(
        "Inserve is niet geconfigureerd. Stel INSERVE_SUBDOMAIN en INSERVE_API_KEY in, of configureer via Instellingen → Inserve."
      );
      return doFinalize();
    }

    // STEP 4: fetchCompanies
    // Full-read-guard: bronlezing is alleen "compleet" wanneer de bedrijven
    // succesvol zijn opgehaald. Zolang deze vlag false is, worden er geen
    // klanten gedeactiveerd (voorkomt massadeactivatie bij een mislukte of
    // onvolledige bronlezing).
    let sourceReadComplete = false;
    try { doSetStepActive(4); } catch { /* noop */ }
    let fetchedCompanies: InserveCompany[] = [];
    let t4 = Date.now();
    try {
      t4 = Date.now();
      const res = await listAllCompanies({
        withRelations: [
          "custom_fields",
          "company_fields",
          "extra_fields",
          "fields",
        ],
        perPage: 50,
      });
      timing.fetchCompanies = Date.now() - t4;
      fetchedCompanies = res.items;
      summary.fetched = res.totalFetched;
      summary.pagesProcessed = res.pagesProcessed;
      summary.totalExpected = res.totalExpected;
      try { doSetStepDone(4, { totalFetched: res.totalFetched, pagesProcessed: res.pagesProcessed, totalExpected: res.totalExpected }); } catch { /* noop */ }
      if (res.totalFetched === 0) {
        markPartialFailed(
          `Inserve API gaf 0 bedrijven terug (pagina's verwerkt: ${res.pagesProcessed}, verwachte totaal volgens API: ${res.totalExpected ?? 0}). Controleer of de API-key leesrechten heeft op bedrijven, of dat het juiste endpoint en builder-parameter worden gebruikt.`
        );
      } else {
        // Bedrijven-lezing geslaagd → bronmomentopname compleet; deactivering
        // van niet-meer-voorkomende klanten is nu veilig.
        sourceReadComplete = true;
      }
    } catch (e: any) {
      timing.fetchCompanies = Math.max(timing.fetchCompanies, Date.now() - t4);
      try { doSetStepFailed(4, `Kon bedrijven niet ophalen: ${e?.message ?? String(e)}`, { statusCode: (e as any)?.statusCode ?? null }); } catch { /* noop */ }
      if (e instanceof InserveApiError) {
        if (e.statusCode === 401 || e.statusCode === 403) {
          markPartialFailed(
            `Inserve authenticatie mislukt (status ${e.statusCode}). Controleer de API-key en rechten.`
          );
          return doFinalize();
        }
      }
      markPartialFailed(
        `Kon bedrijven niet ophalen bij Inserve: ${e?.message ?? String(e)}`,
        { statusCode: (e as any)?.statusCode ?? null }
      );
      return doFinalize();
    }

    // Stap 5: bestaande Nexus-klanten en Inserve-koppelingen inladen.
    try { doSetStepActive(5); } catch { /* noop */ }
    const t5 = Date.now();
    const previouslyLinkedIds = new Map<number, { id: string; companyName: string; deletedAt: Date | null; status?: CustomerStatus | string | null }>();
    const preExistingLinked = await prisma.customer.findMany({
      where: { inserveCompanyId: { not: null } },
      select: { id: true, inserveCompanyId: true, companyName: true, deletedAt: true, status: true },
    });
    timing.fetchPreExisting = Date.now() - t5;
    for (const c of preExistingLinked) {
      if (c.inserveCompanyId) {
        previouslyLinkedIds.set(c.inserveCompanyId, {
          id: c.id,
          companyName: c.companyName,
          deletedAt: c.deletedAt,
          status: c.status,
        });
      }
    }
    const nowProcessedLinked = new Map<number, string>();
    try { doSetStepDone(5, { previouslyLinked: previouslyLinkedIds.size }); } catch { /* noop */ }

    // [PRE-SCAN] Bouw een cache van verrijkte bedrijven (met custom fields)
    // zodat de hoofdloop geen dubbele API-calls hoeft te doen. Bij 2000
    // bedrijven zonder inline velden zou dit anders 4000 calls worden →
    // rate limit.
    const enrichedCompaniesCache: Map<number, InserveCompany> = new Map();
    try {
      for (const rawCompany of fetchedCompanies) {
        const companyId = rawCompany.id;
        try {
          const hasFieldsInline =
            Array.isArray(rawCompany.custom_fields) ||
            Array.isArray(rawCompany.company_fields) ||
            Array.isArray(rawCompany.extra_fields) ||
            Array.isArray(rawCompany.fields);
          let customFetchErr: Error | null = null;
          let company: InserveCompany = rawCompany;
          if (!hasFieldsInline) {
            try {
              company = await enrichCompanyWithCustomFields(rawCompany);
            } catch (fe: any) {
              customFetchErr = fe instanceof Error ? fe : new Error(String(fe));
            }
          }
          // Alleen cachen als verrijking niet faalde. Bij een fout niet
          // cachen, zodat de hoofdloop de fout nog steeds kan detecteren
          // en correct kan afhandelen (fetch_error_nexus).
          if (!customFetchErr) {
            enrichedCompaniesCache.set(companyId, company);
          }
        } catch {
          // Nooit afbreken; de hoofdloop handelt fouten per bedrijf af.
        }
      }
    } catch { /* noop */ }

    // STEP 6: processRecords (met sub-percentages per 5%)
    try { doSetStepActive(6, { totalCompanies: fetchedCompanies.length }); } catch { /* noop */ }
    const tProcess = Date.now();
    const totalRec = fetchedCompanies.length;
    const SUB_EVERY_PCT = Math.max(1, subStep); // every 5% by default
    let lastReportedSub = -1;
    // Reset de sample-teller voor Nexus-diagnose logging (globalThis wordt
    // hergebruikt over meerdere imports heen; begin schoon per run).
    (globalThis as any).__nexusNonActiveSampleCount = 0;

    for (let i = 0; i < totalRec; i++) {
      const rawCompany = fetchedCompanies[i];
      // Emit sub-percent event (capped by bucket granularity = max 20 per run).
      if (totalRec > 0) {
        const pctDone = Math.floor((i / totalRec) * 100);
        const bucket = Math.floor(pctDone / SUB_EVERY_PCT);
        if (bucket > lastReportedSub) {
          lastReportedSub = bucket;
          const sub = Math.min(1, pctDone / 100);
          try { doSetStepSub(sub, 6); } catch { /* noop */ }
        }
      }
      const companyId = rawCompany.id;
      // Gebruik de verrijkte bedrijf uit de pre-scan cache om dubbele
      // API-calls te voorkomen.
      let company: InserveCompany = enrichedCompaniesCache.get(companyId) ?? rawCompany;
      let nexus: NexusFieldResolution;

      try {
        // Alleen verrijken als het niet in de cache zit (zou niet moeten
        // voorkomen, maar als fall-back).
        const hasFieldsInline =
          Array.isArray((company as any).customValues) ||
          Array.isArray((company as any).custom_values) ||
          Array.isArray(company.custom_fields) ||
          Array.isArray(company.company_fields) ||
          Array.isArray(company.extra_fields) ||
          Array.isArray(company.fields);
        let customFetchErr: Error | null = null;
        if (!hasFieldsInline && !enrichedCompaniesCache.has(companyId)) {
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

      // DIAGNOSTISCH: log de Nexus-resolutie voor de eerste 25 bedrijven EN
      // een beperkte sample van niet-actieve bedrijven (max 25). Dit helpt
      // bij het diagnosticeren waarom bedrijven met Nexus=Actief in Inserve
      // niet worden geïmporteerd, ZONDER de logs te overspoelen met duizenden
      // regels voor alle niet-actieve bedrijven.
      const isFirstBatch = i < 25;
      const isSampleNonActive =
        nexus.status !== "active" &&
        (globalThis as any).__nexusNonActiveSampleCount < 25;
      if (isSampleNonActive) {
        (globalThis as any).__nexusNonActiveSampleCount =
          ((globalThis as any).__nexusNonActiveSampleCount ?? 0) + 1;
      }
      if (isFirstBatch || isSampleNonActive) {
        const allFields = [
          ...(Array.isArray((company as any).customValues) ? (company as any).customValues : []),
          ...(Array.isArray((company as any).custom_values) ? (company as any).custom_values : []),
          ...(Array.isArray(company.custom_fields) ? company.custom_fields : []),
          ...(Array.isArray(company.company_fields) ? company.company_fields : []),
          ...(Array.isArray(company.extra_fields) ? company.extra_fields : []),
          ...(Array.isArray(company.fields) ? company.fields : []),
        ];
        const fieldNames = allFields.map((f: any) => {
          const fn = f?.name ?? f?.slug ?? f?.title ?? f?.key ?? f?.field_id ?? f?.id ?? "(onbekend)";
          const fv = typeof f?.value === 'object' ? JSON.stringify(f.value) : (f?.value ?? f?.field_value?.value ?? "(leeg)");
          // Toon ook de custom_field_object naam (de echte veld-label in Inserve),
          // zodat we kunnen zien welk veld het Nexus-veld is (ook al heeft f.name
          // alleen een numerieke ID).
          const cfoName = f?.custom_field_object?.name ?? f?.custom_field_object?.title ?? null;
          return `${fn}${cfoName ? `[${cfoName}]` : ""}=${fv}`;
        }).join("; ");
        console.debug(
          `[Inserve] Nexus-diagnose bedrijf #${companyId} (${company.name ?? "?"}): ` +
          `status=${nexus.status} rawValue=${(nexus as any).rawValue ?? "(geen)"} | ` +
          `velden=[${fieldNames || "(geen custom fields)"}]`
        );
      }

      const hasLink = previouslyLinkedIds.has(companyId);

      if (nexus.status === "fetch_error" || nexus.status === "parse_error") {
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
        if (hasLink) {
          nowProcessedLinked.set(companyId, previouslyLinkedIds.get(companyId)!.id);
        }
        continue;
      }
      if (nexus.status === "missing" || nexus.status === "empty") {
        summary.skipped.inactive_or_missing_nexus_field++;
        summary.skippedDetails!.push({
          companyId,
          companyName: (company.name as string | null) ?? null,
          reason: nexus.status === "empty" ? `Nexus veld is leeg` : `Nexus veld ontbreekt`,
        });
        if (hasLink) {
          nowProcessedLinked.set(companyId, previouslyLinkedIds.get(companyId)!.id);
        }
        continue;
      }
      if (nexus.status === "inactive") {
        // Full-read-guard: als de bronlezing (bedrijven) niet volledig
        // geslaagd is, mogen we geen klanten deactiveren. Een
        // mislukte pagina of time-out mag nooit leiden tot massale
        // deactivatie. Sla de klant ongemoeid en registreer de reden.
        if (!sourceReadComplete) {
          summary.skipped.inactive_or_missing_nexus_field++;
          summary.skippedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            reason: `Bronlezing onvolledig; deactivatie overgeslagen (Nexus = ${(nexus as any).rawValue}).`,
          });
          if (hasLink) {
            nowProcessedLinked.set(companyId, previouslyLinkedIds.get(companyId)!.id);
          }
          continue;
        }
        if (!hasLink) {
          summary.skipped.inactive_or_missing_nexus_field++;
          summary.skippedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            reason: `Nexus = ${(nexus as any).rawValue} (Inactief en nog geen klant; overslaan).`,
          });
          continue;
        }
        const existing = previouslyLinkedIds.get(companyId)!;
        nowProcessedLinked.set(companyId, existing.id);
        try {
          const current = await prisma.customer.findUnique({
            where: { id: existing.id },
            select: { id: true, status: true, deletedAt: true },
          });
          if (!current) {
            summary.skipped.inactive_or_missing_nexus_field++;
            continue;
          }
          const currentStatus = current.status as CustomerStatus | string;
          const needsStatusChange = currentStatus !== CustomerStatus.INACTIVE;
          const needsRestore = current.deletedAt !== null;
          if (!needsStatusChange && !needsRestore) {
            summary.skipped.inactive_or_missing_nexus_field++;
            continue;
          }
          const updateData: any = {};
          if (needsStatusChange) updateData.status = CustomerStatus.INACTIVE;
          if (needsRestore) updateData.deletedAt = null;
          const beforeSnapshot: any = { status: currentStatus };
          if (needsRestore) beforeSnapshot.deletedAt = current.deletedAt;
          if (!dryRun) {
            await prisma.$transaction(async (tx) => {
              const updated = await tx.customer.update({
                where: { id: current.id },
                data: updateData,
              });
              try {
                await logAudit(tx as any, {
                  entityType: "customer",
                  entityId: updated.id,
                  action: AuditAction.UPDATE,
                  userId: ctx.userId,
                  oldValues: beforeSnapshot,
                  newValues: updateData,
                  metadata: {
                    source: "inserve_customer_import",
                    inserveCompanyId: companyId,
                    nexusRawValue: (nexus as any).rawValue,
                    statusChange: "deactivated",
                    reason: "Nexus = Inactief",
                  },
                });
              } catch {
                // audit failure not fatal
              }
            });
          }
          if (needsStatusChange) {
            summary.customersDeactivated++;
            if (dryRun && summary.plannedChanges) summary.plannedChanges.companies.deactivate++;
            summary.previouslyActiveNowInactive!.push({
              customerId: existing.id,
              inserveCompanyId: companyId,
              companyName: (company.name as string | undefined) ?? existing.companyName,
            });
          }
          continue;
        } catch (statusErr: any) {
          summary.failed++;
          markPartialFailed("Klantstatus konden niet worden gezet. Zie failedDetails.");
          summary.failedDetails!.push({
            companyId,
            companyName: (company.name as string | null) ?? null,
            error: `Status Inactief mislukt: ${(statusErr?.message ?? String(statusErr)).slice(0, 400)}`,
          });
          continue;
        }
      }
      if (nexus.status !== "active") {
        summary.skipped.inactive_or_missing_nexus_field++;
        summary.skippedDetails!.push({
          companyId,
          companyName: (company.name as string | null) ?? null,
          reason: `Nexus onbekende waarde: ${JSON.stringify(nexus).slice(0, 200)}`,
        });
        if (hasLink) nowProcessedLinked.set(companyId, previouslyLinkedIds.get(companyId)!.id);
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
        let existingCustomer: Customer | null = previouslyLinkedIds.has(companyId)
          ? await prisma.customer.findUnique({
              where: { id: previouslyLinkedIds.get(companyId)!.id },
            })
          : await prisma.customer.findFirst({
              where: { inserveCompanyId: companyId },
            });

        if (!existingCustomer) {
          const secondaryWhere: any = { OR: [] as any[] };
          if (mapped.customerNumber) secondaryWhere.OR.push({ customerNumber: mapped.customerNumber });
          if (mapped.kvkNr) secondaryWhere.OR.push({ kvkNr: mapped.kvkNr });
          if (mapped.btwNr) secondaryWhere.OR.push({ btwNr: mapped.btwNr });
          if (secondaryWhere.OR.length > 0) {
            existingCustomer = await prisma.customer.findFirst({
              where: secondaryWhere,
              orderBy: { createdAt: "asc" },
            });
          }
        }

        if (existingCustomer) {
          nowProcessedLinked.set(companyId, existingCustomer.id);
          const needsRestore = existingCustomer.deletedAt !== null;
          const wasNotActive = (existingCustomer.status as CustomerStatus | string) !== CustomerStatus.ACTIVE;
          const diff = diffCustomerFields(existingCustomer, mapped);
          const finalDiff: any = { ...(diff ?? {}) };
          if (existingCustomer.inserveCompanyId !== companyId) {
            finalDiff.inserveCompanyId = companyId;
          }
          if (needsRestore) finalDiff.deletedAt = null;
          if (wasNotActive) finalDiff.status = CustomerStatus.ACTIVE;
          const hasAnyChanges = Object.keys(finalDiff).length > 0;
          if (!hasAnyChanges) {
            summary.unchanged++;
            if (dryRun && summary.plannedChanges) summary.plannedChanges.companies.unchanged++;
          } else if (dryRun) {
            // Dry-run: geen schrijven, wel de wijziging registreren.
            if (wasNotActive) {
              summary.customersReactivated++;
              summary.previouslyInactiveNowActive!.push({
                customerId: existingCustomer.id,
                inserveCompanyId: companyId,
                companyName: (company.name as string) ?? existingCustomer.companyName,
              });
              if (summary.plannedChanges) summary.plannedChanges.companies.reactivate++;
            }
            summary.updated++;
            if (summary.plannedChanges) summary.plannedChanges.companies.update++;
          } else {
            await prisma.$transaction(async (tx) => {
              const updated = await tx.customer.update({
                where: { id: existingCustomer.id },
                data: finalDiff,
              });
              await logAudit(tx as any, {
                entityType: "customer",
                entityId: updated.id,
                action: needsRestore ? AuditAction.ACTIVATE : AuditAction.UPDATE,
                userId: ctx.userId,
                oldValues: { ...(diff ?? {}), ...(needsRestore ? { deletedAt: existingCustomer.deletedAt } : {}), ...(wasNotActive ? { status: existingCustomer.status } : {}) } as any,
                newValues: finalDiff as any,
                metadata: {
                  source: "inserve_customer_import",
                  inserveCompanyId: companyId,
                  restored: needsRestore,
                  statusChange: wasNotActive ? "reactivated" : undefined,
                },
              });
            });
            if (wasNotActive) {
              summary.customersReactivated++;
              summary.previouslyInactiveNowActive!.push({
                customerId: existingCustomer.id,
                inserveCompanyId: companyId,
                companyName: (company.name as string) ?? existingCustomer.companyName,
              });
            }
            summary.updated++;
          }
        } else {
          let created: Customer;
          if (dryRun) {
            // Dry-run: geen klant aanmaken. Registreer alleen de berekende
            // wijziging en een synthetisch ID voor de koppeling-administratie.
            const syntheticId = `dryrun-cust-${companyId}`;
            summary.created++;
            if (summary.plannedChanges) summary.plannedChanges.companies.create++;
            nowProcessedLinked.set(companyId, syntheticId);
          } else {
            try {
            created = await prisma.$transaction(async (tx) => {
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
          } catch (createErr: any) {
            const prismaCode = createErr?.code ?? (createErr as any)?.errorCode ?? null;
            const isUniqueViolation = prismaCode === "P2002" || /unique constraint|duplicate key/i.test(createErr?.message ?? "");
            if (!isUniqueViolation) throw createErr;
            const targets: string[] = Array.isArray(createErr?.meta?.target) ? (createErr.meta.target as string[]) : [];
            let existingViaUnique: Customer | null = await prisma.customer.findFirst({
              where: { inserveCompanyId: companyId },
            });
            if (!existingViaUnique && targets.length > 0) {
              const p2002Where: any = { OR: [] as any[] };
              for (const t of targets) {
                const mVal = (mapped as any)[t];
                if (typeof mVal === "string" || typeof mVal === "number") {
                  p2002Where.OR.push({ [t]: mVal });
                }
              }
              if (p2002Where.OR.length === 0 && mapped.customerNumber) {
                p2002Where.OR.push({ customerNumber: mapped.customerNumber });
              }
              if (p2002Where.OR.length > 0) {
                existingViaUnique = await prisma.customer.findFirst({ where: p2002Where });
              }
            }
            if (!existingViaUnique && mapped.customerNumber) {
              existingViaUnique = await prisma.customer.findFirst({ where: { customerNumber: mapped.customerNumber } });
            }
            if (!existingViaUnique) throw createErr;
            nowProcessedLinked.set(companyId, existingViaUnique.id);
            const needsRestore = existingViaUnique.deletedAt !== null;
            const wasNotActive = (existingViaUnique.status as CustomerStatus | string) !== CustomerStatus.ACTIVE;
            const diff = diffCustomerFields(existingViaUnique, mapped);
            const finalDiff: any = { ...(diff ?? {}) };
            if (existingViaUnique.inserveCompanyId !== companyId) {
              finalDiff.inserveCompanyId = companyId;
            }
            if (needsRestore) finalDiff.deletedAt = null;
            if (wasNotActive) finalDiff.status = CustomerStatus.ACTIVE;
            const hasAnyChanges = Object.keys(finalDiff).length > 0;
            if (hasAnyChanges) {
              await prisma.$transaction(async (tx) => {
                const updated = await tx.customer.update({
                  where: { id: existingViaUnique.id },
                  data: finalDiff,
                });
                await logAudit(tx as any, {
                  entityType: "customer",
                  entityId: updated.id,
                  action: needsRestore ? AuditAction.ACTIVATE : AuditAction.UPDATE,
                  userId: ctx.userId,
                  oldValues: { ...(diff ?? {}), ...(needsRestore ? { deletedAt: existingViaUnique.deletedAt } : {}), ...(wasNotActive ? { status: existingViaUnique.status } : {}) } as any,
                  newValues: finalDiff as any,
                  metadata: {
                    source: "inserve_customer_import",
                    inserveCompanyId: companyId,
                    restored: needsRestore,
                    recovery: "P2002_unique_conflict",
                    statusChange: wasNotActive ? "reactivated" : undefined,
                  },
                });
              });
              if (wasNotActive) {
                summary.customersReactivated++;
                summary.previouslyInactiveNowActive!.push({
                  customerId: existingViaUnique.id,
                  inserveCompanyId: companyId,
                  companyName: (company.name as string) ?? existingViaUnique.companyName,
                });
              }
              summary.updated++;
            } else {
              summary.unchanged++;
            }
            continue;
          }
          nowProcessedLinked.set(companyId, created.id);
          summary.created++;
        }
        } // end else (geen bestaande klant)
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
    try { doSetStepSub(1, 6); } catch { /* noop */ }
    timing.processRecords = Date.now() - tProcess;
    try { doSetStepDone(6, { processed: totalRec, created: summary.created, updated: summary.updated, unchanged: summary.unchanged, failed: summary.failed }); } catch { /* noop */ }

    if (!dryRun) {
    try {
      await prisma.$transaction(async (tx) => {
        const summaryForAudit: Record<string, any> = {
          fetched: summary.fetched,
          active: summary.activeFilterPassed,
          created: summary.created,
          updated: summary.updated,
          unchanged: summary.unchanged,
          customersReactivated: summary.customersReactivated,
          customersDeactivated: summary.customersDeactivated,
          skipped: summary.skipped,
          failed: summary.failed,
          pagesProcessed: summary.pagesProcessed,
          totalExpected: summary.totalExpected,
          possibleUnlinkedMatches: summary.possibleUnlinkedMatches?.length ?? 0,
          previouslyActiveNowInactive: summary.previouslyActiveNowInactive?.length ?? 0,
          previouslyInactiveNowActive: summary.previouslyInactiveNowActive?.length ?? 0,
        };
        if (summary.created > 0 || summary.updated > 0 || summary.customersDeactivated > 0 || summary.customersReactivated > 0) {
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
    } // end if (!dryRun)

    try {
      // STEP 7: findMatches
      try { doSetStepActive(7); } catch { /* noop */ }
      const tFind = Date.now();
      summary.possibleUnlinkedMatches = await findPossibleUnlinkedMatches(
        fetchedCompanies,
        nowProcessedLinked
      );
      timing.findMatches = Date.now() - tFind;
      try { doSetStepDone(7, { matches: summary.possibleUnlinkedMatches.length }); } catch { /* noop */ }
    } catch (_) {
      summary.possibleUnlinkedMatches = [];
      try { doSetStepDone(7, { matches: 0, failed: true }); } catch { /* noop */ }
    }

    try {
      // STEP 8: simAssetLink
      try { doSetStepActive(8); } catch { /* noop */ }
      const tSimLink = Date.now();
      const simLinkResult = await runInserveSimAssetLink({
        dryRun: !!opts.simLinkDryRun,
        auditUserId: ctx.userId ?? undefined,
        maxPages: opts.simLinkMaxPages,
        endpointHint: opts.assetEndpointHint,
      });
      summary.simLink = simLinkResult;
      timing.linkSimAssets = Date.now() - tSimLink;
      try { doSetStepDone(8, { newlyLinked: simLinkResult.newlyLinked, errors: simLinkResult.errors, dryRun: simLinkResult.dryRun }); } catch { /* noop */ }
      if (simLinkResult.errors > 0 && (finalStatus === SyncJobStatus.SUCCESS || finalErrorMessage == null)) {
        markPartialFailed(
          `SIM-koppelingsfase bevat ${simLinkResult.errors} fout(en). Zie simLink.errorMessages.`,
          { source: "sim_link" },
          true
        );
      }
    } catch (simErr: any) {
      summary.simLink = {
        ...EMPTY_SIM_LINK_SUMMARY,
        dryRun: !!opts.simLinkDryRun,
        errors: 1,
        errorMessages: [`SIM-link top-level error: ${simErr?.message ?? String(simErr)}`.slice(0, 400)],
      };
      timing.linkSimAssets = 0;
      try { doSetStepFailed(8, `SIM-link mislukt: ${simErr?.message ?? String(simErr)}`.slice(0, 300)); } catch { /* noop */ }
      markPartialFailed(
        `SIM-koppelingsfase onverwachts mislukt: ${simErr?.message ?? String(simErr)}`,
        { source: "sim_link" },
        true
      );
    }
  } catch (topErr: any) {
    markPartialFailed(`Import mislukt: ${topErr?.message ?? String(topErr)}`, {
      code: (topErr as any)?.code ?? null,
    });
  }

  return doFinalize();
}

function finalizeSummary(
  summary: ImportSummary,
  runId: string,
  status: SyncJobStatus,
  errorMessage: string | null,
  errorDetail: unknown | undefined,
  doUpdateRun = true,
  overrideSummaryStatus?: ImportSummary["status"]
): ImportSummary {
  const endedAt = new Date();
  summary.endedAt = endedAt;
  summary.durationMs = Math.max(
    0,
    endedAt.getTime() - summary.startedAt.getTime()
  );
  summary.runId = runId;
  if (overrideSummaryStatus) {
    summary.status = overrideSummaryStatus;
  } else if (status === SyncJobStatus.SUCCESS) {
    summary.status = "SUCCESS";
  } else if (status === SyncJobStatus.SKIPPED) {
    summary.status = "SKIPPED";
  } else {
    summary.status = "FAILED";
  }
  summary.errorMessage = errorMessage;

  const recordsAffected: Record<string, any> = {
    fetched: summary.fetched,
    activeFilterPassed: summary.activeFilterPassed,
    created: summary.created,
    updated: summary.updated,
    unchanged: summary.unchanged,
    customersReactivated: summary.customersReactivated,
    customersDeactivated: summary.customersDeactivated,
    skipped: summary.skipped,
    failed: summary.failed,
    pagesProcessed: summary.pagesProcessed,
    totalExpected: summary.totalExpected,
    ...(summary.possibleUnlinkedMatches &&
    summary.possibleUnlinkedMatches.length > 0
      ? { possibleMatches: summary.possibleUnlinkedMatches.length }
      : {}),
    ...(summary.previouslyActiveNowInactive &&
    summary.previouslyActiveNowInactive.length > 0
      ? { previouslyActiveNowInactive: summary.previouslyActiveNowInactive.length }
      : {}),
    ...(summary.previouslyInactiveNowActive &&
    summary.previouslyInactiveNowActive.length > 0
      ? { previouslyInactiveNowActive: summary.previouslyInactiveNowActive.length }
      : {}),
    skippedSample: summary.skippedDetails?.slice(0, 20),
    failedSample: summary.failedDetails?.slice(0, 20),
    simLink: summary.simLink
      ? {
          totalAssetsExamined: summary.simLink.totalAssetsExamined,
          totalAssetsFetched: summary.simLink.totalAssetsFetched,
          newlyLinked: summary.simLink.newlyLinked,
          reassignedInserveManaged: summary.simLink.reassignedInserveManaged,
          unchanged: summary.simLink.unchanged,
          notMatched: summary.simLink.notMatched,
          conflicts: summary.simLink.conflicts,
          skipped: summary.simLink.skipped,
          errors: summary.simLink.errors,
          dryRun: summary.simLink.dryRun,
          endpointUsed: summary.simLink.endpointUsed,
          pagesProcessed: summary.simLink.pagesProcessed,
          skippedSample: summary.simLink.skippedDetails?.slice?.(0, 20),
          conflictSample: summary.simLink.conflictDetails?.slice?.(0, 20),
          notMatchedSample: summary.simLink.notMatchedDetails?.slice?.(0, 20),
          errorSample: summary.simLink.errorMessages?.slice?.(0, 20),
        }
      : undefined,
  };

  if (doUpdateRun) {
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
  }

  return summary;
}

function makeFailedSummary(
  startedAt: Date,
  message: string,
  runId: string | null,
  extra?: { simLinkDryRun?: boolean; dryRun?: boolean }
): ImportSummary {
  const endedAt = new Date();
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return {
    runId,
    status: "FAILED",
    startedAt,
    endedAt,
    durationMs,
    fetched: 0,
    activeFilterPassed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    customersReactivated: 0,
    customersDeactivated: 0,
    skipped: { ...ZERO_SKIPPED },
    failed: 0,
    errorMessage: message,
    pagesProcessed: 0,
    totalExpected: 0,
    inserveCredentials: DEFAULT_UNCONFIGURED_CREDS,
    timingMs: { ...ZERO_TIMING, total: durationMs },
    possibleUnlinkedMatches: [],
    previouslyActiveNowInactive: [],
    previouslyInactiveNowActive: [],
    skippedDetails: [],
    failedDetails: [],
    dryRun: !!extra?.dryRun,
    simLink: { ...EMPTY_SIM_LINK_SUMMARY, dryRun: !!extra?.simLinkDryRun },
  };
}
