-- =========================================================================
-- Migratie: Historisch dataverbruik per SIM per maand
-- Aangemaakt: 2026-10-16
-- Omschrijving: Nieuwe tabel sim_monthly_usage voor het bewaren van het
--   dataverbruik per SIM per maand, zodat het dashboard de afgelopen 12
--   maanden kan vergelijken. Wordt gevuld tijdens de usage-sync met een
--   monotone max-guard per (simId, monthKey). Backwards compatible:
--   nieuwe tabel, geen wijzigingen aan bestaande kolommen.
-- =========================================================================

-- -------------------------
-- 1. Nieuwe tabel: sim_monthly_usage
-- -------------------------
CREATE TABLE IF NOT EXISTS "sim_monthly_usage" (
    "id"              TEXT            NOT NULL,
    "simId"           TEXT            NOT NULL,
    "iccid"           VARCHAR(40)     NOT NULL,
    "monthKey"        VARCHAR(7)      NOT NULL,
    "periodStart"     TIMESTAMPTZ,
    "periodEnd"       TIMESTAMPTZ,
    "dataUsedBytes"   BIGINT,
    "dataLimitBytes"  BIGINT,
    "smsUsedCount"    INTEGER,
    "usageSource"     VARCHAR(30),
    "firstCapturedAt" TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCapturedAt"  TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinal"         BOOLEAN         NOT NULL DEFAULT FALSE,
    "createdAt"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_monthly_usage_pkey" PRIMARY KEY ("id")
);

-- -------------------------
-- 2. Indexen
-- -------------------------
-- Eén rij per SIM per maand.
CREATE UNIQUE INDEX IF NOT EXISTS "sim_monthly_usage_simId_monthKey_key"
    ON "sim_monthly_usage"("simId", "monthKey");

CREATE INDEX IF NOT EXISTS "sim_monthly_usage_monthKey_idx"
    ON "sim_monthly_usage"("monthKey");

-- Ondersteunt top-N per maand.
CREATE INDEX IF NOT EXISTS "sim_monthly_usage_monthKey_dataUsedBytes_idx"
    ON "sim_monthly_usage"("monthKey", "dataUsedBytes" DESC);

-- -------------------------
-- 3. Foreign key naar sims
-- -------------------------
DO $$ BEGIN
    ALTER TABLE "sim_monthly_usage"
        ADD CONSTRAINT "sim_monthly_usage_simId_fkey"
        FOREIGN KEY ("simId") REFERENCES "sims"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
