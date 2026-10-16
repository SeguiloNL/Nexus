-- Trajectgeschiktheid per product: bepaalt in welk(e) activatie-traject(en) een
-- product gekozen mag worden ("Beide trajecten", "Alleen Sim-only datasimkaart"
-- of "Alleen Nieuwe tracker met simkaart"). Verplicht veld met beperkte waarden.
--
-- Bestaande producten krijgen 'BOTH', zodat ze na de update ongewijzigd in beide
-- trajecten zichtbaar blijven.

CREATE TYPE "ProductTrack" AS ENUM ('BOTH', 'SIM_ONLY', 'TRACKER');

ALTER TABLE "products"
  ADD COLUMN "track" "ProductTrack" NOT NULL DEFAULT 'BOTH';
