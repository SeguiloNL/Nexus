-- ============================================================
-- NEXUS — Wis ALLE klant-/product-/activatie-data
--         (BEWAART: rollen, gebruikers, sync-configs, app-settings)
--
-- Let op! Dit script WIST:
--   🗑️ ALLE customers (inclusief echte, niet alleen demo!)
--   🗑️ ALLE subscriptions, products, invoices
--   🗑️ ALLE trackers, sims, vehicles
--   🗑️ ALLE tracker_assignments, sim_assignments
--   🗑️ ALLE activation_orders
--   🗑️ user_customers junction (gebruikers zelf BLIJVEN!)
--   🗑️ audit_logs van bovengenoemde entiteiten
--
-- BEWAART (ALTijd, ongemoeid):
--   🔒 roles + role_permissions (ADMIN, EMPLOYEE, VIEWER, CUSTOMER_*)
--   🔒 users (hele users tabel — admin, medewerkers, etc.)
--   🔒 sync_job_configs + sync_job_runs
--   🔒 app_settings
--
-- Als je ALLÉÉN demo-data wilt wissen (GEEN echte klanten!),
-- verwijder dan de "-- DEMO-ONLY" comments en laat de WHERE-
-- clauses staan (criterium: "remove_only_demo = true").
-- ============================================================

BEGIN;

SET client_min_messages = NOTICE;

-- =============================================================
-- 🔧 CONFIGURATIE
-- -------------------------------------------------------------
-- Zet op true om ALLEEN seed-demo-data te wissen
-- (op basis van bekende identifiers uit prisma/seed.mjs).
-- Zet op false om ALLE klant/product/activatie-data te WISSEN.
-- =============================================================
\set remove_only_demo false

-- =============================================================
-- STAP 0 — Preview counts
-- =============================================================
DO $$
DECLARE
  v_cust bigint; v_prod bigint; v_sub bigint; v_inv bigint;
  v_trk  bigint; v_sim  bigint; v_veh bigint; v_ord bigint;
  v_ta   bigint; v_sa   bigint; v_uc  bigint; v_al  bigint;
