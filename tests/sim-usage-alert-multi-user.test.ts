import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AlertThresholdLevel,
  NotificationChannel,
  type UserNotificationSettings,
} from "@prisma/client";

// ============== MOCKS ==============

const sentEmails: Array<{ toEmail: string; toName: string; items: any[] }> = [];
let sendEmailShouldFailFor: Set<string> = new Set();
let sendEmailShouldThrowFor: Set<string> = new Set();

vi.mock("@/server/services/email.service", () => ({
  sendSimUsageThresholdEmail: vi.fn(async (input: any) => {
    if (sendEmailShouldThrowFor.has(input.toEmail)) {
      throw new Error(`SMTP connectie mislukt voor ${input.toEmail}`);
    }
    if (sendEmailShouldFailFor.has(input.toEmail)) {
      return {
        dryRun: false,
        accepted: [],
        rejected: [input.toEmail],
        error: `Ongeldig e-mailadres: ${input.toEmail}`,
      };
    }
    sentEmails.push({
      toEmail: input.toEmail,
      toName: input.toName,
      items: input.items,
    });
    return {
      dryRun: false,
      accepted: [input.toEmail],
      rejected: [],
      messageId: `msg-${sentEmails.length}`,
    };
  }),
}));

let collectUserCustomerIdsImpl: (userId: string) => Promise<string[]> = async (
  _userId: string
) => ["cust-1"];

vi.mock("@/lib/rbac", () => ({
  collectUserCustomerIds: vi.fn(async (userId: string) => {
    return collectUserCustomerIdsImpl(userId);
  }),
  RoleScope: { INTERNAL: "INTERNAL", CUSTOMER: "CUSTOMER" },
}));

