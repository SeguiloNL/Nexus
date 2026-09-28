-- Add eSIM/EID, Subscriber ID, SIM Name/Group/Product fields to sims table
-- (Keep columns nullable + safe IF NOT EXISTS via DO block for Postgres)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sims' AND column_name = 'eid') THEN
    ALTER TABLE "sims" ADD COLUMN "eid" VARCHAR(40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sims' AND column_name = 'subscriberId') THEN
    ALTER TABLE "sims" ADD COLUMN "subscriberId" VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sims' AND column_name = 'simName') THEN
    ALTER TABLE "sims" ADD COLUMN "simName" VARCHAR(200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sims' AND column_name = 'simGroup') THEN
    ALTER TABLE "sims" ADD COLUMN "simGroup" VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sims' AND column_name = 'product') THEN
    ALTER TABLE "sims" ADD COLUMN "product" VARCHAR(200);
  END IF;
END$$;

-- Unique indexes on new columns (where applicable)
CREATE UNIQUE INDEX IF NOT EXISTS "sims_eid_key" ON "sims" ("eid") WHERE "eid" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sims_subscriberId_idx" ON "sims" ("subscriberId");
CREATE INDEX IF NOT EXISTS "sims_simGroup_idx" ON "sims" ("simGroup");
