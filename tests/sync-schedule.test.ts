import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncJobConfig as PrismaSyncConfig } from "@prisma/client";
import {
  SyncFrequency,
  SyncJobId,
  type RoleScope,
} from "@/types/enums";
import type { SaveSyncScheduleInput } from "@/server/validators/schedule";

const mockLogAudit = vi.fn();
const mockDiffObject = vi.fn((a: unknown, b: unknown) => ({
  before: a,
  after: b,
}));

const mockSyncJobConfigFindUnique = vi.fn();
const mockSyncJobConfigFindMany = vi.fn();
const mockSyncJobConfigUpsert = vi.fn();
const mockSyncJobRunCreate = vi.fn();
const mockSyncJobRunUpdate = vi.fn();
const mockAuditLogCreate = vi.fn();

const mockTx = {
  syncJobConfig: {
    findUnique: mockSyncJobConfigFindUnique,
    findMany: mockSyncJobConfigFindMany,
    upsert: mockSyncJobConfigUpsert,
  },
  syncJobRun: {
    create: mockSyncJobRunCreate,
    update: mockSyncJobRunUpdate,
  },
  auditLog: { create: mockAuditLogCreate },
};

const mockPrisma = {
  syncJobConfig: {
    findUnique: mockSyncJobConfigFindUnique,
    findMany: mockSyncJobConfigFindMany,
    upsert: mockSyncJobConfigUpsert,
  },
  syncJobRun: {
    create: mockSyncJobRunCreate,
    update: mockSyncJobRunUpdate,
  },
  auditLog: { create: mockAuditLogCreate },
  $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
};

vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.doMock("@/server/services/audit.service", () => ({
  logAudit: mockLogAudit,
  diffObject: mockDiffObject,
}));

const {
  HISTORIC_HOURLY_WINDOWS,
  getDefaultSyncJobConfig,
  shouldRunNow,
  validateNoOverlap,
  saveSyncJobConfig,
} = await import("@/server/services/sync-schedule.service");

const { SaveSyncScheduleSchema } = await import("@/server/validators/schedule");

beforeEach(() => {
  vi.clearAllMocks();
});

function buildCfg(patch: Partial<SaveSyncScheduleInput>): SaveSyncScheduleInput {
  return {
    jobId: SyncJobId.SIMHUIS_USAGE,
    enabled: true,
    frequency: SyncFrequency.HOURLY,
    hour: 0,
    minute: 0,
    timezone: "Europe/Amsterdam",
    ...patch,
  };
}

function asPrismaCfg(patch: Partial<PrismaSyncConfig>): PrismaSyncConfig {
  return {
    id: "cfg-1",
    jobId: SyncJobId.SIMHUIS_USAGE,
    enabled: true,
    frequency: SyncFrequency.HOURLY,
    hour: 0,
    minute: 0,
    dayOfWeek: null,
    dayOfMonth: null,
    timezone: "Europe/Amsterdam",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    lastAppliedAt: null,
    updatedById: null,
    ...patch,
  } as PrismaSyncConfig;
}

type TestUser = {
  id: string;
  email?: string | null;
  role?: unknown;
  roleScope?: RoleScope;
  permissions?: unknown;
};

const ADMIN: TestUser = {
  id: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
  roleScope: "INTERNAL",
};

