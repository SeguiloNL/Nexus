-- =========================================================================
-- Migratie: DataPlan productkoppeling + targeting + vervaldatum
-- Aangemaakt: 2026-10-16
-- Omschrijving: Koppelt elk dataplan optioneel (1-op-1) aan een factureerbaar
--   Product (bron voor het Inserve-artikel), voegt targeting toe op regio en
--   klanttype, en een optionele vervaldatum. Alle wijzigingen zijn backwards
--   compatible (nullable kolommen en lege-array defaults).
-- =========================================================================

-- -------------------------
-- 1. Nieuwe kolommen op data_plans
-- -------------------------
ALTER TABLE "data_plans"
    ADD COLUMN IF NOT EXISTS "productId" TEXT;

-- Array default: leeg = beschikbaar voor alle regio's
ALTER TABLE "data_plans"
    ADD COLUMN IF NOT EXISTS "targetRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Array default: leeg = beschikbaar voor alle klanttypes
ALTER TABLE "data_plans"
    ADD COLUMN IF NOT EXISTS "targetCustomerTypes" "CustomerType"[] NOT NULL DEFAULT ARRAY[]::"CustomerType"[];

-- Optionele vervaldatum: NULL = geen vervaldatum
ALTER TABLE "data_plans"
    ADD COLUMN IF NOT EXISTS "availableUntil" TIMESTAMPTZ(3);

-- -------------------------
-- 2. Indexen
-- -------------------------
-- Uniek: één product kan maar aan één dataplan gekoppeld zijn (1-op-1).
CREATE UNIQUE INDEX IF NOT EXISTS "data_plans_productId_key"
    ON "data_plans"("productId");

CREATE INDEX IF NOT EXISTS "data_plans_availableUntil_idx"
    ON "data_plans"("availableUntil");

-- -------------------------
-- 3. Foreign key naar products
-- -------------------------
DO $$ BEGIN
    ALTER TABLE "data_plans"
        ADD CONSTRAINT "data_plans_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "products"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
