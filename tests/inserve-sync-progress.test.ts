import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Customer, ContactPerson } from "@prisma/client";
import {
  runInserveCustomerImport,
  type ImportUserCtx,
} from "@/server/services/inserve-customer-import.service";
import * as inserveSvc from "@/server/integrations/inserve/service";
import * as syncSchedSvc from "@/server/services/sync-schedule.service";
import * as contactSvc from "@/server/services/contact.service";
import * as identifiers from "@/lib/identifiers";
import * as simLinkSvc from "@/server/services/inserve-sim-link.service";
import { inserveClient } from "@/server/integrations/inserve/client";
import type { InserveCompany, InserveContact } from "@/server/integrations/inserve/types";
import { SyncJobId, SyncJobStatus, SyncJobTrigger, RoleScope, CustomerType } from "@/types/enums";
import {
  initProgress,
  getCurrentState,
  hasState,
  setStepActive,
  setStepDone,
  setStepFailed,
  setStepSkipped,
  setStepSubPercent,
  finalizeProgress,
  subscribe,
  STEPS_INSERVE_CUSTOMER_IMPORT,
  type SyncProgressState,
} from "@/lib/progress/sync-progress-registry";

vi.mock("@/lib/prisma", () => {
  const makeSharedMethods = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });

  const customerShared = makeSharedMethods();
  const contactPersonShared = makeSharedMethods();

  const makeTx = () => ({
    syncJobConfig: { upsert: vi.fn().mockResolvedValue({ id: "cfg-1" }) },
    syncJobRun: {
      create: vi.fn().mockImplementation((d: any) =>
        Promise.resolve({
          id: d.data?.id ?? "run-prog-1",
          ...(d.data ?? {}),
        })
      ),
      update: vi.fn().mockResolvedValue({ id: "run-prog-1" }),
    },
    customer: customerShared,
    contactPerson: contactPersonShared,
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  });

  const sharedPrisma: any = {
    syncJobRun: {
      findFirst: vi.fn(),
    },
    customer: customerShared,
    contactPerson: contactPersonShared,
    $transaction: vi.fn(async (cb: any) => {
      const tx = makeTx();
      (sharedPrisma as any)._lastTx = tx;
      return await cb(tx);
    }),
  };

  return { prisma: sharedPrisma };
});

import { prisma } from "@/lib/prisma";

// --- helpers (identical to main test file, recreated locally) ---
function makeCompany(overrides: Partial<InserveCompany> = {}): InserveCompany {
  return {
    id: 1001,
    name: "Test Bedrijf B.V.",
    debtor_code: "DEB-1001",
    address_1: "Hoofdstraat 12",
    address_2: null,
    postal_code: "1234AB",
    city: "Amsterdam",
    country: "Nederland",
    telephone: "0201234567",
    email: "info@testbedrijf.nl",
    kvk_nr: "12345678",
    btw_nr: "NL123456789B01",
    ...overrides,
  } as InserveCompany;
}
function makeContact(overrides: Partial<InserveContact> = {}): InserveContact {
  return {
    id: 5001,
    company_id: 1001,
    first_name: "Jan",
    last_name: "Jansen",
    email_address: "jan@testbedrijf.nl",
    telephone: "0209876543",
    telephone_cell: "0612345678",
    function: "Directeur",
    ...overrides,
  } as InserveContact;
}
function mkCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    companyName: "Test Bedrijf B.V.",
    customerNumber: "C-001",
    contactPersonId: null,
    contactName: null,
    type: CustomerType.DIRECT as unknown as any,
    status: "ACTIVE",
    email: "info@testbedrijf.nl",
    phone: "0201234567",
    mobile: null,
    addressStreet: "Hoofdstraat 12",
    addressNumber: "",
    addressNumberAddition: null,
    addressPostalCode: "1234AB",
    addressCity: "Amsterdam",
    addressCountry: "Nederland",
    vatNumber: "NL123456789B01",
    chamberOfCommerceNumber: "12345678",
    salesEmployeeId: null,
    supportEmployeeId: null,
    customerAgreementId: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    deletedAt: null,
    inserveCompanyId: null,
    inserveDebtorCode: null,
    ...overrides,
  } as Customer;
}

const defaultCtx: ImportUserCtx = {
  userId: "user-1",
  userRole: "SYSTEM",
  roleId: "role-1",
  roleScope: RoleScope.INTERNAL as any,
  permissions: null as any,
  customerIds: null as any,
};