describe("SaveSyncScheduleSchema (§AC-1 validatie)", () => {
  it("accepteert HOURLY zonder dayOfWeek/dayOfMonth", () => {
    const r = SaveSyncScheduleSchema.safeParse(
      buildCfg({ frequency: SyncFrequency.HOURLY, minute: 5 })
    );
    expect(r.success).toBe(true);
  });

  it("weigert WEEKLY zonder dayOfWeek", () => {
    const r = SaveSyncScheduleSchema.safeParse(
      buildCfg({
        jobId: SyncJobId.SIMHUIS_SIMS,
        frequency: SyncFrequency.WEEKLY,
        hour: 3,
        minute: 0,
        dayOfWeek: undefined as any,
      })
    );
    expect(r.success).toBe(false);
  });

  it("accepteert WEEKLY met dayOfWeek 1-7", () => {
    const r = SaveSyncScheduleSchema.safeParse(
      buildCfg({
        jobId: SyncJobId.SIMHUIS_SIMS,
        frequency: SyncFrequency.WEEKLY,
        hour: 3,
        minute: 0,
        dayOfWeek: 1,
      })
    );
    expect(r.success).toBe(true);
  });

  it("weigert MONTHLY zonder dayOfMonth", () => {
    const r = SaveSyncScheduleSchema.safeParse(
      buildCfg({
        jobId: SyncJobId.INSERVE,
        frequency: SyncFrequency.MONTHLY,
        hour: 2,
        minute: 0,
        dayOfMonth: undefined as any,
      })
    );
    expect(r.success).toBe(false);
  });

  it("weigert ongeldige timezone", () => {
    const r = SaveSyncScheduleSchema.safeParse(
      buildCfg({ timezone: "Mars/Phobos" })
    );
    expect(r.success).toBe(false);
  });

  it("weigert hour < 0 of > 23", () => {
    expect(
      SaveSyncScheduleSchema.safeParse(buildCfg({ hour: -1 })).success
    ).toBe(false);
    expect(
      SaveSyncScheduleSchema.safeParse(buildCfg({ hour: 24 })).success
    ).toBe(false);
  });

  it("weigert minute < 0 of > 59", () => {
    expect(
      SaveSyncScheduleSchema.safeParse(buildCfg({ minute: -1 })).success
    ).toBe(false);
    expect(
      SaveSyncScheduleSchema.safeParse(buildCfg({ minute: 60 })).success
    ).toBe(false);
  });
});

describe("Defaults §AC-9 (historische uren windows)", () => {
  it("HISTORIC_HOURLY_WINDOWS bevat de 3 legacy sloten", () => {
    expect(HISTORIC_HOURLY_WINDOWS[SyncJobId.SIMHUIS_USAGE]).toEqual([0]);
    expect(HISTORIC_HOURLY_WINDOWS[SyncJobId.SIMHUIS_SIMS]).toEqual([
      3, 9, 15, 21,
    ]);
    expect(HISTORIC_HOURLY_WINDOWS[SyncJobId.INSERVE]).toEqual([2, 8, 14, 20]);
  });

  it("getDefaultSyncJobConfig SIMHUIS_USAGE = HOURLY :00", () => {
    const d = getDefaultSyncJobConfig(SyncJobId.SIMHUIS_USAGE);
    expect(d.frequency).toBe(SyncFrequency.HOURLY);
    expect(d.minute).toBe(0);
  });

  it("getDefaultSyncJobConfig SIMHUIS_SIMS = DAILY 03:00", () => {
    const d = getDefaultSyncJobConfig(SyncJobId.SIMHUIS_SIMS);
    expect(d.frequency).toBe(SyncFrequency.DAILY);
    expect(d.hour).toBe(3);
    expect(d.minute).toBe(0);
  });

  it("getDefaultSyncJobConfig INSERVE = DAILY 02:00", () => {
    const d = getDefaultSyncJobConfig(SyncJobId.INSERVE);
    expect(d.frequency).toBe(SyncFrequency.DAILY);
    expect(d.hour).toBe(2);
    expect(d.minute).toBe(0);
  });
});

