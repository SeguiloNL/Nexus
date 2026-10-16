import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PRODUCT_TRACK_OPTIONS,
  isProductAvailableForTrack,
  productTrackLabel,
} from "@/lib/product-track";
import {
  CreateProductSchema,
  UpdateProductSchema,
} from "@/server/validators/product";
import { isDataPlanAvailableFor } from "@/server/services/data-plan.service";
import {
  ActivationOrderProductType,
  CustomerType,
  ProductTrack,
  UserRole,
} from "@/types/enums";

// ------------------------------------------------------------------
// Trajectgeschiktheid per product. Dekt:
//  - de drie instellingen (BOTH / SIM_ONLY / TRACKER) in beide trajecten;
//  - de standaardwaarde "Beide trajecten" voor bestaande/nieuwe producten;
//  - de beperkte set toegestane waarden (validatie);
//  - dat een Sim-only dataplan alleen producten toont die daarvoor geschikt zijn;
//  - dat de instelling correct naar de database wordt geschreven.
// ------------------------------------------------------------------

describe("isProductAvailableForTrack() — de drie instellingen", () => {
  it('"Beide trajecten" is in beide trajecten beschikbaar', () => {
    expect(isProductAvailableForTrack(ProductTrack.BOTH, "TRACKER")).toBe(true);
    expect(isProductAvailableForTrack(ProductTrack.BOTH, "SIM_ONLY")).toBe(true);
  });

  it('"Alleen Sim-only datasimkaart" is alleen in het Sim-only traject beschikbaar', () => {
    expect(isProductAvailableForTrack(ProductTrack.SIM_ONLY, "SIM_ONLY")).toBe(true);
    expect(isProductAvailableForTrack(ProductTrack.SIM_ONLY, "TRACKER")).toBe(false);
  });

  it('"Alleen Nieuwe tracker met simkaart" is alleen in het tracker-traject beschikbaar', () => {
    expect(isProductAvailableForTrack(ProductTrack.TRACKER, "TRACKER")).toBe(true);
    expect(isProductAvailableForTrack(ProductTrack.TRACKER, "SIM_ONLY")).toBe(false);
  });

  it("een ontbrekende instelling (legacy) blijft in beide trajecten zichtbaar", () => {
    expect(isProductAvailableForTrack(undefined, "TRACKER")).toBe(true);
    expect(isProductAvailableForTrack(undefined, "SIM_ONLY")).toBe(true);
    expect(isProductAvailableForTrack(null, "TRACKER")).toBe(true);
    expect(isProductAvailableForTrack(null, "SIM_ONLY")).toBe(true);
  });
});

describe("productTrackLabel() en keuzelijst", () => {
  it("geeft de juiste Nederlandse labels én standaard 'Beide trajecten'", () => {
    expect(productTrackLabel(ProductTrack.BOTH)).toBe("Beide trajecten");
    expect(productTrackLabel(ProductTrack.SIM_ONLY)).toBe("Alleen Sim-only datasimkaart");
    expect(productTrackLabel(ProductTrack.TRACKER)).toBe("Alleen Nieuwe tracker met simkaart");
    expect(productTrackLabel(undefined)).toBe("Beide trajecten");
  });

  it("bevat exact de drie toegestane opties met 'Beide trajecten' als eerste", () => {
    expect(PRODUCT_TRACK_OPTIONS.map((o) => o.value)).toEqual([
      ProductTrack.BOTH,
      ProductTrack.SIM_ONLY,
      ProductTrack.TRACKER,
    ]);
  });
});