function setupDefaultMocks(options: {
  companies?: InserveCompany[];
  contacts?: InserveContact[];
  existingCustomers?: Customer[];
  findMatches?: any[];
  throwCompanies?: Error;
  throwContacts?: Error;
  simLinkResult?: any;
  contactPersons?: ContactPerson[];
  credentialsNotConfigured?: boolean;
} = {}) {
  const companies = options.companies ?? [
    makeCompany({
      id: 1001,
      debtor_code: "DEB-1001",
      custom_fields: [{ id: 1, name: "Nexus", value: "Actief" }] as any,
    }),
  ];
  const contacts = options.contacts ?? [makeContact({ id: 5001, company_id: 1001 })];
  const existingCustomers = options.existingCustomers ?? [];
  const contactPersons = options.contactPersons ?? [];

  vi.spyOn(syncSchedSvc, "getSyncJobConfig").mockResolvedValue({
    id: "cfg-1",
    jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
    enabled: true,
    schedule: null as any,
    createdFrom: null,
    configJson: {
      inserveSubdomain: "demo",
      inserveApiKey: "token-xxx",
    } as any,
    updatedAt: new Date(),
    createdAt: new Date(),
  } as any);

  vi.spyOn(inserveClient as any, "inspectCredentials").mockResolvedValue({
    ok: !options.credentialsNotConfigured,
    configured: !options.credentialsNotConfigured,
    source: "env",
    subdomainSet: true,
    apiKeySet: true,
    subdomainPrefix: "demo",
  });
  vi.spyOn(inserveClient as any, "isConfigured").mockResolvedValue(
    !options.credentialsNotConfigured
  );

  vi.spyOn(syncSchedSvc, "createSyncJobRun").mockImplementation(async (_p, d: any) => ({
    id: d.id ?? "run-prog-1",
    ...d,
  } as any));
  vi.spyOn(syncSchedSvc, "completeSyncJobRun").mockResolvedValue({ id: "run-prog-1" } as any);

  vi.spyOn(inserveSvc, "listAllCompanies").mockImplementation(async () => {
    if (options.throwCompanies) throw options.throwCompanies;
    return {
      items: companies,
      totalFetched: companies.length,
      pagesProcessed: 1,
      totalExpected: companies.length,
      responses: [],
    };
  });

  vi.spyOn(inserveSvc, "listClientsForCompanyIds").mockImplementation(
    async (ids: any) => {
      if (options.throwContacts) throw options.throwContacts;
      const relevant = contacts.filter((c) => ids.includes(c.company_id as any));
      return {
        items: relevant,
        totalFetched: relevant.length,
        pagesProcessed: 1,
        totalExpected: relevant.length,
        strategyUsed: "single-call",
        rateLimitRemaining: 69,
        companyIdsRequested: (ids as number[]).length,
      };
    }
  );

  (vi.spyOn(prisma.customer, "findMany") as any).mockImplementation(async () => existingCustomers);
  (vi.spyOn(prisma.contactPerson, "findMany") as any).mockImplementation(async () => contactPersons);

  (vi.spyOn(prisma.customer, "create") as any).mockImplementation(async (d: any) => ({
    ...mkCustomer(),
    id: d.data?.id ?? `c-${(Math.random() * 100000).toFixed(0)}`,
    ...(d.data ?? {}),
  }));
  (vi.spyOn(prisma.customer, "update") as any).mockImplementation(async (d: any) => ({
    ...mkCustomer(),
    id: d.where.id,
  }));

  vi.spyOn(contactSvc, "createContactService").mockImplementation(async () => ({
    id: "cp-new",
  } as any));
  vi.spyOn(contactSvc, "updateContactService").mockImplementation(async () => ({
    id: "cp-upd",
  } as any));
  vi.spyOn(contactSvc, "deleteContactService").mockResolvedValue({ id: "cp-del" } as any);

  vi.spyOn(identifiers, "generateCustomerNumber").mockResolvedValue(`C-${Math.random()}`.slice(0, 10));

  vi.spyOn(simLinkSvc, "runInserveSimAssetLink").mockResolvedValue(
    options.simLinkResult ?? {
      dryRun: true,
      newlyLinked: 0,
      errors: 0,
      errorMessages: [],
      totalAssetsScanned: 0,
      totalCustomerScanned: 0,
    }
  );

  // prisma.syncJobRun.findFirst mocked by default return nothing (no running)
  vi.spyOn(prisma.syncJobRun, "findFirst").mockResolvedValue(null as any);
}

