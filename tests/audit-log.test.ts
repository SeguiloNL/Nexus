import { describe, it, expect } from "vitest";
import {
  AUDIT_ENTITY_TYPE_LABELS,
  buildAuditLogSearchText,
  buildTimestampSearchText,
  matchesAuditLogSearch,
  stringifySearchValue,
  type AuditLogSearchable,
} from "@/lib/audit-log-search";
import { resolveAuditTimestamp } from "@/server/services/audit.service";

// ------------------------------------------------------------------
// Unit tests voor de auditlog-zoekfunctie en timestamp-normalisatie.
// De DB-afhankelijke kant (Prisma-writes) wordt via de service afgedekt.
// ------------------------------------------------------------------

// Lokaal geconstrueerde datum → notaties zijn TZ-onafhankelijk te testen.
const TS = new Date(2026, 9, 16, 15, 4, 5); // 16-10-2026 15:04:05 (lokaal)

const baseLog: AuditLogSearchable = {
  timestamp: TS,
  action: "UPDATE",
  entityType: "customer",
  entityId: "cust_123",
  user: { name: "Jan Jansen", email: "jan@example.com" },
  oldValues: { status: "ACTIVE" },
  newValues: { status: "SUSPENDED" },
  metadata: { ip: "10.0.0.1", note: "Handmatige correctie" },
};

describe("resolveAuditTimestamp()", () => {
  it("geeft een geldige Date ongewijzigd terug", () => {
    expect(resolveAuditTimestamp(TS)).toBe(TS);
  });

  it("parseert een ISO 8601 string met tijdzone", () => {
    const iso = "2026-10-16T13:04:05.123Z";
    const result = resolveAuditTimestamp(iso);
    expect(result.toISOString()).toBe(iso);
  });

  it("valt terug op het huidige tijdstip bij null/undefined", () => {
    const before = Date.now();
    for (const value of [null, undefined]) {
      const result = resolveAuditTimestamp(value);
      expect(Number.isFinite(result.getTime())).toBe(true);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it("valt terug op het huidige tijdstip bij een ongeldige waarde", () => {
    const before = Date.now();
    for (const value of ["niet-een-datum", "", "   "]) {
      const result = resolveAuditTimestamp(value);
      expect(Number.isFinite(result.getTime())).toBe(true);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
    }
    const invalid = new Date("ongeldig");
    expect(Number.isFinite(resolveAuditTimestamp(invalid).getTime())).toBe(true);
  });
});

describe("buildTimestampSearchText() — meerdere notaties", () => {
  const text = buildTimestampSearchText(TS);

  it("bevat ISO 8601 met tijdzone (UTC)", () => {
    expect(text).toContain(TS.toISOString());
  });

  it("bevat de lokale ISO-achtige notatie (datum én tijd)", () => {
    expect(text).toContain("2026-10-16 15:04:05");
  });

  it("bevat de Nederlandse notatie met en zonder seconden", () => {
    expect(text).toContain("16-10-2026 15:04:05");
    expect(text).toContain("16-10-2026 15:04");
    expect(text).toContain("16-10-2026");
  });

  it("levert een lege string bij ontbrekende of ongeldige waarden", () => {
    expect(buildTimestampSearchText(null)).toBe("");
    expect(buildTimestampSearchText(undefined)).toBe("");
    expect(buildTimestampSearchText("")).toBe("");
  });
});

describe("stringifySearchValue()", () => {
  it("serialiseert geneste objecten", () => {
    expect(stringifySearchValue({ a: { b: "c" } })).toContain('"b":"c"');
  });

  it("gaat veilig om met BigInt", () => {
    expect(() => stringifySearchValue({ bytes: 123n })).not.toThrow();
    expect(stringifySearchValue({ bytes: 123n })).toContain("123");
  });

  it("geeft lege string voor null/undefined", () => {
    expect(stringifySearchValue(null)).toBe("");
    expect(stringifySearchValue(undefined)).toBe("");
  });
});

describe("matchesAuditLogSearch() — doorzoekt alle relevante velden", () => {
  it("matcht op actie (hoofdletterongevoelig)", () => {
    expect(matchesAuditLogSearch(baseLog, "update")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "UPDATE")).toBe(true);
  });

  it("matcht op entiteitstype: ruwe waarde én Nederlands label", () => {
    expect(matchesAuditLogSearch(baseLog, "customer")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "Klant")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "klant")).toBe(true);
  });

  it("matcht op object-id", () => {
    expect(matchesAuditLogSearch(baseLog, "cust_123")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "cust")).toBe(true);
  });

  it("matcht op gebruikersnaam en e-mail", () => {
    expect(matchesAuditLogSearch(baseLog, "jan jansen")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "example.com")).toBe(true);
  });

  it("matcht op datums en tijden in meerdere notaties", () => {
    expect(matchesAuditLogSearch(baseLog, "16-10-2026")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "16-10-2026 15:04:05")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "2026-10-16")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "15:04")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, TS.toISOString())).toBe(true);
  });

  it("matcht op metadata (JSON) en oude/nieuwe waarden", () => {
    expect(matchesAuditLogSearch(baseLog, "10.0.0.1")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "handmatige")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "suspended")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "active")).toBe(true);
  });

  it("past meerdere spatie-gescheiden termen als EN-filter toe", () => {
    expect(matchesAuditLogSearch(baseLog, "klant update")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "klant verwijderd")).toBe(false);
  });

  it("matcht alles bij een lege of whitespace-zoekterm", () => {
    expect(matchesAuditLogSearch(baseLog, "")).toBe(true);
    expect(matchesAuditLogSearch(baseLog, "   ")).toBe(true);
  });

  it("geeft false wanneer geen enkel veld overeenkomt", () => {
    expect(matchesAuditLogSearch(baseLog, "onvindbaar-xyz")).toBe(false);
  });

  it("gaat robuust om met ontbrekende velden", () => {
    expect(() => buildAuditLogSearchText({})).not.toThrow();
    expect(matchesAuditLogSearch({}, "iets")).toBe(false);
    expect(matchesAuditLogSearch({ timestamp: TS }, "16-10-2026")).toBe(true);
  });
});

describe("AUDIT_ENTITY_TYPE_LABELS", () => {
  it("bevat de kern-entiteitstypes voor de filter-UI", () => {
    for (const key of [
      "customer",
      "tracker",
      "sim",
      "user",
      "role",
      "setting",
      "audit_log",
    ]) {
      expect(AUDIT_ENTITY_TYPE_LABELS[key]).toBeTruthy();
    }
  });
});
