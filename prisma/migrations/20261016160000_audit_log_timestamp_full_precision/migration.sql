-- =========================================================================
-- Migratie: Volledige timestamp op audit_logs
-- Aangemaakt: 2026-10-16
-- Omschrijving: Borgt dat audit_logs.timestamp altijd een VOLLEDIGE datum+tijd
--   (uur, minuut, seconde, milliseconden) mét tijdzone opslaat in plaats van
--   alleen een datum. De kolom is tijdzone-bewust (TIMESTAMPTZ), zodat de
--   opgeslagen waarde altijd naar ISO 8601 met tijdzone (UTC) te herleiden is
--   en er geen sprake is van tijd-data-vervuiling.
--   Daarnaast worden bestaande rijen genormaliseerd zodat ook historische
--   entries een consistente timestamp-structuur hebben.
-- Backwards compatible: bestaande waarden blijven hetzelfde tijdstip houden.
-- =========================================================================

-- -------------------------
-- 1. Borg volledige tijdsresolutie (milliseconden) + tijdzone.
-- -------------------------
-- TIMESTAMPTZ bewaart het absolute tijdstip (UTC) inclusief tijdzone; de
-- precisie (3) legt datum + tijd vast tot op de milliseconde.
ALTER TABLE "audit_logs"
    ALTER COLUMN "timestamp" TYPE TIMESTAMPTZ(3),
    ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "timestamp" SET NOT NULL;

-- -------------------------
-- 2. Normaliseer bestaande rijen: geef elke entry een consistente ISO 8601
--    (UTC) timestamp in de metadata, afgeleid van het opgeslagen tijdstip.
-- -------------------------
UPDATE "audit_logs"
SET "metadata" =
        COALESCE("metadata"::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'timestamp',
             to_char(
                 "timestamp" AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
WHERE "metadata" IS NULL
   OR NOT ("metadata"::jsonb ? 'timestamp');

-- -------------------------
-- 3. Documenteer de kolom semantiek.
-- -------------------------
COMMENT ON COLUMN "audit_logs"."timestamp"
    IS 'Volledige datum+tijd (ISO 8601, tijdzone-bewust) van de audit-gebeurtenis.';