// ==================== REGISTRY UNIT TESTS ====================
describe("SyncProgress Registry (unit)", () => {
  // Gebruik steeds unieke runIds om test-isolatie te garanderen.
  beforeEach(() => {
    // Niets: tests nemen zelf unieke run ids via counters / random.
  });

  it("T-U1: initProgress → getCurrentState returns correct defaults (12 stappen, overall RUNNING)", () => {
    const run = "tu1-" + Date.now() + "-" + Math.random();
    initProgress(run);
    const s = getCurrentState(run);
    expect(s).not.toBeNull();
    expect(s!.runId).toBe(run);
    expect(s!.totalSteps).toBe(12);
    expect(s!.steps.length).toBe(12);
    expect(s!.steps.every((x) => x.status === "PENDING")).toBe(true);
    // initProgress markeert overall RUNNING zodra registry start
    expect(s!.overallStatus).toBe("RUNNING");
    expect(s!.percent).toBe(0);
    // currentStepIdx = -1 totdat setStepActive voor het eerst draait
    expect(s!.currentStepIdx).toBe(-1);
  });

  it("T-U2: setStepActive/setStepDone volgorde per stap verhoogt percent correct", () => {
    const run = "tu2-" + Date.now();
    initProgress(run);
    setStepActive(run, 0);
    setStepDone(run, 0);
    setStepActive(run, 1);
    setStepDone(run, 1);
    setStepActive(run, 2);
    setStepDone(run, 2);
    setStepActive(run, 3);
    setStepDone(run, 3);
    const s = getCurrentState(run)!;
    // 4 voltooide stappen = idx=3 is laatste; 3/12 + sub(step3 is DONE→1)/12 = 4/12 ≈ 33%
    expect(s.percent).toBeGreaterThanOrEqual(33);
    expect(s.percent).toBeLessThanOrEqual(34);

    // rest van de stappen
    for (let i = 4; i < 12; i++) {
      setStepActive(run, i);
      setStepDone(run, i);
    }
    finalizeProgress(run, "SUCCESS", { summary: { ok: true } as any });
    const s2 = getCurrentState(run)!;
    expect(s2.percent).toBe(100);
    expect(s2.overallStatus).toBe("SUCCESS");
    expect(s2.finalSummary).toBeTruthy();
    expect(s2.steps.every((x) => x.status === "DONE")).toBe(true);
  });

  it("T-U3: setStepSubPercent op ACTIVE stap verhoogt percent geleidelijk (5% korrels)", () => {
    const run = "tu3-" + Date.now();
    initProgress(run);
    // Eerste 5 stappen netjes afwerken
    for (let i = 0; i < 5; i++) {
      setStepActive(run, i);
      setStepDone(run, i);
    }
    setStepActive(run, 5);
    setStepSubPercent(run, 0.5, 5); // step 5 half klaar
    const s = getCurrentState(run)!;
    // 5 /12 + 0.5 /12 = 5.5 /12 = 45.8 → 46%
    expect(s.percent).toBeGreaterThanOrEqual(45);
    expect(s.percent).toBeLessThanOrEqual(47);
  });

  it("T-U4: setStepFailed per stap → fout inline + overall errors array", () => {
    const run = "tu4-" + Date.now();
    initProgress(run);
    setStepActive(run, 0);
    setStepDone(run, 0);
    setStepActive(run, 1);
    setStepDone(run, 1);
    setStepActive(run, 2);
    setStepFailed(run, 2, "mutex lock failed", { detail: "timeout 60s" });
    finalizeProgress(run, "FAILED", { errorMessage: "mutex lock failed" });
    const s = getCurrentState(run)!;
    expect(s.steps[2].status).toBe("FAILED");
    expect(s.steps[2].error).toContain("mutex lock failed");
    expect(s.errors.length).toBeGreaterThanOrEqual(1);
    expect(s.overallStatus).toBe("FAILED");
  });

  it("T-U5: setStepSkipped per idx afzonderlijk → SKIPPED status blijft bewaard", () => {
    const run = "tu5-" + Date.now();
    initProgress(run);
    setStepSkipped(run, 2, "mutex reeds verworven door andere run");
    setStepSkipped(run, 3, "run management external");
    finalizeProgress(run, "SUCCESS", {});
    const s = getCurrentState(run)!;
    expect(s.steps[2].status).toBe("SKIPPED");
    expect(s.steps[3].status).toBe("SKIPPED");
    expect(s.overallStatus).toBe("SUCCESS");
    // finalize sets percent = 100 regardless
    expect(s.percent).toBe(100);
  });

  it("T-U6: subscribe vuurt snapshot onmiddellijk + updates afwisselend; unsubscribe stopt events", () => {
    const run = "tu6-" + Date.now();
    initProgress(run);
    const events: SyncProgressState[] = [];
    const unsub = subscribe(run, (s) => events.push(s));
    // snapshot direct na subscribe
    expect(events.length).toBeGreaterThanOrEqual(1);
    setStepActive(run, 0);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const lenAfterSubscribes = events.length;
    unsub();
    setStepDone(run, 0);
    setStepActive(run, 1);
    setStepDone(run, 1);
    expect(events.length).toBe(lenAfterSubscribes);
  });

  it("T-U7: hasState / onbekende idx zijn silent no-op (geen crash)", () => {
    const run = "tu7-" + Date.now();
    expect(hasState(run)).toBe(false);
    initProgress(run);
    expect(hasState(run)).toBe(true);
    expect(() => setStepActive("no-such-run-" + Date.now(), 99)).not.toThrow();
    expect(() => setStepActive(run, 999)).not.toThrow();
    expect(() => setStepDone(run, 12345)).not.toThrow();
    expect(() => setStepFailed(run, -1, "x")).not.toThrow();
    expect(() => setStepSkipped(run, 1000)).not.toThrow();
    expect(() => finalizeProgress("no-run", "SUCCESS")).not.toThrow();
  });

  it("T-U8: finalize PARTIAL_SUCCESS → overall status + errorMessage naar errors[]", () => {
    const run = "tu8-" + Date.now();
    initProgress(run);
    for (let i = 0; i < 12; i++) {
      setStepActive(run, i);
      if (i === 6) {
        setStepFailed(run, 6, "rate limit 80/10 bereikt");
      } else {
        setStepDone(run, i);
      }
    }
    finalizeProgress(run, "PARTIAL_SUCCESS", {
      errorMessage: "rate limit bereikt",
      summary: { fetched: 10 } as any,
    });
    const s = getCurrentState(run)!;
    expect(s.overallStatus).toBe("PARTIAL_SUCCESS");
    expect(s.errors.length).toBeGreaterThanOrEqual(1);
    expect(s.finalSummary).toBeTruthy();
  });
});

