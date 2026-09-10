// Validatie en normalisatie helpers
// Alle normalisaties verwijderen onnodige tekens en zorgen voor consistente opslag

// ============================================================
// Normalisatie functies
// ============================================================

/**
 * Normaliseert een IMEI-nummer.
 * - Verwijdert alle niet-cijfertekens (spaties, streepjes, etc.)
 * - IMEI is 14 of 15 cijfers (15 met Luhn check digit)
 */
export function normalizeImei(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Normaliseert een ICCID-nummer.
 * - ICCID is 19-20 cijfers, meestal beginnend met 89
 */
export function normalizeIccid(input: string): string {
  return input.replace(/\D/g, "").toUpperCase();
}

/**
 * Normaliseert een MSISDN (telefoonnummer SIM)
 * - Verwijdert spaties, streepjes, haakjes, etc.
 * - Nederlands 06-nummer -> +316xxxxxxxxx
 */
export function normalizeMsisdn(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    return "+" + digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return "+31" + digits.slice(1);
  }
  if (!digits.startsWith("+") && /^\d+$/.test(digits)) {
    return "+" + digits;
  }
  return digits;
}

/**
 * Normaliseert een VIN (chassisnummer)
 * - 17 alfanumerieke karakters, geen I, O of Q
 */
export function normalizeVin(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Normaliseert een kenteken (NL bij benadering).
 * - Maakt uppercase, vervangt spaties/streepjes door standaard formaat?
 * - We bewaren simpelweg uppercase zonder speciale tekens, formaat laat aan UI over.
 */
export function normalizeLicensePlate(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Normaliseert een serienummer (vrij formaat, wel case consistent).
 */
export function normalizeSerialNumber(input: string): string {
  return input.trim();
}

// ============================================================
// IMEI - Luhn checksum algoritme
// ============================================================

/**
 * Valideert IMEI-formaat EN Luhn checksum.
 * @returns true als IMEI geldig is
 */
export function isValidImei(input: string): boolean {
  const imei = normalizeImei(input);
  if (!/^\d{14,15}$/.test(imei)) return false;

  // 14 cijfers zonder check digit of 15 met check digit
  // We berekenen Luhn over de eerste 14 cijfers en vergelijken met 15e
  const digits = imei.split("").map(Number);
  let sum = 0;

  for (let i = 0; i < 14; i++) {
    let d = digits[i];
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }

  const checkDigit = (10 - (sum % 10)) % 10;

  if (digits.length === 14) {
    // Als alleen 14 cijfers: het formaat is geldig (check digit kan later worden toegevoegd)
    return true;
  }

  // 15 cijfers: check digit moet kloppen
  return digits[14] === checkDigit;
}

// ============================================================
// ICCID validatie
// ============================================================

/**
 * Valideert ICCID formaat.
 * ICCID is 19-20 cijfers, begint meestal met 89.
 * Optioneel: Luhn validatie (laatste cijfer is check digit, vaak niet gebruikt door providers).
 */
export function isValidIccid(input: string): boolean {
  const iccid = normalizeIccid(input);
  return /^89\d{17,18}$/.test(iccid);
}

// ============================================================
// VIN validatie
// ============================================================

const VIN_FORBIDDEN = /[IOQ]/;

export function isValidVin(input: string): boolean {
  const vin = normalizeVin(input);
  if (vin.length !== 17) return false;
  if (VIN_FORBIDDEN.test(vin)) return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

// ============================================================
// Geldigheid checks (zonder normalisatie, voor forms)
// ============================================================

export function validateEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export function validatePhone(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function validatePostalCode(input: string, country = "NL"): boolean {
  const pc = input.trim();
  if (country === "NL") {
    return /^\d{4}\s?[A-Za-z]{2}$/.test(pc);
  }
  return pc.length >= 3 && pc.length <= 12;
}

export function validateKvkNr(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  return /^\d{8}$/.test(digits);
}

export function validateBtwNr(input: string): boolean {
  const normalized = input.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Za-z0-9]{2,14}$/.test(normalized);
}

// ============================================================
// Datum validatie
// ============================================================

export function isValidDateRange(
  startAt: Date,
  endAt: Date | null | undefined
): boolean {
  if (!endAt) return true;
  return endAt.getTime() > startAt.getTime();
}
