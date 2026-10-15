-- AlterEnum: SyncFrequency — uitbreiden met sub-per-uur intervallen
ALTER TYPE "SyncFrequency" ADD VALUE IF NOT EXISTS 'EVERY_15_MINUTES';
ALTER TYPE "SyncFrequency" ADD VALUE IF NOT EXISTS 'EVERY_30_MINUTES';

-- AlterEnum: AlertThresholdLevel — meerdere drempelwaardes
ALTER TYPE "AlertThresholdLevel" ADD VALUE IF NOT EXISTS 'WARNING_70';
ALTER TYPE "AlertThresholdLevel" ADD VALUE IF NOT EXISTS 'WARNING_90';
ALTER TYPE "AlertThresholdLevel" ADD VALUE IF NOT EXISTS 'CRITICAL_100';

-- Gebruikersinstellingen: per-gebruiker drempel-niveaus (multi) en controle-interval
ALTER TABLE "user_notification_settings"
  ADD COLUMN IF NOT EXISTS "thresholdLevels" "AlertThresholdLevel"[] NOT NULL DEFAULT ARRAY[]::"AlertThresholdLevel"[];

ALTER TABLE "user_notification_settings"
  ADD COLUMN IF NOT EXISTS "usageAlertCheckIntervalMinutes" INTEGER NOT NULL DEFAULT 60;

-- Standaard NOT NULL default opnemen voor dataThresholdPercent (100% toegestaan)
ALTER TABLE "user_notification_settings"
  ALTER COLUMN "dataThresholdPercent" SET DEFAULT 80;

-- LET OP: de backfill van "thresholdLevels" staat bewust in de losse vervolg-migratie
-- 20261006120001_backfill_threshold_levels. PostgreSQL staat het niet toe om een zojuist
-- toegevoegde enum-waarde in dezelfde transactie te gebruiken ("unsafe use of new value"),
-- en Prisma draait elke migratie in één transactie.
