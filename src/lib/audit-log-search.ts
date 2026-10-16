/**
 * Auditlog-zoekhulp
 * ---------------------------------------------------------
 * Pure, framework-onafhankelijke helpers om een auditlog-regel om te zetten
 * naar doorzoekbare tekst en om te bepalen of een regel bij een zoekterm past.
 *
 * Doorzoekbaar zijn: de (volledige) timestamp in meerdere notaties, de actie,
 * het entiteitstype (zowel de ruwe waarde als het Nederlandse label), het
 * object-id, de gebruikersgegevens en de metadata/oude- en nieuwe waarden.
 *
 * De helpers zijn bewust losgekoppeld van React en Prisma zodat ze eenvoudig
 * unit-getest kunnen worden.
 */

import { format } from "date-fns";
import { nl } from "date-fns/locale/nl";

/** Nederlandse labels voor de entiteitstypes in de auditlog. */
export const AUDIT_ENTITY_TYPE_LABELS: Record<string, string> = {
  customer: "Klant",
  tracker: "Tracker",
  sim: "SIM",
  vehicle: "Voertuig",
  product: "Product",
  subscription: "Abonnement",
  activation_order: "Activatie",
  user: "Gebruiker",
  role: "Rol",
  setting: "Instelling",
  audit_log: "Auditlog",
};

/**
 * Minimale, structurele vorm van een auditlog-regel voor het zoeken. Bewust
 * losgekoppeld van het Prisma-type zodat de helper puur en testbaar blijft.
 */
export interface AuditLogSearchable {
  timestamp?: Date | string | null;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  user?: { name?: string | null; email?: string | null } | null;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * JSON-veilige tekstrepresentatie van willekeurige (ook geneste) waarden, zodat
 * metadata, oude en nieuwe waarden doorzoekbaar worden. BigInt wordt omgezet
 * naar een string (BigInt is niet JSON-serialiseerbaar).
 */
export function stringifySearchValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return (
      JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v
      ) ?? ""
    );
  } catch {
    return String(value);
  }
}

/**
 * Bouwt de doorzoekbare tekst voor een timestamp in meerdere notaties, zodat
 * zoeken op (delen van) datums en tijden werkt: ISO 8601 (UTC), ISO-achtig
 * lokaal, en Nederlandse notatie (dd-MM-yyyy). Ook de ISO-tijdsaanduiding met
 * tijdzone wordt meegenomen.
 */
export function buildTimestampSearchText(
  timestamp: Date | string | null | undefined
): string {
  if (timestamp === null || timestamp === undefined || timestamp === "") return "";
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return typeof timestamp === "string" ? timestamp : "";
  }

  const parts = new Set<string>();
  // ISO 8601 met tijdzone (UTC), b.v. 2026-10-16T13:04:05.123Z
  parts.add(date.toISOString());
  // Lokale ISO-achtige notatie, b.v. 2026-10-16 15:04:05
  parts.add(
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
      date.getDate()
    )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
      date.getSeconds()
    )}`
  );
  // Nederlandse notaties
  parts.add(format(date, "dd-MM-yyyy HH:mm:ss", { locale: nl }));
  parts.add(format(date, "dd-MM-yyyy HH:mm", { locale: nl }));
  parts.add(format(date, "dd-MM-yyyy", { locale: nl }));
  parts.add(format(date, "dd MMMM yyyy HH:mm:ss", { locale: nl }));

  return Array.from(parts).join(" ");
}

/** Volledige, doorzoekbare tekst van één auditlog-regel (in kleine letters). */
export function buildAuditLogSearchText(log: AuditLogSearchable): string {
  const entityType = log.entityType ?? "";
  return [
    buildTimestampSearchText(log.timestamp),
    log.action ?? "",
    entityType,
    entityType ? AUDIT_ENTITY_TYPE_LABELS[entityType] ?? "" : "",
    log.entityId ?? "",
    log.user?.name ?? "",
    log.user?.email ?? "",
    stringifySearchValue(log.oldValues),
    stringifySearchValue(log.newValues),
    stringifySearchValue(log.metadata),
  ]
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

/**
 * Bepaalt of een auditlog-regel overeenkomt met de zoekterm. Meerdere
 * spatie-gescheiden termen worden als EN-filter toegepast (alle termen moeten
 * voorkomen). Een lege zoekterm matcht alles.
 */
export function matchesAuditLogSearch(
  log: AuditLogSearchable,
  term: string
): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const haystack = buildAuditLogSearchText(log);
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}
