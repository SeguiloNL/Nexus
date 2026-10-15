import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Customer, PrismaClient, CustomerType as PrismaCustomerType } from "@prisma/client";
import {
  resolveNexusFieldValue,
  mapCompanyToCustomerFields,
  diffCustomerFields,
  runInserveCustomerImport,
  type NexusFieldResolution,
  type ImportUserCtx,
} from "@/server/services/inserve-customer-import.service";
import * as inserveSvc from "@/server/integrations/inserve/service";
import * as auditSvc from "@/server/services/audit.service";
import * as syncSchedSvc from "@/server/services/sync-schedule.service";
import * as identifiers from "@/lib/identifiers";
import * as simLinkSvc from "@/server/services/inserve-sim-link.service";
import { inserveClient } from "@/server/integrations/inserve/client";
import type { InserveCompany } from "@/server/integrations/inserve/types";
import { SyncJobId, SyncJobStatus, SyncJobTrigger, RoleScope, CustomerType } from "@/types/enums";

vi.mock("@/lib/prisma", () => {
  const makeSharedMethods = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });

  const customerShared = makeSharedMethods();

  const makeTx = () => ({
    syncJobConfig: { upsert: vi.fn().mockResolvedValue({ id: "cfg-1" }) },
    syncJobRun: {
      create: vi.fn().mockImplementation((d: any) =>
        Promise.resolve({
          id: d.data?.id ?? "run-1",
          ...(d.data ?? {}),
        })
      ),
      update: vi.fn().mockResolvedValue({ id: "run-1" }),
    },
    customer: customerShared,
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  });

  const sharedPrisma: any = {
    syncJobRun: {
      findFirst: vi.fn(),
    },
    customer: customerShared,
    $transaction: vi.fn(async (cb: any) => {
      const tx = makeTx();
      (sharedPrisma as any)._lastTx = tx;
      return await cb(tx);
    }),
  };

  return { prisma: sharedPrisma };
});

import { prisma } from "@/lib/prisma";

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

function mkCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    companyName: "Test Bedrijf B.V.",
    customerNumber: "CUST-1",
    parentCustomerId: null,
    address: "Hoofdstraat 12",
    postalCode: "1234AB",
    city: "Amsterdam",
    country: "Nederland",
    contactPerson: null,
    phone: "0201234567",
    email: "info@testbedrijf.nl",
    kvkNr: "12345678",
    btwNr: "NL123456789B01",
    inserveCompanyId: 1001,
    status: "ACTIVE",
    notes: "Lokale notitie die behouden moet blijven!",
    type: (CustomerType.DIRECT as unknown) as PrismaCustomerType,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    deletedAt: null,
    ...overrides,
  } as Customer;
}

const defaultCtx: ImportUserCtx = {
  userId: "user-1",
  userRole: "ADMIN",
  roleId: "role-1",
  roleScope: RoleScope.INTERNAL,
  permissions: null,
  customerIds: null,
};

