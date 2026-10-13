import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as inserveSvc from "@/server/integrations/inserve/service";
import { inserveClient, InserveClient } from "@/server/integrations/inserve/client";
import type { InserveCompany, InserveContact } from "@/server/integrations/inserve/types";

/**
 * Tests voor de Inserve synchronisatie fixes:
 *  - Multi-page paginering met top-level last_page/total
 *  - Nexus filtering (actief / inactief / ontbrekend)
 *  - Contactpersonen filteren op geselecteerde bedrijven
 *  - Bedrijf zonder contactpersonen
 *  - Idempotentie (geen duplicaten bij herhaalde sync)
 *  - Fout bij het ophalen van een volgende pagina
 */

function makeCompany(id: number, overrides: Partial<InserveCompany> = {}): InserveCompany {
  return {
    id,
    name: `Bedrijf ${id}`,
    debtor_code: `DEB-${id}`,
    address_1: "Straat 1",
    postal_code: "1234AB",
    city: "Amsterdam",
    country: "Nederland",
    customValues: [],
    ...overrides,
  } as InserveCompany;
}

function makeContact(id: number, companyId: number, overrides: Partial<InserveContact> = {}): InserveContact {
  return {
    id,
    company_id: companyId,
    first_name: `Contact${id}`,
    last_name: "Persoon",
    email_address: `contact${id}@bedrijf.nl`,
    ...overrides,
  } as InserveContact;
}

// Bouw een Inserve-achtige response met top-level paginering
function pageResponse<T>(data: T[], page: number, perPage: number, total: number): any {
  return {
    current_page: page,
    data,
    first_page_url: `http://test/api?page=1`,
    from: (page - 1) * perPage + 1,
    last_page: Math.ceil(total / perPage),
    last_page_url: `http://test/api?page=${Math.ceil(total / perPage)}`,
    next_page_url: page < Math.ceil(total / perPage) ? `http://test/api?page=${page + 1}` : null,
    path: "http://test/api",
    per_page: perPage,
    prev_page_url: page > 1 ? `http://test/api?page=${page - 1}` : null,
    to: Math.min(page * perPage, total),
    total,
  };
}

// Haal page/per_page uit de builder (zoals Inserve dat verwacht) of uit query params
function getPagination(opts: any): { page: number; perPage: number } {
  // Probeer eerst de builder: [{ with: [...] }, { paginate: { page, per_page } }]
  const builder = opts?.builder;
  if (Array.isArray(builder)) {
    for (const item of builder) {
      if (item && typeof item === 'object' && 'paginate' in item) {
        return {
          page: item.paginate.page ?? 1,
          perPage: item.paginate.per_page ?? 50,
        };
      }
    }
  }
  // Fallback: query params
  return {
    page: opts?.query?.page ?? 1,
    perPage: opts?.query?.per_page ?? 50,
  };
}

