import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

type TxLike = Prisma.TransactionClient | typeof prisma;

export const INVALID_IDENTIFIER_PLACEHOLDERS: ReadonlySet<string> = new Set([
  '0', '000000000000000', '0000000000000000000',
  'n/a', 'na', 'none', 'null', 'undefined', 'onbekend', 'geen',
  'placeholder', 'test', 'dummy', 'invalid', 'ongeldig',
  '123456789', '0000000000', '00000000000000000000',
  '-', '--', '---', '?', '??', '#', '*',
  'abcdef', 'abcd', 'test123', 'tester',
  'xxxxxxxx', 'xxxxxx', 'aaaaaaaa',
]);

function stripAccents(v: string): string {
  try {
    return v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return v;
  }
}

export function isPlaceholderIdentifier(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  let s: string;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'string') s = v;
  else return true;
  const trimmed = s.trim();
  if (trimmed.length === 0) return true;
  const norm = stripAccents(trimmed).toLowerCase();
  if (INVALID_IDENTIFIER_PLACEHOLDERS.has(norm)) return true;
  const onlyDups = /^(.)\1+$/.test(trimmed);
  if (onlyDups && trimmed.length <= 20) return true;
  const nonAlpha = trimmed.replace(/[0-9a-zA-Z]/g, '');
  if (nonAlpha.length === trimmed.length) return true;
  return false;
}

export function normalizeIccid(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = String(v);
    if (s.includes('e') || s.includes('E')) return null;
  } else if (typeof v === 'string') {
    s = v;
  } else {
    return null;
  }
  let cleaned = s.replace(/[\s\-_.|,\/]/g, '').toUpperCase();
  cleaned = cleaned.replace(/^ICCID[:]/i, '');
  if (cleaned.length === 0) return null;
  if (isPlaceholderIdentifier(cleaned)) return null;
  if (cleaned.length > 40) cleaned = cleaned.slice(0, 40);
  if (cleaned.length < 10) return null;
  return cleaned;
}

export function normalizeImsi(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'string') s = v;
  else return null;
  const cleaned = s.replace(/[\s\-_|,]/g, '').toUpperCase();
  if (cleaned.length === 0) return null;
  if (isPlaceholderIdentifier(cleaned)) return null;
  if (cleaned.length > 20) return null;
  if (!/^\d{10,20}$/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeEid(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'string') s = v;
  else return null;
  let cleaned = s.replace(/[\s\-_|,]/g, '').toUpperCase();
  cleaned = cleaned.replace(/^EID[:]/i, '');
  if (cleaned.length === 0) return null;
  if (isPlaceholderIdentifier(cleaned)) return null;
  if (cleaned.length > 40) cleaned = cleaned.slice(0, 40);
  if (cleaned.length < 10) return null;
  return cleaned;
}

export function normalizeMsisdn(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'string') s = v;
  else return null;
  let cleaned = s.replace(/[\s\-+()|\.\/]/g, '');
  if (cleaned.length === 0) return null;
  if (isPlaceholderIdentifier(cleaned)) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  if (cleaned.length < 6) return null;
  if (cleaned.length > 15) return null;
  return cleaned;
}

export function maskIccid(iccid: string | null | undefined): string {
  if (!iccid) return '***';
  if (iccid.length <= 8) return '*'.repeat(iccid.length);
  return `${iccid.slice(0, 4)}…${iccid.slice(-4)}`;
}

/**
 * Genereert een klantnummer in het formaat K-YYYY-NNNNN
 */
export async function generateCustomerNumber(tx: TxLike = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `K-${year}-`;

  const latest = await tx.customer.findFirst({
    where: { customerNumber: { startsWith: prefix } },
    orderBy: { customerNumber: "desc" },
    select: { customerNumber: true },
  });

  let next = 1;
  if (latest?.customerNumber) {
    const suffix = latest.customerNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(5, "0")}`;
}

/**
 * Genereert een abonnementnummer in het formaat SUB-YYYY-NNNNNN
 */
export async function generateSubscriptionNumber(tx: TxLike = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SUB-${year}-`;

  const latest = await tx.subscription.findFirst({
    where: { subscriptionNumber: { startsWith: prefix } },
    orderBy: { subscriptionNumber: "desc" },
    select: { subscriptionNumber: true },
  });

  let next = 1;
  if (latest?.subscriptionNumber) {
    const suffix = latest.subscriptionNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(6, "0")}`;
}

/**
 * Genereert een activatie-ordernummer in het formaat ACT-YYYY-NNNNNN
 */
export async function generateOrderNumber(tx: TxLike = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ACT-${year}-`;

  const latest = await tx.activationOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let next = 1;
  if (latest?.orderNumber) {
    const suffix = latest.orderNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(6, "0")}`;
}

/**
 * Genereert een factuurnummer in het formaat FAC-YYYY-NNNNNN
 */
export async function generateInvoiceNumber(tx: TxLike = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;

  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  let next = 1;
  if (latest?.invoiceNumber) {
    const suffix = latest.invoiceNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(6, "0")}`;
}