describe("InserveCustomerImport :: parse functies (unit)", () => {
  describe("resolveNexusFieldValue", () => {
    it("TR-2.1: Nexus=Actief (met hoofdletter, spaties) → active", () => {
      const c = makeCompany({
        custom_fields: [{ id: 1, name: "Nexus", value: "  Actief  " }] as any,
      });
      const r: NexusFieldResolution = resolveNexusFieldValue(c);
      expect(r.status).toBe("active");
      expect((r as any).rawValue).toBe("  Actief  ");
    });

    it("TR-2.1: Nexus=actief (klein, case-insensitive) → active", () => {
      const c = makeCompany({
        company_fields: [{ key: "Nexus", value: "actief" }] as any,
      });
      expect(resolveNexusFieldValue(c).status).toBe("active");
    });

    it("TR-2.2: Nexus=Inactief → inactive", () => {
      const c = makeCompany({
        extra_fields: [{ title: "Nexus", value: "Inactief" }] as any,
      });
      const r = resolveNexusFieldValue(c);
      expect(r.status).toBe("inactive");
      expect((r as any).rawValue).toBe("Inactief");
    });

    it("TR-2.2: Nexus=IetsAnders → inactive", () => {
      const c = makeCompany({
        fields: [{ slug: "nexus", value: "Proef" }] as any,
      });
      expect(resolveNexusFieldValue(c).status).toBe("inactive");
    });

    it("TR-2.2: Nexus=lege string → empty", () => {
      const c = makeCompany({
        custom_fields: [{ name: "Nexus", value: "   " }] as any,
      });
      expect(resolveNexusFieldValue(c).status).toBe("empty");
    });

    it("TR-2.2: Veld Nexus ontbreekt geheel → missing", () => {
      const c = makeCompany({
        custom_fields: [{ name: "AnderVeld", value: "x" }] as any,
      });
      expect(resolveNexusFieldValue(c).status).toBe("missing");
    });

    it("TR-2.3: customFetchErr meegegeven → fetch_error (ongelijk aan inactive)", () => {
      const c = makeCompany();
      const r = resolveNexusFieldValue(c, new Error("Netwerk timeout"));
      expect(r.status).toBe("fetch_error");
      expect((r as any).errorMessage).toContain("Netwerk timeout");
    });

    it("TR-2.4: Waarde als optie-label (value is option ID, label is 'Actief') → active", () => {
      const c = makeCompany({
        custom_fields: [
          {
            id: 5,
            name: "Nexus",
            value: 42,
            option: { id: 42, label: "Actief", value: "actief_optie" },
          },
        ] as any,
      });
      const r = resolveNexusFieldValue(c);
      expect(r.status).toBe("active");
    });

    it("TR-2.4: Waarde als geneste field_value object met value property → active", () => {
      const c = makeCompany({
        custom_fields: [
          {
            id: 5,
            field_id: "nexus",
            field_value: { value: "ACTIEF" },
          },
        ] as any,
      });
      expect(resolveNexusFieldValue(c).status).toBe("active");
    });

    it("TR-2.5: Naam-matching op naam/slug/title/key/field_id/id (case-insensitive)", () => {
      const vormen = [
        { name: "Nexus" },
        { slug: "NEXUS" },
        { title: "nexus" },
        { key: "NeXuS" },
        { field_id: "NEXUS-2024" },
        { id: "nexus" },
      ];
      for (const vorm of vormen) {
        const c = makeCompany({
          custom_fields: [{ ...vorm, value: "actief" }] as any,
        });
        const r = resolveNexusFieldValue(c);
        expect(r.status).toBe("active");
      }
    });
  });

  describe("mapCompanyToCustomerFields", () => {
    it("TR-3.1: Veldmapping correct: naam, adres, debiteur, postcode, plaats, land, telefoon, email, kvk, btw", () => {
      const c = makeCompany();
      const m = mapCompanyToCustomerFields(c);
      expect(m.companyName).toBe("Test Bedrijf B.V.");
      expect(m.inserveCompanyId).toBe(1001);
      expect(m.customerNumber).toBe("DEB-1001");
      expect(m.address).toBe("Hoofdstraat 12");
      expect(m.postalCode).toBe("1234AB");
      expect(m.city).toBe("Amsterdam");
      expect(m.country).toBe("Nederland");
      expect(m.phone).toBe("0201234567");
      expect(m.email).toBe("info@testbedrijf.nl");
      expect(m.kvkNr).toBe("12345678");
      expect(m.btwNr).toBe("NL123456789B01");
    });

    it("TR-3.1: address_1 + address_2 worden samengevoegd met spatie", () => {
      const c = makeCompany({ address_1: "Straat 1", address_2: "A" });
      expect(mapCompanyToCustomerFields(c).address).toBe("Straat 1 A");
    });

    it("TR-3.1: Lege strings worden null", () => {
      const c = makeCompany({
        debtor_code: "",
        address_1: "",
        postal_code: "  ",
        kvk_nr: "",
      });
      const m = mapCompanyToCustomerFields(c);
      expect(m.customerNumber).toBeNull();
      expect(m.address).toBeNull();
      expect(m.postalCode).toBeNull();
      expect(m.kvkNr).toBeNull();
    });
  });

  describe("diffCustomerFields", () => {
    it("TR-3.2: Alleen MAPPED_FIELDS worden vergeleken; notes/type/status/deletedAt worden NIET meegenomen", () => {
      const existing = mkCustomer({
        notes: "Lokale notitie",
        type: (CustomerType.DIRECT as unknown) as PrismaCustomerType,
        status: "ACTIVE",
        deletedAt: null,
        parentCustomerId: null,
      });
      const mapped = {
        ...mapCompanyToCustomerFields(makeCompany()),
        companyName: "Andere Naam",
        inserveCompanyId: 1001,
      };
      const d = diffCustomerFields(existing, mapped as any);
      expect(d).not.toBeNull();
      expect(d!.companyName).toBe("Andere Naam");
      expect(Object.keys(d!)).not.toContain("notes");
      expect(Object.keys(d!)).not.toContain("type");
      expect(Object.keys(d!)).not.toContain("status");
      expect(Object.keys(d!)).not.toContain("deletedAt");
      expect(Object.keys(d!)).not.toContain("parentCustomerId");
    });

    it("TR-3.2: Geen verschillen → null", () => {
      const existing = mkCustomer();
      const mapped = mapCompanyToCustomerFields(
        makeCompany({
          id: 1001,
          name: "Test Bedrijf B.V.",
          debtor_code: "CUST-1",
          address_1: "Hoofdstraat 12",
          postal_code: "1234AB",
          city: "Amsterdam",
          country: "Nederland",
          telephone: "0201234567",
          email: "info@testbedrijf.nl",
          kvk_nr: "12345678",
          btw_nr: "NL123456789B01",
        })
      );
      const d = diffCustomerFields(existing, mapped as any);
      expect(d).toBeNull();
    });

    it("TR-3.2: Normalisatie (spaties/whitespace) negeren bij verschil", () => {
      const existing = mkCustomer({
        companyName: "Naam",
        email: "a@b.nl",
      });
      const mapped = mapCompanyToCustomerFields(
        makeCompany({
          id: 1001,
          name: "  Naam  ",
          email: " a@b.nl ",
        })
      ) as any;
      mapped.customerNumber = existing.customerNumber;
      mapped.address = existing.address;
      mapped.postalCode = existing.postalCode;
      mapped.city = existing.city;
      mapped.country = existing.country;
      mapped.phone = existing.phone;
      mapped.kvkNr = existing.kvkNr;
      mapped.btwNr = existing.btwNr;
      const d = diffCustomerFields(existing, mapped);
      expect(d).toBeNull();
    });
  });
});