describe("shouldRunNow (Schedule Guard §AC-2)", () => {
  it("enabled=false => moet niet draaien (taak uitgeschakeld)", () => {
    const cfg = asPrismaCfg({ enabled: false, lastAppliedAt: new Date() });
    const r = shouldRunNow(cfg, new Date("2025-01-06T09:00:00Z"));
    expect(r.shouldRun).toBe(false);
  });

  it("HOURLY minute=0, nu 10:05 Amsterdam (09:05 UTC) => binnen grace (±7m) -> true", () => {
    const cfg = asPrismaCfg({
      frequency: SyncFrequency.HOURLY,
      minute: 0,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T09:05:00Z"));
    expect(r.shouldRun).toBe(true);
  });

  it("HOURLY minute=0, nu 10:10 Amsterdam (09:10 UTC) => buiten grace -> false", () => {
    const cfg = asPrismaCfg({
      frequency: SyncFrequency.HOURLY,
      minute: 0,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T09:10:00Z"));
    expect(r.shouldRun).toBe(false);
  });

  it("DAILY 03:00 Amsterdam, nu 03:05 Amsterdam (02:05 UTC) => binnen -> true", () => {
    const cfg = asPrismaCfg({
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T02:05:00Z"));
    expect(r.shouldRun).toBe(true);
  });

  it("DAILY 03:00 Amsterdam, nu 03:10 Amsterdam (02:10 UTC) => buiten -> false", () => {
    const cfg = asPrismaCfg({
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T02:10:00Z"));
    expect(r.shouldRun).toBe(false);
  });

  it("WEEKLY dow=1 (maandag) 03:00 Amsterdam, nu maandag 03:05 (02:05 UTC) => true", () => {
    const cfg = asPrismaCfg({
      frequency: SyncFrequency.WEEKLY,
      dayOfWeek: 1,
      hour: 3,
      minute: 0,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T02:05:00Z"));
    expect(r.shouldRun).toBe(true);
  });

  it("default (lastAppliedAt=null SIMS) op 03:05 Amsterdam => legacy slot -> true", () => {
    const cfg = asPrismaCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      lastAppliedAt: null,
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T02:05:00Z"));
    expect(r.shouldRun).toBe(true);
  });

  it("default (lastAppliedAt=null SIMS) op 04:05 Amsterdam => geen legacy slot -> false", () => {
    const cfg = asPrismaCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      lastAppliedAt: null,
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T03:05:00Z"));
    expect(r.shouldRun).toBe(false);
  });

  it("force=true => altijd draaien (§AC-3)", () => {
    const cfg = asPrismaCfg({
      enabled: false,
      frequency: SyncFrequency.DAILY,
      hour: 23,
      minute: 59,
      lastAppliedAt: new Date(),
    });
    const r = shouldRunNow(cfg, new Date("2025-01-06T03:05:00Z"), { force: true });
    expect(r.shouldRun).toBe(true);
    expect(r.reason).toMatch(/handmatige run/);
  });
});

describe("validateNoOverlap", () => {
  it("gooit Error bij identiek hour+minute+frequentie", async () => {
    const other = asPrismaCfg({
      id: "cfg-2",
      jobId: SyncJobId.INSERVE,
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      enabled: true,
    });
    mockSyncJobConfigFindMany.mockResolvedValueOnce([other]);

    const candidate = buildCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      frequency: SyncFrequency.DAILY,
      hour: 3,
      minute: 0,
      enabled: true,
    });

    await expect(
      validateNoOverlap(mockPrisma as any, candidate)
    ).rejects.toThrow(/Schema-conflict/);
  });

  it("geen fout als disabled", async () => {
    const candidate = buildCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      enabled: false,
    });
    await expect(
      validateNoOverlap(mockPrisma as any, candidate)
    ).resolves.not.toThrow();
    expect(mockSyncJobConfigFindMany).not.toHaveBeenCalled();
  });
});

describe("saveSyncJobConfig §AC-1 (transactie + audit diff)", () => {
  it("voert findUnique + findMany (overlap) + upsert uit en logt audit met UPDATE_SETTINGS scope=sync_schedule", async () => {
    const input = buildCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      frequency: SyncFrequency.DAILY,
      hour: 4,
      minute: 30,
      enabled: true,
    });

    const oldCfg = asPrismaCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      hour: 3,
      minute: 0,
      enabled: true,
    });
    const newCfg = asPrismaCfg({
      jobId: SyncJobId.SIMHUIS_SIMS,
      hour: 4,
      minute: 30,
    });

    mockSyncJobConfigFindUnique.mockResolvedValueOnce(oldCfg);
    mockSyncJobConfigFindMany.mockResolvedValueOnce([]);
    mockSyncJobConfigUpsert.mockResolvedValueOnce(newCfg);

    await saveSyncJobConfig(mockTx as any, input, ADMIN);

    expect(mockSyncJobConfigFindUnique).toHaveBeenCalledTimes(1);
    expect(mockSyncJobConfigFindMany).toHaveBeenCalledTimes(1);
    expect(mockSyncJobConfigUpsert).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        action: "UPDATE_SETTINGS",
        metadata: expect.objectContaining({ scope: "sync_schedule" }),
      })
    );
  });
});
