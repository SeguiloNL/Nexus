-- 20260917000000_augment_invoices_and_audit_actions
-- (1) AuditAction: voeg GENERATE_INVOICES, MARK_INVOICE_PAID, SEND_INVOICE toe (Prisma schema AuditAction enum uitgebreid)
-- (2) Invoice: voeg sentAt timestamptz kolom toe (H.4d)

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GENERATE_INVOICES';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MARK_INVOICE_PAID';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SEND_INVOICE';

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS "invoices_sentAt_idx" ON "invoices" ("sentAt");