describe("InserveCustomerImport :: runImport (mocked integratie)", () => {
  let listAllCompaniesSpy: any;
  let logAuditSpy: any;
  let genCustNrSpy: any;
  let getSyncJobConfigSpy: any;
  let createSyncJobRunSpy: any;
  let completeSyncJobRunSpy: any;
  let consoleErr: any;

  const __CID = new Map<string, Customer>();
  const __CINS = new Map<number, Customer>();

  function setupExistingCustomers(custs: Customer[]): void {
    for (const c of custs) {
      if (c.id) __CID.set(c.id, c);
      if (typeof c.inserveCompanyId === "number") __CINS.set(c.inserveCompanyId, c);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __CID.clear();
    __CINS.clear();
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(inserveClient as any, "isConfigured").mockResolvedValue(true);
    vi.spyOn(inserveClient as any, "inspectCredentials").mockResolvedValue({
      configured: true,
      source: "env",
      subdomainSet: true,
      apiKeySet: true,
      subdomainPrefix: "seguilo",
    });
    listAllCompaniesSpy = vi.spyOn(inserveSvc, "listAllCompanies");
    vi.spyOn(simLinkSvc, "runInserveSimAssetLink").mockResolvedValue({
      ...(simLinkSvc.EMPTY_SIM_LINK_SUMMARY ?? {
        totalAssetsExamined: 0,
        totalAssetsFetched: 0,
        newlyLinked: 0,
        reassignedInserveManaged: 0,
        unchanged: 0,
        notMatched: 0,
        conflicts: 0,
        skipped: 0,
        errors: 0,
        dryRun: false,
        endpointUsed: null,
        pagesProcessed: 0,
        totalExpectedAssets: 0,
        skippedDetails: [],
        conflictDetails: [],
        notMatchedDetails: [],
        errorMessages: [],
      }),
      dryRun: false,
      errors: 0,
    } as any);
    logAuditSpy = vi.spyOn(auditSvc, "logAudit").mockImplementation(vi.fn() as any);
    genCustNrSpy = vi.spyOn(identifiers, "generateCustomerNumber").mockImplementation(async () => "CUST-GEN-1");
    getSyncJobConfigSpy = vi.spyOn(syncSchedSvc, "getSyncJobConfig").mockImplementation(async () => ({
      id: "cfg-1",
      jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
    } as any));
    createSyncJobRunSpy = vi.spyOn(syncSchedSvc, "createSyncJobRun").mockImplementation(async (tx, o: any) => ({
      id: "run-1",
      jobId: o.jobId,
      status: SyncJobStatus.RUNNING,
      startedAt: new Date(),
      configId: o.configId,
    } as any));
    completeSyncJobRunSpy = vi.spyOn(syncSchedSvc, "completeSyncJobRun").mockImplementation(async () => Promise.resolve() as any);

    (prisma.syncJobRun.findFirst as any).mockResolvedValue(null);
    (prisma.customer.findUnique as any).mockImplementation(async (q: any) => {
      if (!q || !q.where) return null;
      let base: Customer | null = null;
      if (typeof q.where.id === "string") base = __CID.get(q.where.id) ?? null;
      else if (typeof q.where.inserveCompanyId === "number") base = __CINS.get(q.where.inserveCompanyId) ?? null;
      if (!base) return null;
      if (q.select) {
        const out: any = {};
        for (const k of Object.keys(q.select)) if (k in base) out[k] = (base as any)[k];
        return out;
      }
      return base;
    });
    (prisma.customer.findFirst as any).mockImplementation(async (q: any) => {
      if (!q || !q.where) return null;
      let base: Customer | null = null;
      if (typeof q.where.id === "string") base = __CID.get(q.where.id) ?? null;
      else if (typeof q.where.inserveCompanyId === "number") base = __CINS.get(q.where.inserveCompanyId) ?? null;
      if (!base) return null;
      if (q.select) {
        const out: any = {};
        for (const k of Object.keys(q.select)) if (k in base) out[k] = (base as any)[k];
        return out;
      }
      return base;
    });
    (prisma.customer.findMany as any).mockResolvedValue([]);
    (prisma.customer.create as any).mockImplementation(async (d: any) => {
      const id = d.data?.id ?? `cust-${(d.data?.inserveCompanyId ?? Math.random().toString(36).slice(2, 7))}`;
      const created = {
        id,
        name: d.data?.name ?? "Onbekend",
        companyName: d.data?.companyName ?? d.data?.name ?? "Onbekend",
        parentCustomerId: d.data?.parentCustomerId ?? null,
        kvkNr: d.data?.kvkNr ?? d.data?.chamberOfCommerce ?? null,
        btwNr: d.data?.btwNr ?? d.data?.vatNumber ?? null,
        status: d.data?.status ?? "PROSPECT",
        type: d.data?.type ?? "CUSTOMER",
        customerNumber: d.data?.customerNumber ?? null,
        debtorCode: d.data?.debtorCode ?? null,
        inserveCompanyId: d.data?.inserveCompanyId ?? null,
        simOnlyCustomerId: d.data?.simOnlyCustomerId ?? null,
        externalId: d.data?.externalId ?? null,
        email: d.data?.email ?? null,
        phone: d.data?.phone ?? null,
        address: d.data?.address ?? null,
        postalCode: d.data?.postalCode ?? null,
        city: d.data?.city ?? null,
        country: d.data?.country ?? null,
        chamberOfCommerce: d.data?.chamberOfCommerce ?? d.data?.kvkNr ?? null,
        vatNumber: d.data?.vatNumber ?? d.data?.btwNr ?? null,
        contactPerson: d.data?.contactPerson ?? null,
        notes: d.data?.notes ?? null,
        createdById: d.data?.createdById ?? null,
        createdAt: d.data?.createdAt ?? new Date(),
        updatedAt: new Date(),
        deletedAt: d.data?.deletedAt ?? null,
      } as unknown as Customer;
      __CID.set(id, created);
      if ((created as any).inserveCompanyId) __CINS.set((created as any).inserveCompanyId, created);
      return created;
    });
    (prisma.customer.update as any).mockImplementation(async (d: any) => {
      let base: Customer | null = null;
      if (d.where?.id) base = __CID.get(d.where.id) ?? null;
      else if (d.where?.inserveCompanyId) base = __CINS.get(d.where.inserveCompanyId) ?? null;
      if (!base) base = { id: d.where?.id ?? `cust-update-${Math.random().toString(36).slice(2,7)}` } as unknown as Customer;
      const updated = {
        ...(base as any),
        ...(d.data ?? {}),
        updatedAt: new Date(),
      } as unknown as Customer;
      __CID.set((updated as any).id, updated);
      if ((updated as any).inserveCompanyId) __CINS.set((updated as any).inserveCompanyId, updated);
      return updated;
    });
  });

  afterEach(() => {
    consoleErr.mockRestore();
  });

  it("TR-4.1: Scope NIET INTERNAL → onmiddellijk FAILED, geen API calls", async () => {
    const s = await runInserveCustomerImport({ ...defaultCtx, roleScope: RoleScope.CUSTOMER });
    expect(s.status).toBe("FAILED");
    expect(s.errorMessage).toContain("INTERNAL");
    expect(listAllCompaniesSpy).not.toHaveBeenCalled();
  });

  it("TR-4.2: Mutex guard: reeds RUNNING job → SKIPPED", async () => {
    (prisma.syncJobRun.findFirst as any).mockResolvedValue({
      id: "run-bestaand",
      startedAt: new Date(),
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SKIPPED");
    expect(s.errorMessage).toContain("reeds een import bezig");
    expect(listAllCompaniesSpy).not.toHaveBeenCalled();
  });

  it("TR-4.3: Configuratiefout (Inserve client throws auth/config) → FAILED, 0 records", async () => {
    const { InserveApiError } = await import("@/server/integrations/inserve/client");
    listAllCompaniesSpy.mockRejectedValueOnce(new InserveApiError(401, { message: "Unauthorized" }, "GET /companies"));
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("FAILED");
    expect(s.errorMessage).toBeDefined();
    expect(s.fetched).toBe(0);
    expect(s.created).toBe(0);
  });

  it("TR-5.1: Filter Nexus=Actief: alleen actieve bedrijven worden verwerkt", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 1,
          name: "Actief Bedrijf",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
        makeCompany({
          id: 2,
          name: "Inactief Bedrijf",
          custom_fields: [{ name: "Nexus", value: "Inactief" }] as any,
        }),
        makeCompany({
          id: 3,
          name: "Ontbrekend Veld Bedrijf",
          custom_fields: [] as any,
        }),
        makeCompany({
          id: 4,
          name: "Leeg Veld Bedrijf",
          custom_fields: [{ name: "Nexus", value: "" }] as any,
        }),
      ],
      totalFetched: 4,
      totalExpected: 4,
      pagesProcessed: 1,
      responses: [],
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SUCCESS");
    expect(s.fetched).toBe(4);
    expect(s.activeFilterPassed).toBe(1);
    expect(s.created).toBe(1);
    expect(s.skipped.inactive_or_missing_nexus_field).toBe(3);
  });

  it("TR-5.2: Multi-page import: alle pagina's worden verwerkt (requestAllPages wordt 1x aangeroepen, result bevat alle items)", async () => {
    const companies: InserveCompany[] = [];
    for (let i = 1; i <= 25; i++) {
      companies.push(
        makeCompany({
          id: i,
          name: `Bedrijf ${i}`,
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        })
      );
    }
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: companies,
      totalFetched: 25,
      totalExpected: 25,
      pagesProcessed: 3,
      responses: [],
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(listAllCompaniesSpy).toHaveBeenCalledTimes(1);
    expect(s.fetched).toBe(25);
    expect(s.activeFilterPassed).toBe(25);
    expect(s.created).toBe(25);
  });

  it("TR-6.1: Idempotentie: 2e import met zelfde data → geen duplicaten, 100% unchanged", async () => {
    const companies = [
      makeCompany({
        id: 99,
        name: "Bestaand Bedrijf",
        debtor_code: "DEB-99",
        custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
      }),
    ];
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: companies,
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });

    (prisma.customer.findFirst as any).mockImplementation(async (q: any) => {
      if (q.where.inserveCompanyId === 99) {
        return mkCustomer({
          id: "cust-99",
          companyName: "Bestaand Bedrijf",
          customerNumber: "DEB-99",
          inserveCompanyId: 99,
          address: "Hoofdstraat 12",
          postalCode: "1234AB",
          city: "Amsterdam",
          country: "Nederland",
          phone: "0201234567",
          email: "info@testbedrijf.nl",
          kvkNr: "12345678",
          btwNr: "NL123456789B01",
        });
      }
      return null;
    });

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(0);
    expect(s.unchanged).toBe(1);
    expect(s.updated).toBe(0);
  });

  it("TR-6.2: Wijzigingen in Inserve → update alleen mapped velden; notes/status/type ongewijzigd", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 99,
          name: "Bestaand Bedrijf B.V.",
          debtor_code: "DEB-99-UPDATED",
          email: "nieuw@bedrijf.nl",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });

    const existing = mkCustomer({
      id: "cust-99",
      companyName: "Bestaand Bedrijf",
      customerNumber: "DEB-99",
      email: "oud@bedrijf.nl",
      inserveCompanyId: 99,
      notes: "BELANGRIJKE LOKALE NOTITIE",
      type: (CustomerType.DIRECT as unknown) as PrismaCustomerType,
      status: "ACTIVE",
    });
    (prisma.customer.findFirst as any).mockResolvedValueOnce(existing);

    let capturedUpdate: any = null;
    (prisma.customer.update as any).mockImplementation(async (o: any) => {
      capturedUpdate = o;
      return { id: o.where.id, ...o.data };
    });

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(0);
    expect(s.updated).toBe(1);
    expect(s.unchanged).toBe(0);
    expect(capturedUpdate).not.toBeNull();
    const data = capturedUpdate.data;
    expect(data.companyName).toBe("Bestaand Bedrijf B.V.");
    expect(data.customerNumber).toBe("DEB-99-UPDATED");
    expect(data.email).toBe("nieuw@bedrijf.nl");
    expect(data.notes).toBeUndefined();
    expect(data.type).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.deletedAt).toBeUndefined();
  });

  it("TR-6.3: Eerder Actief nu Inactief (met Inserve-koppeling) → WEL status op INACTIVE zetten, overige velden ONGEMOEID; customersDeactivated=1; previouslyActiveNowInactive gevuld", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 77,
          name: "Oud Actief Bedrijf",
          address_1: "Oud Adres 1",
          custom_fields: [{ name: "Nexus", value: "Inactief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    const existingCustomer = mkCustomer({
      id: "c-77",
      companyName: "Oud Actief Bedrijf",
      inserveCompanyId: 77,
      status: "ACTIVE",
      address: "Oud Adres 1",
      notes: "Lokale notitie die blijft staan",
    });
    (prisma.customer.findMany as any).mockResolvedValueOnce([
      existingCustomer,
    ]);
    (prisma.customer.findUnique as any).mockImplementation(async (q: any) => {
      if (q.where.id === "c-77") {
        return { id: "c-77", status: "ACTIVE", deletedAt: null };
      }
      if (q.where.inserveCompanyId === 77) {
        return existingCustomer;
      }
      return null;
    });

    let capturedUpdate: any = null;
    (prisma.customer.update as any).mockImplementation(async (o: any) => {
      capturedUpdate = o;
      return { id: o.where.id, ...o.data };
    });

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SUCCESS");
    expect(s.customersDeactivated).toBe(1);
    expect(s.customersReactivated).toBe(0);
    expect(s.updated).toBe(0);
    expect(s.created).toBe(0);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.data.status).toBe("INACTIVE");
    expect(capturedUpdate.data.companyName).toBeUndefined();
    expect(capturedUpdate.data.address).toBeUndefined();
    expect(capturedUpdate.data.notes).toBeUndefined();
    expect(s.previouslyActiveNowInactive).toHaveLength(1);
    expect(s.previouslyActiveNowInactive![0].inserveCompanyId).toBe(77);
  });

  it("TR-6.4: fetch_error (ophalen custom fields mislukt) → NIET als Inactief gezien; wordt geteld in skipped.fetch_error_nexus EN failed", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 55,
          name: "Bedrijf zonder inline velden",
        }),
        makeCompany({
          id: 56,
          name: "Actief met inline velden",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 2,
      totalExpected: 2,
      pagesProcessed: 1,
      responses: [],
    });
    vi.spyOn(inserveSvc, "listCompanyCustomFields").mockRejectedValueOnce(
      new Error("Timeout bij custom fields")
    );

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.fetched).toBe(2);
    expect(s.activeFilterPassed).toBe(1);
    expect(s.created).toBe(1);
    expect(s.skipped.fetch_error_nexus).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.status).toBe("FAILED");
  });

  it("TR-6.5: Bedrijf zonder naam (verplicht) → overgeslagen met reden missing_required_fields", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 10,
          name: "" as any,
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.activeFilterPassed).toBe(1);
    expect(s.skipped.missing_required_fields).toBe(1);
    expect(s.created).toBe(0);
    expect(s.skippedDetails!.length).toBe(1);
    expect(s.skippedDetails![0].reason).toContain("Bedrijfsnaam ontbreekt");
  });

  it("TR-6.6: Eén foutief record blokkeert NIET de hele import; import wordt FAILED met partial", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 1,
          name: "Goed Bedrijf 1",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
        makeCompany({
          id: 2,
          name: "Fout Bedrijf",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
        makeCompany({
          id: 3,
          name: "Goed Bedrijf 2",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 3,
      totalExpected: 3,
      pagesProcessed: 1,
      responses: [],
    });
    (prisma.customer.create as any).mockImplementation(async (o: any) => {
      if (o.data.inserveCompanyId === 2) {
        throw new Error("Database integriteitsfout #2");
      }
      return { id: `cust-${o.data.inserveCompanyId}`, ...o.data };
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.status).toBe("FAILED");
    expect(s.failedDetails!.length).toBe(1);
    expect(s.failedDetails![0].companyId).toBe(2);
  });

  it("TR-7.1: Tellingen correct: opgehaald, filterpass, aangemaakt, bijgewerkt, ongewijzigd, overgeslagen, mislukt", async () => {
    (prisma.customer.findMany as any).mockResolvedValueOnce([]);

    const findFirstMock = prisma.customer.findFirst as any;
    findFirstMock.mockImplementation(async (q: any) => {
      if (q.where.inserveCompanyId === 3) {
        return mkCustomer({
          id: "cust-3",
          companyName: "Bijwerken OUDE NAAM",
          customerNumber: "OUD-DEB",
          inserveCompanyId: 3,
        });
      }
      if (q.where.inserveCompanyId === 4) {
        return mkCustomer({
          id: "cust-4",
          companyName: "Onveranderd",
          customerNumber: "DEB-4",
          inserveCompanyId: 4,
        });
      }
      return null;
    });

    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({ id: 1, name: "Nieuw A", custom_fields: [{ name: "Nexus", value: "Actief" }] as any }),
        makeCompany({ id: 2, name: "Nieuw B", custom_fields: [{ name: "Nexus", value: "actief" }] as any }),
        makeCompany({ id: 3, name: "Bijwerken", debtor_code: "UPDATE-ME", custom_fields: [{ name: "Nexus", value: "  Actief  " }] as any }),
        makeCompany({ id: 4, name: "Onveranderd", debtor_code: "DEB-4", custom_fields: [{ name: "Nexus", value: "Actief" }] as any }),
        makeCompany({ id: 5, name: "Inactief Bedrijf", custom_fields: [{ name: "Nexus", value: "Inactief" }] as any }),
        makeCompany({ id: 6, name: "" as any, custom_fields: [{ name: "Nexus", value: "Actief" }] as any }),
      ],
      totalFetched: 6,
      totalExpected: 6,
      pagesProcessed: 1,
      responses: [],
    });

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.fetched).toBe(6);
    expect(s.activeFilterPassed).toBe(5);
    expect(s.created).toBe(2);
    expect(s.updated).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.skipped.inactive_or_missing_nexus_field).toBe(1);
    expect(s.skipped.missing_required_fields).toBe(1);
  });

  it("TR-7.2: findPossibleUnlinkedMatches rapporteert KvK/email/naam+postcode matches (geen auto-koppeling)", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 800,
          name: "Ongekoppeld Inserve Bedrijf",
          kvk_nr: "80000001",
          email: "ongekoppeld@inserve.nl",
          postal_code: "8000AA",
          custom_fields: [{ name: "Nexus", value: "Inactief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    (prisma.customer.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "nexus-800",
          companyName: "Ongekoppeld Inserve Bedrijf",
          kvkNr: "80000001",
          email: null,
          postalCode: null,
          inserveCompanyId: null,
          deletedAt: null,
        },
      ]);

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(0);
    expect(s.possibleUnlinkedMatches).toBeDefined();
    expect(s.possibleUnlinkedMatches!.length).toBeGreaterThanOrEqual(1);
    const reasons = s.possibleUnlinkedMatches!.map((m) => m.reason);
    expect(reasons).toContain("kvk");
  });
});

