-- 20260917001000_add_inserve_invoice_sync_fields
-- InserveSyncStatus enum BESTOND AL (voor subscriptions). Geen CREATE TYPE nodig.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "inserveInvoiceId" INTEGER;
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_inserveInvoiceId_unique" UNIQUE ("inserveInvoiceId");

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "inserveSyncStatus" "InserveSyncStatus" NOT NULL DEFAULT 'PENDING'::"InserveSyncStatus";

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "inserveSyncError" TEXT;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "sentToInserveAt" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "invoices_inserveSyncStatus_idx" ON "invoices" ("inserveSyncStatus");
CREATE INDEX IF NOT EXISTS "invoices_sentToInserveAt_idx" ON "invoices" ("sentToInserveAt");