const mockPrisma = {
  userNotificationSettings: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  role: {
    findMany: vi.fn(),
  },
  sIM: {
    findMany: vi.fn(),
  },
  simUsageAlert: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  userCustomer: {
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// ============== TEST DATA ==============

const baseDate = new Date("2026-10-13T12:00:00Z");

function makeUserSettings(
  userId: string,
  email: string,
  name: string,
  overrides: Partial<UserNotificationSettings> = {}
): UserNotificationSettings & {
  user: { id: string; name: string; email: string; isActive: boolean; roleId: string };
} {
  return {
    id: `settings-${userId}`,
    userId,
    enabledEmail: true,
    notificationEmail: null,
    enabledDataThresholdAlert: true,
    dataThresholdPercent: 100,
    thresholdLevels: [AlertThresholdLevel.CRITICAL_100],
    usageAlertCheckIntervalMinutes: 60,
    notifyAllSims: false,
    channels: [NotificationChannel.EMAIL],
    lastNotificationAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    user: {
      id: userId,
      name,
      email,
      isActive: true,
      roleId: "role-customer",
    },
    ...overrides,
  };
}

function makeSimAbove100(simId: string, customerId: string) {
  return {
    id: simId,
    iccid: `ICCID-${simId}`,
    msisdn: `06-${simId}`,
    simName: `SIM ${simId}`,
    dataUsedBytes: 11_000_000_000n, // 11 GB
    dataLimitBytes: 10_000_000_000n, // 10 GB → 110% usage
    lowestDataLimitBytes: null,
    usagePeriodStart: baseDate,
    usageLocalProductName: "10GB",
    status: "ACTIVE",
    customerId,
    customerName: `Klant ${customerId}`,
    customerNumber: "CUST-001",
    assignments: [
      {
        subscription: {
          customer: {
            id: customerId,
            companyName: `Klant ${customerId}`,
            customerNumber: "CUST-001",
          },
        },
      },
    ],
  };
}

describe("sim-usage-alert multi-user notification", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendEmailShouldFailFor = new Set();
    sendEmailShouldThrowFor = new Set();
    collectUserCustomerIdsImpl = async (_userId: string) => ["cust-1"];
    vi.clearAllMocks();

    // 3 gebruikers met notificatie-instellingen
    mockPrisma.userNotificationSettings.findMany.mockResolvedValue([
      makeUserSettings("user-1", "user1@example.com", "Gebruiker 1"),
      makeUserSettings("user-2", "user2@example.com", "Gebruiker 2"),
      makeUserSettings("user-3", "user3@example.com", "Gebruiker 3"),
    ]);

    // Geen impliciete gebruikers
    mockPrisma.user.findMany.mockResolvedValue([]);

    // Rollen
    mockPrisma.role.findMany.mockResolvedValue([
      { id: "role-customer", scope: "CUSTOMER" },
    ]);

    // 1 SIM boven 100%
    mockPrisma.sIM.findMany.mockResolvedValue([makeSimAbove100("sim-1", "cust-1")]);

    // Geen reeds verzonden alerts
    mockPrisma.simUsageAlert.findMany.mockResolvedValue([]);

    // Alert creation slaagt
    mockPrisma.simUsageAlert.create.mockResolvedValue({ id: "alert-1" });
    mockPrisma.userNotificationSettings.upsert.mockResolvedValue({ id: "settings-1" });
  });

  it("stuurt een notificatiemail naar ALLE gebruikers met buitenbundel-notificaties (CRITICAL_100)", async () => {
    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // Verwacht: 3 gebruikers genotificeerd
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(3);
    expect(report.userSendFailures).toBe(0);

    // Verwacht: 3 e-mails verzonden (één per gebruiker)
    expect(sentEmails.length).toBe(3);

    // Controleer dat alle drie de gebruikers een e-mail ontvangen
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual([
      "user1@example.com",
      "user2@example.com",
      "user3@example.com",
    ]);

    // Geen duplicates: elke ontvanger precies één keer
    const uniqueRecipients = new Set(recipients);
    expect(uniqueRecipients.size).toBe(3);
  });

  it("blokkeert andere gebruikers niet wanneer één e-mail mislukt (ongeldig adres)", async () => {
    // User 2 heeft een ongeldig e-mailadres → SMTP weigert
    sendEmailShouldFailFor.add("user2@example.com");

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // 3 gebruikers gecheckt, 2 succesvol, 1 faling
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(2);
    expect(report.userSendFailures).toBe(1);

    // Alleen 2 e-mails daadwerkelijk verzonden
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);

    // De failende gebruiker staat in de report details met een foutmelding
    const failedDetail = report.details.find(
      (d) => d.email === "user2@example.com"
    );
    expect(failedDetail).toBeDefined();
    expect(failedDetail?.errorMessage).toContain("Ongeldig e-mailadres");
  });

  it("blokkeert andere gebruikers niet wanneer de e-mailfunctie een exception gooit", async () => {
    // User 2 veroorzaakt een onverwachte exception in sendSimUsageThresholdEmail
    sendEmailShouldThrowFor.add("user2@example.com");

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // 3 gebruikers gecheckt, 2 succesvol, 1 faling
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(2);
    expect(report.userSendFailures).toBe(1);

    // Alleen 2 e-mails daadwerkelijk verzonden
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);

    // De failende gebruiker staat in de report details
    const failedDetail = report.details.find(
      (d) => d.email === "user2@example.com"
    );
    expect(failedDetail).toBeDefined();
    expect(failedDetail?.errorMessage).toContain("SMTP connectie mislukt");
  });

  it("slaat gebruikers met lege customer scope over en verwerkt de rest wel", async () => {
    // User 2 heeft geen customer scope
    collectUserCustomerIdsImpl = async (userId: string) => {
      if (userId === "user-2") return [];
      return ["cust-1"];
    };

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // 3 gebruikers gecheckt, 2 genotificeerd
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(2);
    expect(report.userSendFailures).toBe(0);

    // Alleen 2 e-mails verzonden
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);

    // User 2 is overgeslagen vanwege lege scope
    const skippedDetail = report.details.find(
      (d) => d.email === "user2@example.com"
    );
    expect(skippedDetail).toBeDefined();
    expect(skippedDetail?.errorMessage).toContain("Lege customer scope");
  });

  it("slaat gebruikers over waarvan de laatste notificatie binnen het interval valt", async () => {
    // User 2 heeft recent al een notificatie gehad (binnen 60 min interval)
    // Gebruik Date.now() zodat de diff-minuten correct zijn tegenover nowCycle in de service.
    const recentDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min geleden
    mockPrisma.userNotificationSettings.findMany.mockResolvedValue([
      makeUserSettings("user-1", "user1@example.com", "Gebruiker 1"),
      makeUserSettings("user-2", "user2@example.com", "Gebruiker 2", {
        lastNotificationAt: recentDate,
      }),
      makeUserSettings("user-3", "user3@example.com", "Gebruiker 3"),
    ]);

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // 3 gebruikers gecheckt, 1 overgeslagen (interval), 2 genotificeerd
    expect(report.usersChecked).toBe(3);
    expect(report.usersSkippedInterval).toBe(1);
    expect(report.usersNotified).toBe(2);

    // Alleen 2 e-mails verzonden
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);

    // User 2 is overgeslagen vanwege interval
    const skippedDetail = report.details.find(
      (d) => d.email === "user2@example.com"
    );
    expect(skippedDetail).toBeDefined();
    expect(skippedDetail?.errorMessage).toContain("laatste notificatie");
  });

  it("verstuurt geen duplicate e-mails dankzij de anti-spam guard (alreadySent)", async () => {
    // Simuleer dat user 1 al een alert heeft voor sim-1 in deze periode
    mockPrisma.simUsageAlert.findMany.mockResolvedValue([
      {
        userId: "user-1",
        simId: "sim-1",
        thresholdLevel: AlertThresholdLevel.CRITICAL_100,
        usagePeriodStart: baseDate,
      },
    ]);

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // User 1 krijgt geen e-mail (reeds gerapporteerd), user 2 en 3 wel
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(2);
    expect(report.simsSkippedAlreadySent).toBe(1);

    // Alleen 2 e-mails verzonden
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user2@example.com", "user3@example.com"]);

    // User 1 is overgeslagen vanwege anti-spam guard
    const skippedDetail = report.details.find(
      (d) => d.email === "user1@example.com"
    );
    expect(skippedDetail).toBeDefined();
    expect(skippedDetail?.errorMessage).toContain("reeds gerapporteerd");
  });

  it("verwerkt alle gebruikers ook wanneer één gebruiker een onverwachte fout geeft in de scope-bepaling", async () => {
    // Simuleer dat collectUserCustomerIds een exception gooit voor user 2
    collectUserCustomerIdsImpl = async (userId: string) => {
      if (userId === "user-2") {
        throw new Error("Database verbinding verbroken");
      }
      return ["cust-1"];
    };

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    // User 2 krijgt lege scope (catch → []), dus overgeslagen. User 1 en 3 wel.
    expect(report.usersChecked).toBe(3);
    expect(report.usersNotified).toBe(2);
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);
  });

  it("gebruikt notificationEmail wanneer ingesteld in plaats van user.email", async () => {
    // User 1 heeft een aangepast notificatie-e-mailadres
    mockPrisma.userNotificationSettings.findMany.mockResolvedValue([
      makeUserSettings("user-1", "user1@example.com", "Gebruiker 1", {
        notificationEmail: "notifications@user1.nl",
      }),
      makeUserSettings("user-2", "user2@example.com", "Gebruiker 2"),
    ]);

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({
      dryRunForce: false,
    });

    expect(report.usersNotified).toBe(2);
    expect(sentEmails.length).toBe(2);

    // User 1 moet op zijn notificationEmail ontvangen, niet op user.email
    const user1Email = sentEmails.find((e) =>
      e.toEmail.includes("user1")
    )?.toEmail;
    expect(user1Email).toBe("notifications@user1.nl");
  });

  it("respecteert een expliciete opt-out: uitgeschakelde gebruikers worden niet als impliciete default meegenomen", async () => {
    // Eerste settings-query (include user): alleen user-1 is expliciet geactiveerd.
    // Tweede settings-query (select userId): user-1 én user-2 hebben een rij, waarbij
    // user-2 de datadrempel-alert expliciet heeft uitgeschakeld.
    mockPrisma.userNotificationSettings.findMany.mockImplementation(
      async (args: any) => {
        if (args?.select?.userId) {
          return [{ userId: "user-1" }, { userId: "user-2" }];
        }
        return [makeUserSettings("user-1", "user1@example.com", "Gebruiker 1")];
      }
    );

    // user-3 heeft géén instellingenrij → telt als impliciete default (aan).
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "user-3",
        name: "Gebruiker 3",
        email: "user3@example.com",
        isActive: true,
        roleId: "role-customer",
      },
    ]);

    const { runUsageAlertNotificationCycle } = await import(
      "@/server/services/sim-usage-alert.service"
    );

    const report = await runUsageAlertNotificationCycle({ dryRunForce: false });

    // Alleen user-1 (expliciet aan) en user-3 (impliciet) worden meegenomen.
    expect(report.usersChecked).toBe(2);
    expect(report.usersNotified).toBe(2);

    const recipients = sentEmails.map((e) => e.toEmail).sort();
    expect(recipients).toEqual(["user1@example.com", "user3@example.com"]);

    // De opt-out-gebruiker (user-2) ontvangt niets.
    expect(
      sentEmails.find((e) => e.toEmail === "user2@example.com")
    ).toBeUndefined();
  });
});