describe("InserveCustomerImport :: NIEUWE Features: Statusmatrix", () => {
  let listAllCompaniesSpy: any;
  let logAuditSpy: any;
  let genCustNrSpy: any;
  let getSyncJobConfigSpy: any;
  let createSyncJobRunSpy: any;
  let completeSyncJobRunSpy: any;
  let consoleErr: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(inserveClient as any, "isConfigured").mockResolvedValue(true);
    vi.spyOn(inserveClient as any, "inspectCredentials").mockResolvedValue({
      configured: true,
      source: "env",
      subdomainSet: true,
      apiKeySet: true,
      subdomainPrefix: "seguilo",
    });
    listAllCompaniesSpy = vi.spyOn(inserveSvc, "listAllCompanies");
    vi.spyOn(simLinkSvc, "runInserveSimAssetLink").mockResolvedValue({
      ...(simLinkSvc.EMPTY_SIM_LINK_SUMMARY ?? {
        totalAssetsExamined: 0,
        totalAssetsFetched: 0,
        newlyLinked: 0,
        reassignedInserveManaged: 0,
        unchanged: 0,
        notMatched: 0,
        conflicts: 0,
        skipped: 0,
        errors: 0,
        dryRun: false,
        endpointUsed: null,
        pagesProcessed: 0,
        totalExpectedAssets: 0,
        skippedDetails: [],
        conflictDetails: [],
        notMatchedDetails: [],
        errorMessages: [],
      }),
      dryRun: false,
      errors: 0,
    } as any);
    logAuditSpy = vi.spyOn(auditSvc, "logAudit").mockImplementation(vi.fn() as any);
    genCustNrSpy = vi.spyOn(identifiers, "generateCustomerNumber").mockImplementation(async () => "CUST-GEN-1");
    getSyncJobConfigSpy = vi.spyOn(syncSchedSvc, "getSyncJobConfig").mockImplementation(async () => ({
      id: "cfg-1",
      jobId: SyncJobId.INSERVE_CUSTOMER_IMPORT,
    } as any));
    createSyncJobRunSpy = vi.spyOn(syncSchedSvc, "createSyncJobRun").mockImplementation(async (tx, o: any) => ({
      id: "run-2",
      jobId: o.jobId,
      status: SyncJobStatus.RUNNING,
      startedAt: new Date(),
      configId: o.configId,
    } as any));
    completeSyncJobRunSpy = vi.spyOn(syncSchedSvc, "completeSyncJobRun").mockImplementation(async () => Promise.resolve() as any);

    (prisma.syncJobRun.findFirst as any).mockResolvedValue(null);
    (prisma.customer.findUnique as any).mockResolvedValue(null);
    (prisma.customer.findMany as any).mockResolvedValue([]);
    (prisma.customer.create as any).mockImplementation(async (d: any) => ({
      id: `cust-${d.data.inserveCompanyId ?? "new"}`,
      ...d.data,
    }));
    (prisma.customer.update as any).mockImplementation(async (d: any) => ({ id: d.where.id, ...d.data }));
  });

  afterEach(() => {
    consoleErr.mockRestore();
  });

  it("SM-1: Nexus=Inactief + GEEN bestaande koppeling → OVERSLAAN; geen klant", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 9001,
          name: "Nieuw Inactief Bedrijf",
          custom_fields: [{ name: "Nexus", value: "Inactief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    (prisma.customer.findMany as any).mockResolvedValueOnce([]);
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SUCCESS");
    expect(s.created).toBe(0);
    expect(s.updated).toBe(0);
    expect(s.customersDeactivated).toBe(0);
    expect(s.customersReactivated).toBe(0);
    expect(s.skipped.inactive_or_missing_nexus_field).toBe(1);
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("SM-2: Nexus=Actief + BESTAANDE klant (status=INACTIVE) → TERUG naar ACTIEF; customersReactivated=1", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 9002,
          name: "Heractiveerbaar Bedrijf",
          debtor_code: "DEB-9002",
          email: "hallo@heractiveer.nl",
          address_1: "Teststraat 1",
          postal_code: "1111AA",
          city: "Testdorp",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    const existing = mkCustomer({
      id: "cust-9002",
      companyName: "Heractiveerbaar Bedrijf",
      customerNumber: "DEB-9002",
      inserveCompanyId: 9002,
      status: "INACTIVE",
      email: "oud@heractiveer.nl",
    });
    (prisma.customer.findMany as any).mockResolvedValueOnce([existing]);
    (prisma.customer.findUnique as any).mockImplementation(async (q: any) => {
      if (q.where.id === "cust-9002") return existing;
      if (q.where.inserveCompanyId === 9002) return existing;
      return null;
    });
    let capturedUpdate: any = null;
    (prisma.customer.update as any).mockImplementation(async (o: any) => {
      capturedUpdate = o;
      return { id: o.where.id, ...o.data };
    });

    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SUCCESS");
    expect(s.customersReactivated).toBe(1);
    expect(s.updated).toBe(1);
    expect(s.previouslyInactiveNowActive).toHaveLength(1);
    expect(s.previouslyInactiveNowActive![0].inserveCompanyId).toBe(9002);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.data.status).toBe("ACTIVE");
  });

  it("SM-3: Nexus ontbreekt (missing) + BESTAANDE gekoppelde klant (status=ACTIVE) → status ONGEMOEID; tellingen unchanged/failed?", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 9003,
          name: "Geen Vrij Veld Bedrijf",
          custom_fields: [] as any,
        }),
      ],
      totalFetched: 1,
      totalExpected: 1,
      pagesProcessed: 1,
      responses: [],
    });
    const existing = mkCustomer({
      id: "cust-9003",
      companyName: "Geen Vrij Veld Bedrijf",
      inserveCompanyId: 9003,
      status: "ACTIVE",
    });
    (prisma.customer.findMany as any).mockResolvedValueOnce([existing]);
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("SUCCESS");
    expect(s.skipped.inactive_or_missing_nexus_field).toBe(1);
    expect(s.customersDeactivated).toBe(0);
    expect(s.customersReactivated).toBe(0);
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("SM-12: fetch_error op custom fields + BESTAANDE ACTIVE klant → status ONVERANDERD; failed=1; GEEN status naar INACTIVE", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 9012,
          name: "API Fout Vrij Veld",
        }),
      ],
      totalFetched: 1, totalExpected: 1, pagesProcessed: 1, responses: [],
    } as any);
    vi.spyOn(inserveSvc, "listCompanyCustomFields").mockRejectedValueOnce(
      new Error("500 Server Error custom fields endpoint")
    );
    const existing = mkCustomer({
      id: "cust-9012",
      companyName: "API Fout Vrij Veld",
      inserveCompanyId: 9012,
      status: "ACTIVE",
    });
    (prisma.customer.findMany as any).mockResolvedValueOnce([existing]);
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.status).toBe("FAILED");
    expect(s.skipped.fetch_error_nexus).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.customersDeactivated).toBe(0);
    expect(s.customersReactivated).toBe(0);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("SM-13: Secondary match bestaande klant (customerNumber/debtor_code) → BESTAAND gevonden via pre-check; UPDATE + inserveCompanyId SETTEN; created=0", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 8001,
          name: "Debiteur Match B.V.",
          debtor_code: "000649",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 1, totalExpected: 1, pagesProcessed: 1, responses: [],
    });
    const existing = mkCustomer({
      id: "cust-649",
      companyName: "OUDE NAAM (Match op debnr)",
      customerNumber: "000649",
      inserveCompanyId: null as any,
      status: "PROSPECT",
    });
    (prisma.customer.findFirst as any).mockImplementation(async (q: any) => {
      if (q.where?.inserveCompanyId === 8001) return null;
      if (Array.isArray(q.where?.OR)) {
        for (const cond of q.where.OR) {
          if (cond.customerNumber === "000649") return existing;
        }
      }
      if (q.where?.customerNumber === "000649") return existing;
      return null;
    });
    let capturedUpdate: any = null;
    (prisma.customer.update as any).mockImplementation(async (o: any) => {
      capturedUpdate = o;
      return { id: o.where.id, ...o.data, updatedAt: new Date() };
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(0);
    expect(s.updated).toBe(1);
    expect(s.failed).toBe(0);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.data.inserveCompanyId).toBe(8001);
    expect(capturedUpdate.data.status).toBe("ACTIVE");
    expect(capturedUpdate.data.companyName).toBe("Debiteur Match B.V.");
  });

  it("SM-14: P2002 collision customerNumber → fallback vind bestaand record; UPDATE+link inserveCompanyId; created=0; failed=0", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({
          id: 8002,
          name: "Debiteur Na Collision B.V.",
          debtor_code: "000078",
          custom_fields: [{ name: "Nexus", value: "Actief" }] as any,
        }),
      ],
      totalFetched: 1, totalExpected: 1, pagesProcessed: 1, responses: [],
    });
    const existing = mkCustomer({
      id: "cust-78",
      companyName: "Collision (Oud)",
      customerNumber: "000078",
      inserveCompanyId: null as any,
      status: "PROSPECT",
    });
    let findFirstCalls = 0;
    (prisma.customer.findFirst as any).mockImplementation(async (q: any) => {
      findFirstCalls++;
      if (q.where?.inserveCompanyId === 8002) return null;
      if (Array.isArray(q.where?.OR)) {
        for (const cond of q.where.OR) {
          if (cond.customerNumber === "000078") return existing;
        }
      }
      if (q.where?.customerNumber === "000078") return existing;
      return null;
    });
    (prisma.customer.create as any).mockImplementation(async () => {
      const err: any = new Error("Unique constraint failed on the fields: (`customerNumber`)");
      err.code = "P2002";
      err.meta = { target: ["customerNumber"] };
      throw err;
    });
    let capturedUpdate: any = null;
    (prisma.customer.update as any).mockImplementation(async (o: any) => {
      capturedUpdate = o;
      return { id: o.where.id, ...o.data, updatedAt: new Date() };
    });
    const s = await runInserveCustomerImport(defaultCtx);
    expect(s.created).toBe(0);
    expect(s.updated).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.status).toBe("SUCCESS");
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.data.inserveCompanyId).toBe(8002);
    expect(capturedUpdate.data.status).toBe("ACTIVE");
  });

  it("SM-15: Dry-run/proefmodus — plannedChanges gevuld; GEEN prisma writes; status=SUCCESS", async () => {
    listAllCompaniesSpy.mockResolvedValueOnce({
      items: [
        makeCompany({ id: 9101, name: "Nieuw Bedrijf", custom_fields: [{ name: "Nexus", value: "Actief" }] as any }),
      ],
      totalFetched: 1, totalExpected: 1, pagesProcessed: 1, responses: [],
    } as any);

    let createCalled = false;
    let updateCalled = false;
    (prisma.customer.create as any).mockImplementation(async () => { createCalled = true; return { id: "x" }; });
    (prisma.customer.update as any).mockImplementation(async () => { updateCalled = true; return {}; });

    const s = await runInserveCustomerImport(defaultCtx, { dryRun: true });
    expect(s.dryRun).toBe(true);
    expect(s.status).toBe("SUCCESS");
    // Geen schrijfbewerkingen.
    expect(createCalled).toBe(false);
    expect(updateCalled).toBe(false);
    // plannedChanges moet de berekende wijzigingen bevatten.
    expect(s.plannedChanges).toBeDefined();
    expect(s.plannedChanges!.companies.create).toBe(1);
  });
});
