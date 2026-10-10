-- =========================================================================
-- Migratie: DataPlannen + Sim-only ondersteuning
-- Aangemaakt: 2026-10-10
-- Omschrijving: Nieuw DataPlan entiteit, ActivationOrderProductType enum,
--   FKs voor SIM / ActivationOrder / Subscription (SIM,
--   en ondersteuning orderType en dataPlanSnapshot op ActivationOrder.
-- Alle wijzigingen zijn backwards compatible (default waarden en nullable FKs).
-- =========================================================================

-- -------------------------
-- 1. Nieuwe ENUM types
-- -------------------------
DO $$ BEGIN
    CREATE TYPE "ActivationOrderProductType" AS ENUM ('TRACKER_WITH_SIM', 'SIM_ONLY_DATA');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "DataUnit" AS ENUM ('MB', 'GB', 'TB', 'UNLIMITED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------
-- 2. Nieuwe tabel: data_plans
-- -------------------------
CREATE TABLE IF NOT EXISTS "data_plans" (
    "id"                    TEXT                NOT NULL,
    "name"                  TEXT                NOT NULL,
    "description"           TEXT,
    "dataAmountBytes"       BIGINT,
    "dataAmountDisplayUnit" "DataUnit",
    "validityDays"          INTEGER,
    "validityBillingCycle"  "BillingCycle",
    "monthlyPrice"          DECIMAL(10, 2),
    "currency"              VARCHAR(3)          NOT NULL DEFAULT 'EUR',
    "btwPercentage"         DECIMAL(4, 2)    DEFAULT 21,
    "provider"              VARCHAR(150),
    "providerPlanRef"       VARCHAR(200),
    "providerOfferRef"      VARCHAR(200),
    "isActive"              BOOLEAN             NOT NULL DEFAULT TRUE,
    "simOnlyAvailable"      BOOLEAN             NOT NULL DEFAULT TRUE,
    "createdAt"             TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_plans_pkey" PRIMARY KEY ("id")
);

-- Unique key: naam + provider combinatie (soft unique binnen 2
CREATE UNIQUE INDEX IF NOT EXISTS "data_plans_name_provider_key"
    ON "data_plans"("name", "provider");

CREATE INDEX IF NOT EXISTS "data_plans_isActive_idx" ON "data_plans"("isActive");
CREATE INDEX IF NOT EXISTS "data_plans_simOnlyAvailable_idx" ON "data_plans"("simOnlyAvailable");
CREATE INDEX IF NOT EXISTS "data_plans_provider_idx" ON "data_plans"("provider");

-- -------------------------
-- 3. Uitbreiding: activation_orders
-- -------------------------
ALTER TABLE "activation_orders"
    ADD COLUMN IF NOT EXISTS "dataPlanId" TEXT;

ALTER TABLE "activation_orders"
    ADD COLUMN IF NOT EXISTS "orderType" "ActivationOrderProductType"
        NOT NULL DEFAULT 'TRACKER_WITH_SIM'::"ActivationOrderProductType";

ALTER TABLE "activation_orders"
    ADD COLUMN IF NOT EXISTS "dataPlanSnapshot" JSONB;

CREATE INDEX IF NOT EXISTS "activation_orders_dataPlanId_idx" ON "activation_orders"("dataPlanId");
CREATE INDEX IF NOT EXISTS "activation_orders_orderType_idx" ON "activation_orders"("orderType");

DO $$ BEGIN
    ALTER TABLE "activation_orders"
        ADD CONSTRAINT "activation_orders_dataPlanId_fkey"
        FOREIGN KEY ("dataPlanId") REFERENCES "data_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------
-- 4. Uitbreiding: subscriptions
-- -------------------------
ALTER TABLE "subscriptions"
    ADD COLUMN IF NOT EXISTS "dataPlanId" TEXT;

CREATE INDEX IF NOT EXISTS "subscriptions_dataPlanId_idx" ON "subscriptions"("dataPlanId");

DO $$ BEGIN
    ALTER TABLE "subscriptions"
        ADD CONSTRAINT "subscriptions_dataPlanId_fkey"
        FOREIGN KEY ("dataPlanId") REFERENCES "data_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------
-- 5. Uitbreiding: sims
-- -------------------------
ALTER TABLE "sims"
    ADD COLUMN IF NOT EXISTS "dataPlanId" TEXT;

CREATE INDEX IF NOT EXISTS "sims_dataPlanId_idx" ON "sims"("dataPlanId");

DO $$ BEGIN
    ALTER TABLE "sims"
        ADD CONSTRAINT "sims_dataPlanId_fkey"
        FOREIGN KEY ("dataPlanId") REFERENCES "data_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