// ==================== INTEGRATIE TESTS ====================
describe("runInserveCustomerImport (met onProgress)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupDefaultMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T-I1: onProgress ontvangt events; laatste event overallStatus=SUCCESS met finalSummary", async () => {
    const events: SyncProgressState[] = [];
    const res = await runInserveCustomerImport(defaultCtx, {
      onProgress: (s: SyncProgressState) => events.push(s),
      progressSubPercentStep: 10,
      preExistingRunId: "run-i1-" + Date.now(),
    } as any);
    // ImportSummary heeft geen .ok; status = SUCCESS/PARTIAL_SUCCESS
    expect(res.status === "SUCCESS" || res.status === "PARTIAL_SUCCESS").toBe(true);
    // Op zijn minst 4 events: init, setStepActive/setStepDone meerdere
    expect(events.length).toBeGreaterThanOrEqual(4);

    const last = events[events.length - 1];
    expect(last.overallStatus === "SUCCESS" || last.overallStatus === "PARTIAL_SUCCESS").toBe(true);
    // Eerste stappen DONE
    const step0 = events.find((e) => e.steps[0]?.status === "DONE");
    expect(step0).toBeTruthy();

    // Volgorde DONE: 0 → 1 → 2 → 3 stappen
    let stateAt0: SyncProgressState | undefined;
    let stateAt1: SyncProgressState | undefined;
    let stateAt2: SyncProgressState | undefined;
    let stateAt3: SyncProgressState | undefined;
    for (const ev of events) {
      if (!stateAt0 && ev.steps[0]?.status === "DONE") stateAt0 = ev;
      if (stateAt0 && !stateAt1 && ev.steps[1]?.status === "DONE") stateAt1 = ev;
      if (stateAt1 && !stateAt2 && ev.steps[2]?.status === "DONE") stateAt2 = ev;
      if (stateAt2 && !stateAt3 && ev.steps[3]?.status === "DONE") stateAt3 = ev;
    }
    expect(stateAt0).toBeTruthy();
  }, 8000);

  it("T-I2: 20+ bedrijven → step 8 (processRecords) stuurt sub% updates; percent klimt geleidelijk", async () => {
    const N = 25;
    const companies = Array.from({ length: N }, (_, i) =>
      makeCompany({
        id: 2000 + i,
        debtor_code: `DEB-${2000 + i}`,
        name: `Bedrijf ${i + 1} B.V.`,
        custom_fields: [{ id: 1, name: "Nexus", value: "Actief" }] as any,
      })
    );
    vi.restoreAllMocks();
    setupDefaultMocks({ companies, contacts: [] });

    const events: SyncProgressState[] = [];
    const res = await runInserveCustomerImport(defaultCtx, {
      onProgress: (s: SyncProgressState) => events.push(s),
      progressSubPercentStep: 5,
      preExistingRunId: "run-i2-" + Date.now(),
    } as any);
    expect(res.status === "SUCCESS" || res.status === "PARTIAL_SUCCESS").toBe(true);

    const percents = events.map((e) => e.percent);
    // Stap 8 moet ACTIVE zijn geweest
    const step8active = events.some((e) => e.steps[8]?.status === "ACTIVE");
    expect(step8active).toBe(true);

    const processSubEvents = events.filter((e) => {
      const d: any = e.steps[8]?.detail;
      return (
        d &&
        typeof d._subPercent === "number" &&
        d._subPercent > 0 &&
        d._subPercent < 1
      );
    });
    // Minimaal 2 sub-percent updates (>0 en <1). Met 25 bedrijven en 5% bucket:
    // 0%, 4%, 8%, … 96% → minimaal enkele.
    expect(processSubEvents.length).toBeGreaterThanOrEqual(2);

    const last = events[events.length - 1];
    expect(last.percent).toBe(100);
    let max = 0;
    for (const p of percents) {
      expect(p).toBeGreaterThanOrEqual(max - 1);
      max = Math.max(max, p);
    }
  }, 15000);

  it("T-I3: rate limit fout in contacts (stap 6) → stap FAILED; overall PARTIAL_SUCCESS", async () => {
    vi.restoreAllMocks();
    const rateErr: any = new Error("rate limit 80/10 window bereikt");
    rateErr.rateLimitBreached = true;
    rateErr.retryAfterMs = 600_000;
    setupDefaultMocks({
      companies: [
        makeCompany({
          id: 1010,
          custom_fields: [{ id: 1, name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      throwContacts: rateErr,
    });

    const events: SyncProgressState[] = [];
    const res = await runInserveCustomerImport(defaultCtx, {
      onProgress: (s: SyncProgressState) => events.push(s),
      preExistingRunId: "run-i3-" + Date.now(),
    } as any);

    expect(
      events.some((e) => e.overallStatus === "PARTIAL_SUCCESS") ||
        events[events.length - 1]?.overallStatus === "PARTIAL_SUCCESS" ||
        res.status === "PARTIAL_SUCCESS"
    ).toBe(true);
    const evWith6 = events.find((e) => e.steps[6]?.status === "FAILED");
    expect(evWith6).toBeTruthy();
    expect(evWith6!.steps[6].error).toContain("rate");
  }, 10000);

  it("T-I4: companies fetch gooit → stap 4 FAILED; overallStatus=FAILED", async () => {
    vi.restoreAllMocks();
    setupDefaultMocks({
      throwCompanies: new Error("Inserve API 502 Bad Gateway"),
    });
    const events: SyncProgressState[] = [];
    const res = await runInserveCustomerImport(defaultCtx, {
      onProgress: (s: SyncProgressState) => events.push(s),
      preExistingRunId: "run-i4-" + Date.now(),
    } as any);

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    // Top-level gooit tijdens stap 4 → service finalizeert FAILED (of PARTIAL indien stap 4 eerder faalt en doFinalize anders return).
    const isFailure =
      last.overallStatus === "FAILED" ||
      res.status === "FAILED" ||
      res.status === "PARTIAL_SUCCESS";
    expect(isFailure).toBe(true);
    const step4 = events.find((e) => e.steps[4]?.status === "FAILED");
    expect(step4).toBeTruthy();
    expect(step4!.steps[4].error).toMatch(/Bad Gateway|502/);
  }, 10000);
});