BEGIN
  IF :'remove_only_demo' = 'true' THEN
    SELECT count(*) INTO v_cust FROM "customers"
     WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003')
        OR "email" LIKE '%.test' OR "notes" LIKE '%demo%';
    SELECT count(*) INTO v_prod FROM "products"
     WHERE "productCode" IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM');
    SELECT count(*) INTO v_veh  FROM "vehicles"
     WHERE "licensePlate" IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR');
    SELECT count(*) INTO v_trk  FROM "trackers"
     WHERE "serialNumber" LIKE 'TRK-0000_-ST';
    SELECT count(*) INTO v_sim  FROM "sims"
     WHERE "iccid" BETWEEN '8931041012345678901' AND '8931041012345678905';
    SELECT count(*) INTO v_sub  FROM "subscriptions"
     WHERE "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002');
    SELECT count(*) INTO v_ord  FROM "activation_orders"
     WHERE "orderNumber" = 'ACT-2025-000001';
  ELSE
    SELECT count(*) INTO v_cust FROM "customers";
    SELECT count(*) INTO v_prod FROM "products";
    SELECT count(*) INTO v_veh  FROM "vehicles";
    SELECT count(*) INTO v_trk  FROM "trackers";
    SELECT count(*) INTO v_sim  FROM "sims";
    SELECT count(*) INTO v_sub  FROM "subscriptions";
    SELECT count(*) INTO v_ord  FROM "activation_orders";
  END IF;
  SELECT count(*) INTO v_inv FROM "invoices"
    WHERE (:'remove_only_demo' = 'false'
       OR "customerId" IN (SELECT id FROM "customers"
            WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003')));
  SELECT count(*) INTO v_ta  FROM "tracker_assignments";
  SELECT count(*) INTO v_sa  FROM "sim_assignments";
  SELECT count(*) INTO v_uc  FROM "user_customers"
    WHERE (:'remove_only_demo' = 'false'
       OR "customerId" IN (SELECT id FROM "customers"
            WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003')));
  RAISE NOTICE '============================================================';
  IF :'remove_only_demo' = 'true' THEN
    RAISE NOTICE '🧪 MODUS: alleen DEMO-DATA wissen (GEEN echte klanten!)';
  ELSE
    RAISE NOTICE '⚠️  MODUS: ALLE klant/product/activatie-data WISSEN';
  END IF;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'Te wissen: customers=%, products=%, subscriptions=%, invoices=%', v_cust,v_prod,v_sub,v_inv;
  RAISE NOTICE 'Te wissen: trackers=%, sims=%, vehicles=%, activation_orders=%', v_trk,v_sim,v_veh,v_ord;
  RAISE NOTICE 'Te wissen: tracker_assignments=%, sim_assignments=%, user_customers(junction)=%', v_ta,v_sa,v_uc;
  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'Wordt BEWAARD: users, roles, role_permissions, sync_job_*, app_settings';
  RAISE NOTICE '============================================================';
END $$;

-- =============================================================
-- Hulp-CTEs: bepaal welke IDs gewist worden op basis van modus
-- =============================================================
WITH params AS (SELECT :'remove_only_demo' = 'true' AS demo_only)

-- ---- audit_logs (geen restricties, dus eerst) ----
DELETE FROM "audit_logs"
 WHERE (SELECT demo_only FROM params) = false
   AND "entityType" IN (
     'Customer','Subscription','Product','ActivationOrder',
     'Tracker','SIM','Vehicle','Invoice'
   )
    OR (
      (SELECT demo_only FROM params) = true
      AND "entityType" IN (
        'Customer','Subscription','Product','ActivationOrder',
        'Tracker','SIM','Vehicle','Invoice'
      )
      AND (
        "entityId" IN (SELECT id FROM "customers"
          WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003')
             OR "email" LIKE '%.test' OR "notes" LIKE '%demo%')
        OR
        "entityId" IN (SELECT id FROM "products"
          WHERE "productCode" IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'))
      )
    );

-- ---- tracker_assignments (subscription/tracker/vehicle zijn restrict) ----
DELETE FROM "tracker_assignments"
 WHERE (SELECT demo_only FROM params) = false
    OR "subscriptionId" IN (SELECT id FROM "subscriptions"
        WHERE "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002'))
    OR "trackerId" IN (SELECT id FROM "trackers"
        WHERE "serialNumber" LIKE 'TRK-0000_-ST')
    OR "vehicleId" IN (SELECT id FROM "vehicles"
        WHERE "licensePlate" IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR'));

-- ---- sim_assignments ----
DELETE FROM "sim_assignments"
 WHERE (SELECT demo_only FROM params) = false
    OR "subscriptionId" IN (SELECT id FROM "subscriptions"
        WHERE "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002'))
    OR "simId" IN (SELECT id FROM "sims"
        WHERE "iccid" BETWEEN '8931041012345678901' AND '8931041012345678905');

-- ---- activation_orders ----
DELETE FROM "activation_orders"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerId" IN (SELECT id FROM "customers"
        WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR "productId"  IN (SELECT id FROM "products"
        WHERE "productCode" IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'))
    OR "subscriptionId" IN (SELECT id FROM "subscriptions"
        WHERE "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002'));

-- ---- invoices ----
DELETE FROM "invoices"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerId" IN (SELECT id FROM "customers"
        WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR "subscriptionId" IN (SELECT id FROM "subscriptions"
        WHERE "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002'));

-- ---- vehicles (customer = restrict) ----
DELETE FROM "vehicles"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerId" IN (SELECT id FROM "customers"
        WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR "licensePlate" IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR');

-- ---- subscriptions (customer/product = restrict) ----
DELETE FROM "subscriptions"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerId" IN (SELECT id FROM "customers"
        WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR "productId" IN (SELECT id FROM "products"
        WHERE "productCode" IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'))
    OR "subscriptionNumber" IN ('SUB-2025-000001','SUB-2025-000002');

-- ---- user_customers JUNCTION TABEL (users blijven! Alleen koppelingen wissen) ----
DELETE FROM "user_customers"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerId" IN (SELECT id FROM "customers"
        WHERE "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003'));

-- ---- trackers, sims, products (geen restrict-children meer) ----
DELETE FROM "trackers"
 WHERE (SELECT demo_only FROM params) = false
    OR "serialNumber" LIKE 'TRK-0000_-ST';

DELETE FROM "sims"
 WHERE (SELECT demo_only FROM params) = false
    OR "iccid" BETWEEN '8931041012345678901' AND '8931041012345678905';

DELETE FROM "products"
 WHERE (SELECT demo_only FROM params) = false
    OR "productCode" IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM');

-- ---- customers (laatste want alles was hiernaar FK heeft is al weg) ----
DELETE FROM "customers"
 WHERE (SELECT demo_only FROM params) = false
    OR "customerNumber" IN ('C-2025-0001','C-2025-0002','C-2025-0003')
    OR "email" LIKE '%.test'
    OR "notes" LIKE 'Seed demo%'
    OR "notes" LIKE '%demo%';

COMMIT;

DO $$ BEGIN RAISE NOTICE '============================================================'; END $$;
DO $$ BEGIN RAISE NOTICE '✅ Klaar! (COMMIT)'; END $$;
DO $$ BEGIN RAISE NOTICE '============================================================'; END $$;
DO $$ BEGIN RAISE NOTICE 'Bewaard (ongewijzigd):'; END $$;
DO $$ BEGIN RAISE NOTICE '  • users (admin, medewerkers, klant-gebruikers blijven bestaan)'; END $$;
DO $$ BEGIN RAISE NOTICE '  • roles + role_permissions'; END $$;
DO $$ BEGIN RAISE NOTICE '  • sync_job_configs + sync_job_runs'; END $$;
DO $$ BEGIN RAISE NOTICE '  • app_settings'; END $$;