describe("Validatie van de trajectinstelling (Zod)", () => {
  it("slaat 'Beide trajecten' op als de instelling ontbreekt (default)", () => {
    const parsed = CreateProductSchema.parse({
      name: "Product",
      productCode: "P-1",
      monthlyPrice: 10,
    });
    expect(parsed.track).toBe(ProductTrack.BOTH);
  });

  it("accepteert elk van de drie toegestane waarden en geeft ze ongewijzigd terug", () => {
    for (const track of [ProductTrack.BOTH, ProductTrack.SIM_ONLY, ProductTrack.TRACKER]) {
      const parsed = CreateProductSchema.parse({
        name: "Product",
        productCode: "P-1",
        monthlyPrice: 10,
        track,
      });
      expect(parsed.track).toBe(track);
    }
  });

  it("weigert een lege trajectinstelling", () => {
    const res = CreateProductSchema.safeParse({
      name: "Product",
      productCode: "P-1",
      monthlyPrice: 10,
      track: "",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.flatten().fieldErrors.track?.length).toBeGreaterThan(0);
    }
  });

  it("weigert een onbekende trajectwaarde", () => {
    const res = CreateProductSchema.safeParse({
      name: "Product",
      productCode: "P-1",
      monthlyPrice: 10,
      track: "ONBEKEND",
    });
    expect(res.success).toBe(false);
  });

  it("update-schema laat de trajectinstelling optioneel (gedeeltelijke update)", () => {
    expect(UpdateProductSchema.parse({}).track).toBeUndefined();
    expect(UpdateProductSchema.parse({ track: ProductTrack.TRACKER }).track).toBe(
      ProductTrack.TRACKER,
    );
  });
});

describe("Sim-only dataplanbeschikbaarheid respecteert de trajectinstelling", () => {
  const basePlan = {
    isActive: true,
    simOnlyAvailable: true,
    availableUntil: null as Date | null,
    targetRegions: [] as string[],
    targetCustomerTypes: [] as string[],
    productId: "prod_1" as string | null,
    product: { isActive: true, track: ProductTrack.BOTH } as {
      isActive: boolean;
      track?: string | null;
    } | null,
  };
  const ctx = { customerType: CustomerType.DIRECT, region: "NL" };

  it("dataplan met 'Beide trajecten'-product is beschikbaar voor Sim-only", () => {
    expect(isDataPlanAvailableFor(basePlan, ctx).available).toBe(true);
  });

  it("dataplan met 'Alleen Sim-only'-product is beschikbaar voor Sim-only", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, product: { isActive: true, track: ProductTrack.SIM_ONLY } },
      ctx,
    );
    expect(res.available).toBe(true);
  });

  it("dataplan met 'Alleen tracker'-product is NIET beschikbaar voor Sim-only", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, product: { isActive: true, track: ProductTrack.TRACKER } },
      ctx,
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/Sim-only/);
  });

  it("dataplan zonder trajectinstelling (legacy) blijft beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, product: { isActive: true } },
      ctx,
    );
    expect(res.available).toBe(true);
  });
});

// ------------------------------------------------------------------
// Opslag/ophalen: verifieer dat de trajectinstelling via de service
// daadwerkelijk naar de database-laag wordt geschreven.
// ------------------------------------------------------------------

const mockLogAudit = vi.fn();
const mockDiffObject = vi.fn(() => ({ oldValues: null, newValues: null }));

const mockProductCreate = vi.fn();
const mockProductUpdate = vi.fn();
const mockProductFindUniqueOrThrow = vi.fn();
const mockProductFindUnique = vi.fn();
const mockDataPlanFindUnique = vi.fn();
const mockCustomerFindFirst = vi.fn();

const mockTx = {
  product: {
    create: mockProductCreate,
    update: mockProductUpdate,
    findUniqueOrThrow: mockProductFindUniqueOrThrow,
    findUnique: mockProductFindUnique,
  },
  dataPlan: {
    findUnique: mockDataPlanFindUnique,
  },
  customer: {
    findFirst: mockCustomerFindFirst,
  },
};

const mockPrisma = {
  $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
};

vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.doMock("@/server/services/audit.service", () => ({
  logAudit: mockLogAudit,
  diffObject: mockDiffObject,
}));

const { createProduct, updateProduct } = await import(
  "@/server/services/product.service"
);

