-- Reseller & Partner scopes uitbreiding
-- 1. RoleScope enum uitbreiden met RESELLER en PARTNER (bestaande enum: INTERNAL, CUSTOMER)
-- 2. Nieuwe CustomerType enum aanmaken (DIRECT / RESELLER / PARTNER)
-- 3. Customer.type kolom toevoegen + index
-- 4. Subscription.billingCustomerId kolom toevoegen + FK + index
-- ---------------------------------------------------------------------------
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RoleScope uitbreiden (indien Postgres < 12 gebruik een aparte transactie per VALUE)
-- ---------------------------------------------------------------------------
ALTER TYPE "RoleScope" ADD VALUE IF NOT EXISTS 'RESELLER';
ALTER TYPE "RoleScope" ADD VALUE IF NOT EXISTS 'PARTNER';

-- ---------------------------------------------------------------------------
-- 2. CustomerType enum (nieuw)
-- ---------------------------------------------------------------------------
CREATE TYPE "CustomerType" AS ENUM ('DIRECT', 'RESELLER', 'PARTNER');

-- ---------------------------------------------------------------------------
-- 3. Customer.type kolom + index
-- ---------------------------------------------------------------------------
ALTER TABLE "customers"
  ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'DIRECT';

CREATE INDEX "customers_type_idx" ON "customers"("type");

-- ---------------------------------------------------------------------------
-- 4. Subscription.billingCustomerId kolom + FK + index
-- ---------------------------------------------------------------------------
ALTER TABLE "subscriptions"
  ADD COLUMN "billingCustomerId" text;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_billingCustomerId_fkey"
  FOREIGN KEY ("billingCustomerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "subscriptions_billingCustomerId_idx" ON "subscriptions"("billingCustomerId");

COMMIT;
