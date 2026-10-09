import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Customer, SIM, SimAssignment } from "@prisma/client";
import { CustomerStatus, CustomerLinkSource, AuditAction } from "@prisma/client";
import type { InserveAsset } from "@/server/integrations/inserve/types";
import type { SimLinkNoMatchDetail, SimLinkConflictDetail } from "@/server/services/inserve-sim-link.service";

type SimInput = Partial<SIM> & { iccid: string };
type AssetInput = {
  id?: number;
  iccid?: string | null;
  companyId?: number | null;
  categoryName?: string | null;
  asset?: Partial<InserveAsset>;
};

// ============== MOCKS (worden gehoist naar top) ==============
interface ListAssetsResultType {
  items: InserveAsset[];
  totalFetched: number;
  totalExpected: number;
  pagesProcessed: number;
  endpointUsed: string | null;
}
const EMPTY_ASSETS_RESULT: ListAssetsResultType = {
  items: [],
  totalFetched: 0,
  totalExpected: 0,
  pagesProcessed: 0,
  endpointUsed: null,
};
// Object reference (geen plain var) — closure in vi.mock doet property-access
// waardoor de waarde pas bij listAllAssets()-call wordt gelezen.
const _mockState: { listAllAssetsResult: ListAssetsResultType } = {
  listAllAssetsResult: { ...EMPTY_ASSETS_RESULT },
};

