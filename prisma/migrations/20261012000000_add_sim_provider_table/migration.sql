-- Modulair leverancierssysteem: SimProvider tabel, generieke AuditActies, en SIM.providerKey kolom
-- Migration: 20261012000000_add_sim_provider_table

-- ============================================================
-- 1. Nieuwe generieke AuditAction waardes (toegevoegd, oude blijven bestaan)
--    PG14+: ALTER TYPE ADD VALUE IF NOT EXISTS is veilig herhaalbaar
-- ============================================================
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_SYNCED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_SYNC_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_UNSUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_PURGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SIM_SUBSCRIBED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROVIDER_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROVIDER_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROVIDER_CONNECTION_TESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROVIDER_SETTINGS_UPDATED';

-- ============================================================
-- 2. Nieuwe sim_providers tabel
-- ============================================================
CREATE TABLE "sim_providers" (
    "providerKey"             VARCHAR(50)  NOT NULL,
    "displayName"             VARCHAR(200) NOT NULL,
    "moduleAvailable"         BOOLEAN      NOT NULL DEFAULT true,
    "active"                  BOOLEAN      NOT NULL DEFAULT false,
    "lastConnectionOk"        BOOLEAN,
    "lastConnectionCheckedAt" TIMESTAMPTZ,
    "lastConnectionLatencyMs" INTEGER,
    "lastConnectionErrorSafe" VARCHAR(500),
    "createdAt"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_providers_pkey" PRIMARY KEY ("providerKey")
);

-- ============================================================
-- 3. Nieuwe kolom providerKey + FK op sims tabel
-- ============================================================
ALTER TABLE "sims" ADD COLUMN "providerKey" VARCHAR(50);

ALTER TABLE "sims"
    ADD CONSTRAINT "sims_providerKey_fkey"
    FOREIGN KEY ("providerKey")
    REFERENCES "sim_providers"("providerKey")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- ============================================================
-- 4. Indexen voor lookup-optimalisatie
-- ============================================================
CREATE INDEX "sims_providerKey_idx"          ON "sims"("providerKey");
CREATE INDEX "sims_providerKey_subscriberId_idx"
    ON "sims"("providerKey", "subscriberId");

-- ============================================================
-- 5. Idempotente seed / backfill:
--    a) Registreer Simhuis reeds als actieve provider (backward compat)
--    b) Wijs alle bestaande sims zonder providerKey toe aan Simhuis
--       wanneer hun legacy provider-veld Simhuis is, of leeg/null.
-- ============================================================
INSERT INTO "sim_providers"
    ("providerKey", "displayName", "moduleAvailable", "active")
VALUES
    ('simhuis',   'Simhuis',   true, true)
ON CONFLICT ("providerKey") DO NOTHING;

UPDATE "sims"
SET    "providerKey" = 'simhuis'
WHERE  "providerKey" IS NULL
  AND  (
      LOWER(COALESCE(provider, '')) LIKE '%simhuis%'
      OR COALESCE(provider, '') = ''
  );
