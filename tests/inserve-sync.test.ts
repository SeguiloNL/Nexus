import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsertCompany = vi.fn();
const mockEnsureArticle = vi.fn();
const mockCreateContract = vi.fn();
const mockIsConfigured = vi.fn();
const mockLogAudit = vi.fn();

const mockSubUpdate = vi.fn();
const mockSubFindUniqueOrThrow = vi.fn();
const mockCustomerUpdate = vi.fn();
const mockProductUpdate = vi.fn();

const mockTx = {
  customer: { update: mockCustomerUpdate },
  product: { update: mockProductUpdate },
  subscription: { update: mockSubUpdate },
  auditLog: { create: vi.fn() },
};

const mockPrisma = {
  subscription: {
    findUniqueOrThrow: mockSubFindUniqueOrThrow,
    update: mockSubUpdate,
  },
  customer: { update: mockCustomerUpdate },
  product: { update: mockProductUpdate },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
};

vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.doMock("@/server/services/audit.service", () => ({ logAudit: mockLogAudit }));
vi.doMock("@/server/integrations/inserve/service", () => ({
  upsertCompany: mockUpsertCompany,
  ensureArticle: mockEnsureArticle,
  createSubscriptionContract: mockCreateContract,
  cancelOrTerminateContract: vi.fn(),
}));
vi.doMock("@/server/integrations/inserve/client", () => ({
  isConfigured: mockIsConfigured,
  inserveClient: { isConfigured: mockIsConfigured, getClient: vi.fn() },
}));

const { syncSubscriptionToInserve } = await import(
  "@/server/services/inserve-sync.service"
);

beforeEach(() => {
  vi.clearAllMocks();
  mockSubUpdate.mockResolvedValue(makeSub() as any);
  mockCustomerUpdate.mockResolvedValue({ id: "cust-1" } as any);
  mockProductUpdate.mockResolvedValue({ id: "prod-1" } as any);
  mockLogAudit.mockResolvedValue({ id: "audit-1" } as any);
  (mockTx.auditLog as any).create.mockResolvedValue({ id: "audit-1" });
  (mockPrisma.auditLog as any).create.mockResolvedValue({ id: "audit-1" });
});

function makeSub(overrides: Partial<any> = {}) {
  return {
    id: "sub-1",
    subscriptionNumber: "SUB-2026-000042",
    status: "ACTIVE",
    startDate: new Date("2026-01-01"),
    endDate: null,
    monthlyPrice: { toNumber: () => 29.99 } as any,
    billingCycle: "MONTHLY",
    inserveSubscriptionId: null,
    inserveSyncStatus: "PENDING",
    inserveSyncError: null,
    inserveLastSyncedAt: null,
    notes: null,
    customerId: "cust-1",
    productId: "prod-1",
    customer: {
      id: "cust-1",
      customerNumber: "K-2026-00001",
      companyName: "Test B.V.",
      address: "Straat 1",
      postalCode: "1234AB",
      city: "Amsterdam",
      country: "NL",
      contactPerson: "Jan",
      phone: "0612345678",
      email: "jan@test.nl",
      kvkNr: "12345678",
      btwNr: "NL123456789B01",
      inserveCompanyId: null,
    },
    product: {
      id: "prod-1",
      productCode: "TRACKER-PRO",
      name: "Tracker Pro",
      monthlyPrice: { toNumber: () => 29.99 } as any,
      currency: "EUR",
      btwPercentage: { toNumber: () => 21 } as any,
      isActive: true,
      inserveArticleId: null,
    },
    ...overrides,
  };
}

describe("syncSubscriptionToInserve", () => {
  describe("a) happy path: ACTIVE zonder Inserve IDs", () => {
    it("3 calls (upsertCompany, ensureArticle, createContract), IDs bewaard, status SYNCED", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockSubFindUniqueOrThrow.mockResolvedValue(makeSub());
      mockUpsertCompany.mockResolvedValue({ id: 101, debtorCode: "K-2026-00001" });
      mockEnsureArticle.mockResolvedValue(202);
      mockCreateContract.mockResolvedValue(303);

      const ctx = { userId: "u-1", userRole: "ADMIN" } as any;
      const result = await syncSubscriptionToInserve("sub-1", ctx);

      expect(mockUpsertCompany).toHaveBeenCalledTimes(1);
      expect(mockEnsureArticle).toHaveBeenCalledTimes(1);
      expect(mockCreateContract).toHaveBeenCalledTimes(1);

      expect(mockCustomerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cust-1" },
          data: { inserveCompanyId: 101 },
        })
      );
      expect(mockProductUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prod-1" },
          data: { inserveArticleId: 202 },
        })
      );
      expect(mockSubUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inserveSubscriptionId: 303,
            inserveSyncStatus: "SYNCED",
          }),
        })
      );

      expect(result.status).toBe("SYNCED");
    });
  });

  describe("b) Inserve niet geconfigureerd", () => {
    it("status SKIPPED, geen calls", async () => {
      mockIsConfigured.mockReturnValue(false);

      const ctx = { userId: "u-1", userRole: "ADMIN" } as any;
      const result = await syncSubscriptionToInserve("sub-1", ctx);

      expect(result.status).toBe("SKIPPED");
      expect(result.details).toContain("niet geconfigureerd");

      expect(mockSubFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockUpsertCompany).not.toHaveBeenCalled();
      expect(mockEnsureArticle).not.toHaveBeenCalled();
      expect(mockCreateContract).not.toHaveBeenCalled();
    });
  });

  describe("c) API fout in stap C (createContract)", () => {
    it("status FAILED, error gevuld, company/article IDs blijven bewaard", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockSubFindUniqueOrThrow.mockResolvedValue(makeSub());
      mockUpsertCompany.mockResolvedValue({ id: 101, debtorCode: "K-2026-00001" });
      mockEnsureArticle.mockResolvedValue(202);
      mockCreateContract.mockRejectedValue(new Error("Inserve createContract exploded"));

      const ctx = { userId: "u-1", userRole: "ADMIN" } as any;
      const result = await syncSubscriptionToInserve("sub-1", ctx);

      expect(mockCustomerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cust-1" },
          data: { inserveCompanyId: 101 },
        })
      );
      expect(mockProductUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prod-1" },
          data: { inserveArticleId: 202 },
        })
      );

      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("Inserve createContract exploded");
    });
  });

  describe("d) status DRAFT", () => {
    it("early return, status SKIPPED (geen calls naar inserve)", async () => {
      mockIsConfigured.mockReturnValue(true);
      mockSubFindUniqueOrThrow.mockResolvedValue(makeSub({ status: "DRAFT" }));

      const ctx = { userId: "u-1", userRole: "ADMIN" } as any;
      const result = await syncSubscriptionToInserve("sub-1", ctx);

      expect(result.status).toBe("SKIPPED");
      expect(result.details).toContain("DRAFT");

      expect(mockUpsertCompany).not.toHaveBeenCalled();
      expect(mockEnsureArticle).not.toHaveBeenCalled();
      expect(mockCreateContract).not.toHaveBeenCalled();
    });
  });
});