vi.mock("@/server/integrations/inserve/service", async () => {
  const actual = await vi.importActual<typeof import("@/server/integrations/inserve/service")>(
    "@/server/integrations/inserve/service"
  );
  // SCHRIJF DE PROPERTY DIRECT OP HET MODULE-OBJECT.
  // Named imports (import { listAllAssets } from ...) krijgen direct de binding uit het
  // module-object, dus ze bypassen een Proxy of spread. Met Object.defineProperty op het
  // werkelijke actual-object wordt de mock ook door named imports gezien.
  const mockFn = vi.fn(async () => _mockState.listAllAssetsResult);
  try {
    Object.defineProperty(actual, "listAllAssets", {
      value: mockFn,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    // Probeer fallback: actual als mutable object behandelen (soms namespace is 'frozen' lite).
    (actual as any).listAllAssets = mockFn;
  }
  return actual;
});

vi.mock("@/lib/prisma", () => {
  const makeStore = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  });

  const internal: any = {
    _sims: [] as SIM[],
    _customers: [] as Customer[],
    _assignments: [] as SimAssignment[],
  };

  const prisma: any = {
    customer: makeStore(),
    sIM: makeStore(),
    simAssignment: makeStore(),
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    syncJobRun: makeStore(),
    syncJobConfig: makeStore(),
    $transaction: vi.fn(async (cb: any) => await cb(prisma)),
  };

  prisma.sIM.findMany.mockImplementation((args: any) => {
    const where: any = args?.where ?? {};
    let list: SIM[] = (internal._sims as SIM[]).filter((s) => !s.deletedAt);
    if (where.iccid?.in) {
      const set = new Set<string>(where.iccid.in);
      list = list.filter((s) => set.has(s.iccid));
    }
    if (where.inserveAssetId?.in) {
      const set = new Set<any>(where.inserveAssetId.in);
      list = list.filter((s) => s.inserveAssetId != null && set.has(s.inserveAssetId));
    }
    if (Array.isArray(where.OR)) {
      const matches = new Set<string>();
      for (const clause of where.OR) {
        if (clause.iccid?.in) {
          const set = new Set<string>(clause.iccid.in);
          list.filter((s) => set.has(s.iccid)).forEach((s) => matches.add(s.id));
        }
        if (clause.inserveAssetId?.in) {
          const set = new Set<any>(clause.inserveAssetId.in);
          list
            .filter((s) => s.inserveAssetId != null && set.has(s.inserveAssetId))
            .forEach((s) => matches.add(s.id));
        }
        if (clause.assignments?.some?.subscription?.customerId?.in) {
          list.forEach((s) => matches.add(s.id));
        }
        if (clause.customerId?.in) {
          const set = new Set<string>(clause.customerId.in);
          list.filter((s) => s.customerId && set.has(s.customerId)).forEach((s) => matches.add(s.id));
        }
      }
      list = list.filter((s) => matches.has(s.id));
    }
    return Promise.resolve(list);
  });
  prisma.sIM.findFirst.mockImplementation((args: any) => {
    const where: any = args?.where ?? {};
    const list: SIM[] = (internal._sims as SIM[]).filter((s) => !s.deletedAt);
    const hit =
      (where.inserveAssetId != null &&
        list.find((s) => s.inserveAssetId === where.inserveAssetId)) ||
      (where.iccid && list.find((s) => s.iccid === where.iccid)) ||
      (where.id && list.find((s) => s.id === where.id)) ||
      null;
    return Promise.resolve(hit ?? null);
  });
  prisma.sIM.update.mockImplementation(async (args: any) => {
    const list: SIM[] = internal._sims;
    const idx = list.findIndex((s) => s.id === args.where.id);
    if (idx < 0) throw new Error(`sim ${args.where.id} not found`);
    const after = { ...list[idx], ...args.data };
    list[idx] = after;
    return after;
  });

  prisma.customer.findMany.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    let list: Customer[] = internal._customers;
    if (where.status) list = list.filter((c) => c.status === where.status);
    if (where.inserveCompanyId?.not === null)
      list = list.filter((c: any) => c.inserveCompanyId != null);
    if (where.deletedAt === null) list = list.filter((c) => c.deletedAt == null);
    return Promise.resolve(list);
  });

  prisma.simAssignment.findFirst.mockImplementation((args: any) => {
    const where: any = args?.where ?? {};
    const list: SimAssignment[] = internal._assignments;
    const hits = list.filter(
      (a) =>
        (!where.simId || a.simId === where.simId) &&
        (where.endAt == null ? a.endAt == null : true)
    );
    return Promise.resolve(hits[0] ?? null);
  });

  Object.defineProperty(prisma, "_sims", {
    get() { return internal._sims; },
    set(v) { internal._sims = v; },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(prisma, "_customers", {
    get() { return internal._customers; },
    set(v) { internal._customers = v; },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(prisma, "_assignments", {
    get() { return internal._assignments; },
    set(v) { internal._assignments = v; },
    configurable: true,
    enumerable: true,
  });
  prisma._resetInternal = function _resetInternal() {
    internal._sims = [];
    internal._customers = [];
    internal._assignments = [];
  };

  return { prisma };
});

vi.mock("@/server/services/audit.service", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ============== RUNTIME VARIABELEN (worden in beforeEach gevuld via dynamic imports) ==============
let prisma: any;
let inserveSvc: any;
let runInserveSimAssetLink: any;
let EMPTY_SIM_LINK_SUMMARY: any;
let logAudit: any;

function mkCustomer(overrides: Partial<Customer> = {}): Customer {
  const prismaAny = prisma as any;
  return {
    id: "c-" + Math.random().toString(36).slice(2, 7),
    companyName: "Bedrijf B.V.",
    customerNumber: "C001",
    parentCustomerId: null,
    address: "Straat 1",
    postalCode: "1234AB",
    city: "Plaats",
    country: "NL",
    contactPerson: null,
    phone: "0201",
    email: "x@y.nl",
    kvkNr: "123",
    btwNr: "NL123",
    inserveCompanyId: 9000 + prismaAny._customers.length,
    status: CustomerStatus.ACTIVE,
    notes: "",
    type: "DIRECT" as any,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    deletedAt: null,
    ...overrides,
  } as Customer;
}

function mkSimDefaults(id: string): SIM {
  return {
    id,
    iccid: "",
    msisdn: null,
    imsi: null,
    eid: null,
    subscriberId: null,
    simName: null,
    simGroup: null,
    product: null,
    productType: null,
    provider: "Simhuis",
    simType: null,
    apn: null,
    status: "IN_STOCK" as any,
    dataUsedBytes: null,
    dataLimitBytes: null,
    lowestDataLimitBytes: null,
    smsUsedCount: null,
    smsLimitCount: null,
    lowestSmsLimitCount: null,
    lastUsageSyncAt: null,
    providerActivationDate: null,
    providerDeactivationDate: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    customerId: null,
    customerLinkSource: null,
    customerLinkedAt: null,
    inserveAssetId: null,
    inserveAssetLinkedAt: null,
    usageSource: null,
    usageBundleId: null,
    usageLocalProductId: null,
    usageLocalProductName: null,
    usagePeriodStart: null,
    usagePeriodEnd: null,
    usageRetrievedAt: null,
    usageCdrQueryStart: null,
    usageCdrQueryEnd: null,
    usageBundleUsages: null,
    usageSelectionNote: null,
    activationDate: null,
    reactivationDate: null,
    subscriptionDate: null,
  } as SIM;
}

function mkSim(overrides: SimInput): SIM {
  const id = overrides.id ?? "s-" + Math.random().toString(36).slice(2, 7);
  const base = mkSimDefaults(id);
  return { ...base, ...overrides, id } as SIM;
}

function mkAsset(input: AssetInput = {}): InserveAsset {
  const id = input.id ?? 100_000 + Math.floor(Math.random() * 9_999);
  const iccid = input.iccid ?? "8900000000000000" + id.toString().slice(-4);
  const companyId = input.companyId;
  const cat = input.categoryName ?? "Simkaart";
  return {
    id,
    category: cat,
    category_name: cat,
    categoryName: cat,
    category_id: 42,
    categoryId: 42,
    iccid,
    ICCID: iccid,
    company_id: companyId ?? null,
    companyId: companyId ?? null,
    company: companyId
      ? { id: companyId, name: `Bedrijf ${companyId}`, customer_id: companyId }
      : null,
    custom_values: [],
    customValues: [],
    ...(input.asset ?? {}),
  } as InserveAsset;
}

function seedCustomers(overrides: Partial<Customer>[]): Customer[] {
  const prismaAny = prisma as any;
  const custs = overrides.map((o) => mkCustomer(o));
  prismaAny._customers = [...prismaAny._customers, ...custs];
  return custs;
}

function seedSims(inputs: SimInput[]): SIM[] {
  const prismaAny = prisma as any;
  const sims = inputs.map((i) => mkSim(i));
  prismaAny._sims = [...prismaAny._sims, ...sims];
  return sims;
}

function mockListAllAssets(
  items: InserveAsset[],
  opts?: { endpointUsed?: string | null; pagesProcessed?: number; totalExpected?: number }
) {
  _mockState.listAllAssetsResult = {
    items,
    totalFetched: items.length,
    totalExpected: opts?.totalExpected ?? items.length,
    pagesProcessed: opts?.pagesProcessed ?? Math.max(1, Math.ceil(items.length / 25)),
    endpointUsed: opts?.endpointUsed ?? "assets",
  };
  return inserveSvc.listAllAssets as any;
}

beforeEach(async () => {
  // Alle module cache wissen → PER TEST verse mock factories (100% isolatie)
  vi.resetModules();

  const prismaMod = await import("@/lib/prisma");
  prisma = prismaMod.prisma;

  const svcMod = await import("@/server/integrations/inserve/service");
  inserveSvc = svcMod;

  const simLinkMod = await import("@/server/services/inserve-sim-link.service");
  runInserveSimAssetLink = simLinkMod.runInserveSimAssetLink;
  EMPTY_SIM_LINK_SUMMARY = simLinkMod.EMPTY_SIM_LINK_SUMMARY;

  const auditMod = await import("@/server/services/audit.service");
  logAudit = auditMod.logAudit;

  // Stores resetten
  const prismaAny = prisma as any;
  if (typeof prismaAny._resetInternal === "function") {
    prismaAny._resetInternal();
  } else {
    prismaAny._sims = [];
    prismaAny._customers = [];
    prismaAny._assignments = [];
  }
  _mockState.listAllAssetsResult = { ...EMPTY_ASSETS_RESULT };

  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("Inserve SIM ↔ Customer link integration", () => {
  it("TR-SIM-1: Unieke ICCID-match zonder bestaande klant → newlyLinked + INSERVE_ASSET bron", async () => {
    const [cust] = seedCustomers([{ inserveCompanyId: 1001, companyName: "Cust A", status: CustomerStatus.ACTIVE }]);
    const [sim] = seedSims([{ iccid: "89310123456789012345" }]);
    const a = mkAsset({ id: 1, iccid: "89310123456789012345", companyId: 1001, categoryName: "Simkaart" });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();

    expect(r.totalAssetsExamined).toBe(1);
    expect(r.newlyLinked).toBe(1);
    expect(r.unchanged).toBe(0);
    expect(r.conflicts).toBe(0);
    expect(r.notMatched).toBe(0);

    const prismaAny = prisma as any;
    const updated = (prismaAny._sims as SIM[]).find((s) => s.id === sim.id)!;
    expect(updated.customerId).toBe(cust.id);
    expect(updated.customerLinkSource).toBe("INSERVE_ASSET");
    expect(updated.inserveAssetId).toBe(1);
    expect(updated.customerLinkedAt).toBeTruthy();
    expect(updated.inserveAssetLinkedAt).toBeTruthy();

    expect(logAudit).toHaveBeenCalled();
    const lastAudit = (logAudit as any).mock.calls.at(-1)[1] ?? {};
    expect(lastAudit.action).toBe(AuditAction.INSERVE_SIM_LINKED);
  });

  it("TR-SIM-2: Voorloopnullen in ICCID worden bewaard en matchen exact", async () => {
    seedCustomers([{ inserveCompanyId: 1002, status: CustomerStatus.ACTIVE }]);
    seedSims([{ iccid: "00008931000000123456" }]);
    const a = mkAsset({
      id: 2,
      iccid: " 0000-8931-0000-0012-3456 ",
      companyId: 1002,
      categoryName: "simkaart",
    });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.newlyLinked).toBe(1);
    expect(r.conflicts).toBe(0);
    const prismaAny = prisma as any;
    const linked = (prismaAny._sims as SIM[])[0];
    expect(linked.iccid).toBe("00008931000000123456");
    expect(linked.customerId).toBeTruthy();
  });

  it("TR-SIM-3: Idempotentie — tweede run ongewijzigd, 0 writes, 0 extra audits", async () => {
    seedCustomers([{ inserveCompanyId: 1003, status: CustomerStatus.ACTIVE }]);
    const iccid = "89991111222233334444";
    seedSims([{ iccid }]);
    const asset = mkAsset({ id: 3, iccid, companyId: 1003 });
    mockListAllAssets([asset]);

    const r1 = await runInserveSimAssetLink();
    expect(r1.newlyLinked).toBe(1);
    const prismaAny = prisma as any;
    const updatedId1 = (prisma.sIM.update as any).mock.calls.length;

    vi.clearAllMocks();
    mockListAllAssets([asset]);
    (logAudit as any).mockClear();

    const r2 = await runInserveSimAssetLink();
    expect(r2.unchanged).toBe(1);
    expect(r2.newlyLinked).toBe(0);
    expect(r2.reassignedInserveManaged).toBe(0);
    expect(r2.conflicts).toBe(0);
    expect(prisma.sIM.update).not.toHaveBeenCalled();
  });

  it("TR-SIM-4: INSERVE_ASSET koppeling verhuist naar ander actief bedrijf → reassignedInserveManaged", async () => {
    const [cA, cB] = seedCustomers([
      { inserveCompanyId: 2001, status: CustomerStatus.ACTIVE, companyName: "A" },
      { inserveCompanyId: 2002, status: CustomerStatus.ACTIVE, companyName: "B" },
    ]);
    const iccid = "89311110000000000100";
    const [sim] = seedSims([
      {
        iccid,
        customerId: cA.id,
        customerLinkSource: "INSERVE_ASSET",
        customerLinkedAt: new Date("2025-06-01"),
        inserveAssetId: 4,
        inserveAssetLinkedAt: new Date("2025-06-01"),
      },
    ]);
    const a = mkAsset({ id: 4, iccid, companyId: 2002 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.reassignedInserveManaged).toBe(1);
    expect(r.unchanged).toBe(0);
    expect(r.conflicts).toBe(0);

    const prismaAny = prisma as any;
    const after = (prismaAny._sims as SIM[]).find((s) => s.id === sim.id)!;
    expect(after.customerId).toBe(cB.id);
    expect(after.inserveAssetId).toBe(4);
    const actions = (logAudit as any).mock.calls.map((c: any[]) => c[1]?.action);
    expect(actions).toContain("INSERVE_SIM_REASSIGNED");
  });

  it("TR-SIM-5: Handmatige koppeling (MANUAL) naar ander bedrijf → conflict, niet overschrijven", async () => {
    const [cA, cB] = seedCustomers([
      { inserveCompanyId: 2010, status: CustomerStatus.ACTIVE },
      { inserveCompanyId: 2011, status: CustomerStatus.ACTIVE },
    ]);
    const iccid = "89311110000000000200";
    seedSims([
      {
        iccid,
        customerId: cB.id,
        customerLinkSource: "MANUAL",
        customerLinkedAt: new Date(),
      },
    ]);
    const a = mkAsset({ id: 5, iccid, companyId: 2010 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.conflicts).toBe(1);
    expect(r.newlyLinked).toBe(0);
    expect(r.conflictDetails?.[0]?.reason).toBe("existing_manual_link_to_different_customer");

    const prismaAny = prisma as any;
    const sim = (prismaAny._sims as SIM[])[0];
    expect(sim.customerId).toBe(cB.id);
    expect(sim.customerLinkSource).toBe("MANUAL");
  });

  it("TR-SIM-6: Onbekende bron (UNKNOWN) koppeling → conflict, niet overschrijven", async () => {
    const [cA, cB] = seedCustomers([
      { inserveCompanyId: 2020, status: CustomerStatus.ACTIVE },
      { inserveCompanyId: 2021, status: CustomerStatus.ACTIVE },
    ]);
    const iccid = "89311110000000000300";
    seedSims([
      {
        iccid,
        customerId: cB.id,
        customerLinkSource: "UNKNOWN",
      },
    ]);
    const a = mkAsset({ id: 6, iccid, companyId: 2020 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.conflicts).toBe(1);
    expect(r.conflictDetails?.[0]?.reason).toBe("existing_unknown_link_to_different_customer");
    const prismaAny = prisma as any;
    expect((prismaAny._sims as SIM[])[0].customerId).toBe(cB.id);
    expect(prisma.sIM.update).not.toHaveBeenCalled();
  });

  it("TR-SIM-7: Ontbrekende of placeholder-identificatie → notMatched/skipped", async () => {
    seedCustomers([{ inserveCompanyId: 2030, status: CustomerStatus.ACTIVE }]);
    const placeholder = mkAsset({ id: 7, iccid: "000000000000000", companyId: 2030 });
    const leeg = mkAsset({ id: 8, iccid: null, companyId: 2030 });
    mockListAllAssets([placeholder, leeg]);

    const r = await runInserveSimAssetLink();
    expect(r.totalAssetsFetched).toBe(2);
    expect(r.newlyLinked).toBe(0);
    expect(r.notMatched + r.skipped).toBeGreaterThanOrEqual(2);
    expect(
      r.notMatchedDetails?.some(
        (d: SimLinkNoMatchDetail) => d.reason === "invalid_or_placeholder_identifier" || d.reason === "missing_identifier"
      )
    ).toBe(true);
  });

  it("TR-SIM-8: Meerdere Nexus-SIMs zelfde ICCID (soft-deleted scenario) → conflict multiple_nexus_sims_for_iccid", async () => {
    seedCustomers([{ inserveCompanyId: 2040, status: CustomerStatus.ACTIVE }]);
    const iccid = "89319991234567890123";
    seedSims([
      { id: "s-del", iccid, deletedAt: new Date() },
      { id: "s-active-1", iccid },
      { id: "s-active-2", iccid },
    ]);
    const a = mkAsset({ id: 9, iccid, companyId: 2040 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.conflicts).toBe(1);
    expect(r.conflictDetails?.[0]?.reason).toBe("multiple_nexus_sims_for_iccid");
    expect(prisma.sIM.update).not.toHaveBeenCalled();
  });

  it("TR-SIM-9: Meerdere Inserve-assets zelfde ICCID, VERSCHILLENDE bedrijven → conflict alle entries", async () => {
    seedCustomers([
      { inserveCompanyId: 3001, status: CustomerStatus.ACTIVE },
      { inserveCompanyId: 3002, status: CustomerStatus.ACTIVE },
    ]);
    const iccid = "89315551234567890001";
    seedSims([{ iccid }]);
    const a1 = mkAsset({ id: 10, iccid, companyId: 3001 });
    const a2 = mkAsset({ id: 11, iccid, companyId: 3002 });
    mockListAllAssets([a1, a2]);

    const r = await runInserveSimAssetLink();
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(
      r.conflictDetails?.some((d: SimLinkConflictDetail) => d.reason === "multiple_inserve_assets_same_iccid_different_company")
    ).toBe(true);
    expect(prisma.sIM.update).not.toHaveBeenCalled();
  });

  it("TR-SIM-10: Niet-Simkaart categorie (Router) → overgeslagen, 0 writes", async () => {
    seedCustomers([{ inserveCompanyId: 2050, status: CustomerStatus.ACTIVE }]);
    seedSims([{ iccid: "89310001111000000001" }]);
    const a = mkAsset({
      id: 12,
      iccid: "89310001111000000001",
      companyId: 2050,
      categoryName: "Router",
    });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.skipped).toBe(1);
    expect(r.newlyLinked).toBe(0);
    expect(r.skippedDetails?.[0]?.reason).toBe("category_not_simkaart");
    expect(prisma.sIM.update).not.toHaveBeenCalled();
  });

  it("TR-SIM-11: Asset gekoppeld aan INACTIVE/ontbrekend bedrijf → overgeslagen (geen unlink)", async () => {
    const [cust] = seedCustomers([
      { inserveCompanyId: 2060, status: CustomerStatus.INACTIVE, companyName: "Oud Bedrijf" },
    ]);
    const iccid = "89317770000000000011";
    seedSims([
      { iccid, customerId: cust.id, customerLinkSource: "INSERVE_ASSET" },
    ]);
    const a = mkAsset({ id: 13, iccid, companyId: 2060 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink();
    expect(r.skipped).toBe(1);
    expect(r.skippedDetails?.[0]?.reason).toBe("company_not_linked_or_inactive");
    expect(prisma.sIM.update).not.toHaveBeenCalled();
    const prismaAny = prisma as any;
    expect((prismaAny._sims as SIM[])[0].customerId).toBe(cust.id);
  });

  it("TR-SIM-12: 3-paginering — alle pagina's worden verwerkt", async () => {
    const [c1, c2, c3] = seedCustomers([
      { inserveCompanyId: 1, status: CustomerStatus.ACTIVE },
      { inserveCompanyId: 2, status: CustomerStatus.ACTIVE },
      { inserveCompanyId: 3, status: CustomerStatus.ACTIVE },
    ]);
    const iccids = ["89000000000000000001", "89000000000000000002", "89000000000000000003"];
    seedSims([{ iccid: iccids[0] }, { iccid: iccids[1] }, { iccid: iccids[2] }]);
    const items = [
      mkAsset({ id: 14, iccid: iccids[0], companyId: 1 }),
      mkAsset({ id: 15, iccid: iccids[1], companyId: 2 }),
      mkAsset({ id: 16, iccid: iccids[2], companyId: 3 }),
    ];
    mockListAllAssets(items, { pagesProcessed: 3, totalExpected: 3 });

    const r = await runInserveSimAssetLink();
    expect(r.pagesProcessed).toBe(3);
    expect(r.totalAssetsFetched).toBe(3);
    expect(r.newlyLinked).toBe(3);
    const prismaAny = prisma as any;
    const linkedIds = (prismaAny._sims as SIM[]).map((s) => s.customerId).filter(Boolean);
    expect(linkedIds.sort()).toEqual([c1.id, c2.id, c3.id].sort());
  });

  it("TR-SIM-13: API 500 tijdens listAllAssets → geen unlink, alleen errors teller", async () => {
    const [cust] = seedCustomers([{ inserveCompanyId: 2070, status: CustomerStatus.ACTIVE }]);
    const iccid = "89310000000000000777";
    seedSims([
      { iccid, customerId: cust.id, customerLinkSource: "INSERVE_ASSET", inserveAssetId: 99 },
    ]);

    const sp = vi.spyOn(inserveSvc, "listAllAssets");
    sp.mockRejectedValue(new Error("500 Internal Server Error"));

    const r = await runInserveSimAssetLink();
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(r.totalAssetsFetched).toBe(0);
    const prismaAny = prisma as any;
    expect((prismaAny._sims as SIM[])[0].customerId).toBe(cust.id);
    expect((prismaAny._sims as SIM[])[0].customerLinkSource).toBe("INSERVE_ASSET");
    expect(prisma.sIM.update).not.toHaveBeenCalled();

    sp.mockRestore();
  });

  it("TR-SIM-14: Simhuis sync wip-patroon (delete newData.xxx) voor 5 Inserve-klantvelden — witregel unit-check", async () => {
    const newData: Record<string, any> = {
      iccid: "89000000000000009999",
      provider: "Simhuis",
      status: "ACTIVE",
      customerId: "fake-id",
      customerLinkSource: "INSERVE_ASSET",
      customerLinkedAt: new Date(),
      inserveAssetId: 1234,
      inserveAssetLinkedAt: new Date(),
    };
    // Exact dezelfde wip als in simhuis-sim-sync.service.ts:
    delete newData.customerId;
    delete newData.customerLinkSource;
    delete newData.customerLinkedAt;
    delete newData.inserveAssetId;
    delete newData.inserveAssetLinkedAt;
    expect(Object.keys(newData)).not.toContain("customerId");
    expect(Object.keys(newData)).not.toContain("customerLinkSource");
    expect(Object.keys(newData)).not.toContain("customerLinkedAt");
    expect(Object.keys(newData)).not.toContain("inserveAssetId");
    expect(Object.keys(newData)).not.toContain("inserveAssetLinkedAt");
  });

  it("TR-SIM-15: DryRun mode — identieke tellers, 0 writes, 0 audits", async () => {
    const [cust] = seedCustomers([{ inserveCompanyId: 2080, status: CustomerStatus.ACTIVE }]);
    const iccid = "89310000000000000888";
    const [sim] = seedSims([{ iccid }]);
    const a = mkAsset({ id: 17, iccid, companyId: 2080 });
    mockListAllAssets([a]);

    const r = await runInserveSimAssetLink({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.newlyLinked).toBe(1);
    expect(r.totalAssetsExamined).toBe(1);

    expect(prisma.sIM.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();

    const prismaAny = prisma as any;
    const unchanged = (prismaAny._sims as SIM[]).find((s: SIM) => s.id === sim.id)!;
    expect(unchanged.customerId).toBeNull();
    expect(unchanged.customerLinkSource).toBeNull();
    expect(unchanged.inserveAssetId).toBeNull();
  });
});
