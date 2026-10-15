-- Backfill: zet "thresholdLevels" op basis van legacy "dataThresholdPercent".
-- 70% -> WARNING_70, 80% -> WARNING_80, 90% -> WARNING_90, >=100% -> CRITICAL_100
--
-- Deze migratie staat bewust LOS van 20261006120000_add_multi_thresholds_and_check_interval:
-- PostgreSQL staat het niet toe om een nieuw toegevoegde enum-waarde in dezelfde transactie
-- te gebruiken ("unsafe use of new value"), en Prisma draait elke migratie in één transactie.
UPDATE "user_notification_settings"
SET "thresholdLevels" = CASE
    WHEN "dataThresholdPercent" >= 100 THEN ARRAY['CRITICAL_100'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 90  THEN ARRAY['WARNING_90'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 80  THEN ARRAY['WARNING_80'::"AlertThresholdLevel"]
    WHEN "dataThresholdPercent" >= 70  THEN ARRAY['WARNING_70'::"AlertThresholdLevel"]
    ELSE ARRAY['WARNING_80'::"AlertThresholdLevel"]
END
WHERE "thresholdLevels" = ARRAY[]::"AlertThresholdLevel"[];
