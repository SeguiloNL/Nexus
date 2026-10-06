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

-- Backfill: zet thresholdLevels op basis van legacy dataThresholdPercent (indien aanwezig)
-- 70% -> WARNING_70, 80% -> WARNING_80, 90% -> WARNING_90, >=100% -> CRITICAL_100
UPDATE "user_notification_settings"
SET "thresholdLevels" = CASE
    WHEN "dataThresholdPercent" >= 100 THEN ARRAY['CRITICAL_100'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 90  THEN ARRAY['WARNING_90'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 80  THEN ARRAY['WARNING_80'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 70  THEN ARRAY['WARNING_70'::"AlertThresholdLevel"]
    ELSE ARRAY['WARNING_80'::"AlertThresholdLevel"]
END
WHERE "thresholdLevels" = ARRAY[]::"AlertThresholdLevel"[];

-- Standaard NOT NULL default opnemen voor dataThresholdPercent (100% toegestaan)
ALTER TABLE "user_notification_settings"
  ALTER COLUMN "dataThresholdPercent" SET DEFAULT 80;