describe("Inserve paginering fix", () => {
  let mockRequest: any;
  let getClientSpy: any;

  beforeEach(() => {
    mockRequest = vi.fn();
    // Gebruik een echte InserveClient instantie zodat requestAllPages
    // beschikbaar is, maar mock de request-methode om API-calls te simuleren.
    const realClient = new InserveClient("test", "test");
    vi.spyOn(realClient, "request").mockImplementation(mockRequest);
    getClientSpy = vi.spyOn(inserveClient, "getClient").mockResolvedValue(realClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listAllCompanies haalt MEERDERE pagina's op met top-level last_page/total", async () => {
    // 120 bedrijven, 50 per pagina → 3 pagina's
    const allCompanies = Array.from({ length: 120 }, (_, i) => makeCompany(1001 + i));

    mockRequest.mockImplementation(async (_path: string, opts: any) => {
      const { page, perPage } = getPagination(opts);
      const start = (page - 1) * perPage;
      const slice = allCompanies.slice(start, start + perPage);
      return pageResponse(slice, page, perPage, allCompanies.length);
    });

    const result = await inserveSvc.listAllCompanies({ perPage: 50 });

    expect(result.items.length).toBe(120);
    expect(result.totalExpected).toBe(120);
    expect(result.pagesProcessed).toBe(3);
    // Controleer dat er geen duplicaten zijn
    const ids = new Set(result.items.map((c) => c.id));
    expect(ids.size).toBe(120);
  });

  it("listAllCompanies stopt correct bij de laatste pagina", async () => {
    // 51 bedrijven, 50 per pagina → 2 pagina's
    const allCompanies = Array.from({ length: 51 }, (_, i) => makeCompany(2001 + i));

    mockRequest.mockImplementation(async (_path: string, opts: any) => {
      const { page, perPage } = getPagination(opts);
      const start = (page - 1) * perPage;
      const slice = allCompanies.slice(start, start + perPage);
      return pageResponse(slice, page, perPage, allCompanies.length);
    });

    const result = await inserveSvc.listAllCompanies({ perPage: 50 });

    expect(result.items.length).toBe(51);
    expect(result.pagesProcessed).toBe(2); // 50 + 1
  });

  it("listAllCompanies gebruikt de builder voor paginering (geen conflicterende query params)", async () => {
    const allCompanies = [makeCompany(3001)];

    mockRequest.mockImplementation(async (_path: string, opts: any) => {
      const { page, perPage } = getPagination(opts);
      // Controleer dat GEEN builder[2][limit] of builder[3][page] wordt gestuurd
      expect(opts?.query?.["builder[2][limit]"]).toBeUndefined();
      expect(opts?.query?.["builder[3][page]"]).toBeUndefined();
      // Controleer dat GEEN page/per_page query params worden gestuurd (conflict met builder)
      expect(opts?.query?.page).toBeUndefined();
      expect(opts?.query?.per_page).toBeUndefined();
      // Controleer dat de builder paginate bevat
      const builder = opts?.builder;
      expect(Array.isArray(builder)).toBe(true);
      const paginateItem = builder?.find((b: any) => b && typeof b === 'object' && 'paginate' in b);
      expect(paginateItem).toBeDefined();
      expect(paginateItem.paginate.page).toBe(1);
      expect(paginateItem.paginate.per_page).toBe(50);
      const start = (page - 1) * perPage;
      const slice = allCompanies.slice(start, start + perPage);
      return pageResponse(slice, page, perPage, allCompanies.length);
    });

    await inserveSvc.listAllCompanies({ perPage: 50 });
  });

  it("listAllCompanies geeft een fout door wanneer een pagina faalt (geen stille stop)", async () => {
    mockRequest.mockImplementation(async (_path: string, opts: any) => {
      const { page } = getPagination(opts);
      if (page === 2) {
        throw new Error("Netwerkfout op pagina 2");
      }
      return pageResponse([makeCompany(4001)], 1, 25, 50);
    });

    await expect(inserveSvc.listAllCompanies({ perPage: 25 })).rejects.toThrow("Netwerkfout op pagina 2");
  });

  it("listClientsForCompanyIds Strategy A filtert contacten op gevraagde company IDs", async () => {
    // Company 1001 en 1002 zijn gevraagd; company 9999 niet
    const allContacts = [
      makeContact(5001, 1001),
      makeContact(5002, 1001),
      makeContact(5003, 1002),
      makeContact(5004, 9999), // behoort NIET tot gevraagde companies
    ];

    mockRequest.mockImplementation(async (path: string, opts: any) => {
      // Simuleer dat de API de company_id[] filter NEGEERT en alle contacten teruggeeft
      const { page, perPage } = getPagination(opts);
      const start = (page - 1) * perPage;
      const slice = allContacts.slice(start, start + perPage);
      return pageResponse(slice, page, perPage, allContacts.length);
    });

    const result = await inserveSvc.listClientsForCompanyIds([1001, 1002], { perPage: 50 });

    // Alleen contacten van company 1001 en 1002 mogen worden teruggegeven
    const returnedIds = new Set(result.items.map((c) => c.id));
    expect(returnedIds.has(5001)).toBe(true);
    expect(returnedIds.has(5002)).toBe(true);
    expect(returnedIds.has(5003)).toBe(true);
    expect(returnedIds.has(5004)).toBe(false);
  });

  it("listClientsForCompanyIds: bedrijf zonder contactpersonen geeft lege lijst", async () => {
    mockRequest.mockImplementation(async (_path: string, _opts: any) => {
      return pageResponse([], 1, 50, 0);
    });

    const result = await inserveSvc.listClientsForCompanyIds([1001], { perPage: 50 });

    expect(result.items.length).toBe(0);
  });

  it("listClientsForCompanyIds: filter fallback naar per-company wanneer server-filter niet werkt", async () => {
    // Veel contacten van niet-gevraagde companies → filter werkt niet → fallback
    const allContacts = [
      makeContact(5001, 9999), // niet gevraagd
      makeContact(5002, 8888), // niet gevraagd
      makeContact(5003, 1001), // wel gevraagd
    ];

    let clientListCalls = 0;
    let perCompanyCalls = 0;

    mockRequest.mockImplementation(async (path: string, _opts: any) => {
      if (path.startsWith("clients")) {
        clientListCalls++;
        // Geef alle contacten terug (filter werkt niet)
        return pageResponse(allContacts, 1, 50, allContacts.length);
      }
      if (path.includes("/clients")) {
        perCompanyCalls++;
        // Per-company endpoint geeft alleen de contacten van dat bedrijf
        const parts = path.split("/");
        const companyId = parseInt(parts[1]);
        const companyContacts = allContacts.filter((c) => c.company_id === companyId);
        return companyContacts;
      }
      return pageResponse([], 1, 50, 0);
    });

    const result = await inserveSvc.listClientsForCompanyIds([1001], { perPage: 50 });

    // Strategy A werd geprobeerd (clientListCalls > 0)
    expect(clientListCalls).toBeGreaterThan(0);
    // Uiteindelijk alleen contact van company 1001
    const returnedIds = new Set(result.items.map((c) => c.id));
    expect(returnedIds.has(5003)).toBe(true);
    expect(returnedIds.size).toBe(1);
  });
});
