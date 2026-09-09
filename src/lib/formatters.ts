import { format } from "date-fns";
import { nl } from "date-fns/locale/nl";

// ============================================================
// Datum en tijd
// ============================================================

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd-MM-yyyy", { locale: nl });
}

export function formatDateTime(
  date: Date | string | null | undefined
): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd-MM-yyyy HH:mm", { locale: nl });
}

export function formatDateTimeFull(
  date: Date | string | null | undefined
): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd MMMM yyyy HH:mm:ss", { locale: nl });
}

export function formatDateRange(
  startAt: Date | string,
  endAt: Date | string | null | undefined
): string {
  const start = formatDate(startAt);
  const end = formatDate(endAt);
  if (!endAt) return `${start} tot heden`;
  return `${start} tot ${end}`;
}

// ============================================================
// Geld
// ============================================================

const CURRENCY_FORMATTERS: Record<string, Intl.NumberFormat> = {
  EUR: new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }),
  USD: new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "USD",
  }),
};

export function formatCurrency(
  amount: number | string | bigint | null | undefined,
  currency = "EUR"
): string {
  if (amount === null || amount === undefined || amount === "") return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : Number(amount);
  if (Number.isNaN(num)) return "-";
  const formatter =
    CURRENCY_FORMATTERS[currency] ?? CURRENCY_FORMATTERS.EUR;
  return formatter.format(num);
}

export function formatPricePerMonth(
  amount: number | bigint | string,
  currency = "EUR"
): string {
  return `${formatCurrency(amount, currency)} / maand`;
}

// ============================================================
// Hardware identificatie
// ============================================================

/**
 * Groepeert IMEI in cijferblokken voor leesbaarheid (4-4-4-3).
 * Voorbeeld: 8672890400732125 → 8672 8904 0073 2125
 */
export function formatImei(input: string | null | undefined): string {
  if (!input) return "-";
  const digits = input.replace(/\D/g, "");
  if (digits.length < 14) return digits;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/**
 * Groepeert ICCID in blokken.
 * ICCID is 19-20 cijfers: 89 3104 00000 00000 1
 * Wij gebruiken simpele 4-4 grouping.
 */
export function formatIccid(input: string | null | undefined): string {
  if (!input) return "-";
  const digits = input.replace(/\D/g, "");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function formatMsisdn(input: string | null | undefined): string {
  if (!input) return "-";
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("316") && digits.length === 11) {
    return `+31 6 ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10 && digits.startsWith("06")) {
    return `06 ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}`;
  }
  return input;
}

/**
 * Formatteert kenteken in NL-sideformaat (XX-XX-XX).
 */
export function formatLicensePlate(input: string | null | undefined): string {
  if (!input) return "-";
  const chars = input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (chars.length === 6) {
    // Probeer standaard groepering: twee per twee
    return `${chars.slice(0, 2)}-${chars.slice(2, 4)}-${chars.slice(4)}`;
  }
  return chars;
}

export function formatVin(input: string | null | undefined): string {
  if (!input) return "-";
  return input.toUpperCase();
}

// ============================================================
// ID's en nummers
// ============================================================

export function formatCustomerNumber(input: string | null | undefined): string {
  return input ?? "-";
}

export function formatSubscriptionNumber(
  input: string | null | undefined
): string {
  return input ?? "-";
}

export function formatOrderNumber(input: string | null | undefined): string {
  return input ?? "-";
}

// ============================================================
// Tekst helpers
// ============================================================

export function truncateText(input: string, maxLen = 80): string {
  if (!input) return "";
  if (input.length <= maxLen) return input;
  return input.slice(0, maxLen) + "…";
}

export function capitalizeFirst(input: string): string {
  if (!input) return "";
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}