const ctx = { userId: "user_1", userRole: UserRole.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Opslag van de trajectinstelling in de database", () => {
  it("createProduct schrijft de gekozen trajectinstelling weg", async () => {
    mockProductCreate.mockResolvedValue({ id: "prod_1", track: ProductTrack.SIM_ONLY });
    await createProduct(
      {
        name: "Sim-only product",
        productCode: "P-SIM",
        monthlyPrice: 5,
        track: ProductTrack.SIM_ONLY,
      } as any,
      ctx,
    );
    expect(mockProductCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ track: ProductTrack.SIM_ONLY }),
    });
  });

  it("createProduct valt zonder instelling terug op 'Beide trajecten'", async () => {
    mockProductCreate.mockResolvedValue({ id: "prod_2", track: ProductTrack.BOTH });
    await createProduct(
      { name: "Algemeen product", productCode: "P-ANY", monthlyPrice: 5 } as any,
      ctx,
    );
    expect(mockProductCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ track: ProductTrack.BOTH }),
    });
  });

  it("updateProduct geeft een gewijzigde trajectinstelling door aan de database", async () => {
    mockProductFindUniqueOrThrow.mockResolvedValue({
      id: "prod_3",
      track: ProductTrack.BOTH,
    });
    mockProductUpdate.mockResolvedValue({ id: "prod_3", track: ProductTrack.TRACKER });
    await updateProduct("prod_3", { track: ProductTrack.TRACKER } as any, ctx);
    expect(mockProductUpdate).toHaveBeenCalledWith({
      where: { id: "prod_3" },
      data: expect.objectContaining({ track: ProductTrack.TRACKER }),
    });
  });
});

// ------------------------------------------------------------------
// Eis 2: ongeschikte producten zijn niet te gebruiken in het verkeerde
// traject via directe URL/API. De wizard-URL is te manipuleren, dus de
// blokkade zit ook op backend-niveau (createDraftOrder).
// ------------------------------------------------------------------

vi.doMock("@/lib/rbac", () => ({
  pickAuth: vi.fn(() => ({})),
  requirePermission: vi.fn(async () => true),
}));
vi.doMock("@/server/services/assignments.service", () => ({
  assignSim: vi.fn(),
  assignTracker: vi.fn(),
}));
vi.doMock("@/server/services/subscription.service", () => ({
  enqueueInserveSubscriptionSync: vi.fn(async () => undefined),
}));
vi.doMock("@/server/providers/registry", () => ({
  initializeProviderRegistry: vi.fn(async () => undefined),
  providerRegistry: {},
}));
vi.doMock("@/server/services/app-setting.service", () => ({
  getSimhuisSettings: vi.fn(async () => ({})),
}));
vi.doMock("@/server/integrations/simhuis/service", () => ({
  activateSim: vi.fn(),
  getSimStatus: vi.fn(),
  deactivateSim: vi.fn(),
}));
vi.doMock("@/server/integrations/navixy/service", () => ({
  registerTracker: vi.fn(),
  getTracker: vi.fn(),
  suspendTracker: vi.fn(),
  deleteTracker: vi.fn(),
  navixyClient: {},
}));

const { createDraftOrder } = await import(
  "@/server/services/activation-order.service"
);

const orderCtx = { userId: "user_1", userRole: UserRole.ADMIN };

describe("Backend-blokkade bij directe URL/API in het verkeerde traject", () => {
  it("weigert een 'Alleen Sim-only'-product in het tracker-traject", async () => {
    mockProductFindUnique.mockResolvedValue({ track: ProductTrack.SIM_ONLY });
    await expect(
      createDraftOrder(
        {
          customerId: "cust_1",
          productId: "prod_sim",
          orderType: ActivationOrderProductType.TRACKER_WITH_SIM,
        } as any,
        orderCtx,
      ),
    ).rejects.toThrow(/niet beschikbaar voor het Nieuwe tracker met simkaart-traject/);
  });

  it("weigert een dataplan met 'Alleen tracker'-product in het Sim-only traject", async () => {
    mockProductFindUnique.mockResolvedValue({ track: ProductTrack.TRACKER });
    mockDataPlanFindUnique.mockResolvedValue({
      id: "dp_1",
      isActive: true,
      simOnlyAvailable: true,
      availableUntil: null,
      targetRegions: [],
      targetCustomerTypes: [],
      productId: "prod_tracker",
      product: { id: "prod_tracker", isActive: true, track: ProductTrack.TRACKER },
    });
    mockCustomerFindFirst.mockResolvedValue({ type: CustomerType.DIRECT, country: "NL" });
    await expect(
      createDraftOrder(
        {
          customerId: "cust_1",
          productId: "prod_tracker",
          dataPlanId: "dp_1",
          orderType: ActivationOrderProductType.SIM_ONLY_DATA,
        } as any,
        orderCtx,
      ),
    ).rejects.toThrow(/Sim-only/);
  });
});
