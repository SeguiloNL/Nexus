-- ============================================================
-- NEXUS — Verwijder ALLE demo-data (aangemaakt door prisma seed)
--
-- Verwijdert:
--   ✅ Demo-klanten (Van der Transport, KPN M2M, Bakkerij de Vries)
--   ✅ Demo-producten (TRK-BASIC, TRK-PRO, TRK-PREMIUM)
--   ✅ Demo-voertuigen (AB-01-CD, EF-23-GH, KP-01-NL, BV-02-DR)
--   ✅ Demo-trackers (TRK-00001-ST t/m TRK-00005-ST)
--   ✅ Demo-SIMs    (ICCID 8931041012345678901..05)
--   ✅ Demo-abonnementen (SUB-2025-000001, SUB-2025-000002)
--   ✅ Demo-activatie-orders (ACT-2025-000001)
--   ✅ Demo-gebruikers (medewerker / viewer / *@vandertransport.test)
--   ✅ Bijbehorende assignments, invoices, audit logs (van demo entiteiten)
--
-- BEWAART (productie-kritisch):
--   🔒 Rollen (ADMIN, EMPLOYEE, VIEWER, CUSTOMER_*) + permissies
--   🔒 Admin gebruiker (admin@nexus.local)
--   🔒 SyncJobConfig (3 standaard sync-schedules)
--   🔒 AppSetting
--   🔒 SyncJobRun geschiedenis (kan apart worden geleegd)
--
-- Gebruik:
--   Lokaal:
--     npx prisma db execute --file prisma/purge-demo-data.sql
--   Op VPS (in /opt/stm):
--     sudo docker cp prisma/purge-demo-data.sql stm-db:/tmp/purge.sql
--     sudo docker exec -it stm-db psql -U stm -d stm -f /tmp/purge.sql
--   — of direct in psql met \i prisma/purge-demo-data.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STAP 0 — Overzicht (counts) wat er weg gaat.
-- Pas de criteria hieronder aan als je meer/minder wilt wissen.
-- ------------------------------------------------------------

\echo '------------------------------------------------------'
\echo 'STAP 0/8 — Counts VANAF-HIER (VOOR de purge)'
\echo '------------------------------------------------------'

WITH demo_customers AS (
  SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003')
),
demo_products AS (
  SELECT id FROM products WHERE productCode IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM')
),
demo_trackers AS (
  SELECT id FROM trackers WHERE serialNumber LIKE 'TRK-0000_-ST'
),
demo_sims AS (
  SELECT id FROM sims WHERE iccid BETWEEN '8931041012345678901' AND '8931041012345678905'
),
demo_subs AS (
  SELECT id FROM subscriptions WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002')
),
demo_orders AS (
  SELECT id FROM activation_orders WHERE orderNumber = 'ACT-2025-000001'
),
demo_vehicles AS (
  SELECT id FROM vehicles WHERE licensePlate IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR')
),
demo_users AS (
  SELECT id FROM users WHERE email IN (
    'medewerker@nexus.local',
    'viewer@nexus.local',
    'klant-viewer@vandertransport.test',
    'klant-beheerder@vandertransport.test'
  )
)
SELECT
  (SELECT count(*) FROM demo_customers) AS "klanten",
  (SELECT count(*) FROM demo_products)  AS "producten",
  (SELECT count(*) FROM demo_vehicles)  AS "voertuigen",
  (SELECT count(*) FROM demo_trackers)  AS "trackers",
  (SELECT count(*) FROM demo_sims)      AS "sims",
  (SELECT count(*) FROM demo_subs)      AS "abonnementen",
  (SELECT count(*) FROM demo_orders)    AS "orders",
  (SELECT count(*) FROM demo_users)     AS "gebruikers";

-- ------------------------------------------------------------
-- STAP 1 — AuditLog (geen restricties, ruimt geschiedenis van
--          te-verwijderen entiteiten op). Doe dit eerst of
--          laat hem weg om geschiedenis te bewaren.
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 1/8 — AuditLogs van demo-entiteiten verwijderen...'
DELETE FROM audit_logs
 WHERE entityType IN (
   'Customer','Subscription','Product','ActivationOrder',
   'Tracker','SIM','Vehicle','Invoice','User'
 )
 AND (
   -- Audit logs van demo-klanten
   entityId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
   OR
   -- Audit logs van demo-producten
   entityId IN (SELECT id FROM products WHERE productCode IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'))
   OR
   -- Audit logs van demo-gebruikers
   userId IN (SELECT id FROM users WHERE email IN (
     'medewerker@nexus.local','viewer@nexus.local',
     'klant-viewer@vandertransport.test','klant-beheerder@vandertransport.test'
   ))
 );
GET DIAGNOSTICS audit_deleted = ROW_COUNT;
\echo '  -> verwijderd: ' audit_deleted

-- ------------------------------------------------------------
-- STAP 2 — Assignments (Tracker & SIM)
--          Subscription FK = RESTRICT  → eerst assignments voor die sub
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 2/8 — Tracker + SIM assignments van demo-subs verwijderen...'

DELETE FROM tracker_assignments
 WHERE subscriptionId IN (SELECT id FROM subscriptions WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002'))
    OR trackerId IN (SELECT id FROM trackers WHERE serialNumber LIKE 'TRK-0000_-ST')
    OR vehicleId IN (SELECT id FROM vehicles WHERE licensePlate IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR'));

DELETE FROM sim_assignments
 WHERE subscriptionId IN (SELECT id FROM subscriptions WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002'))
    OR simId IN (SELECT id FROM sims WHERE iccid BETWEEN '8931041012345678901' AND '8931041012345678905');

-- ------------------------------------------------------------
-- STAP 3 — ActivationOrders (FK Subscription=SetNull, Product=Restrict,
--          Customer=Restrict, Tracker=SetNull, Sim=SetNull, Vehicle=SetNull)
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 3/8 — ActivationOrders verwijderen...'
DELETE FROM activation_orders
 WHERE orderNumber = 'ACT-2025-000001'
    OR customerId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR productId IN (SELECT id FROM products WHERE productCode IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'))
    OR subscriptionId IN (SELECT id FROM subscriptions WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002'));

-- ------------------------------------------------------------
-- STAP 4 — Invoices (Subscription=Restrict, Customer=Restrict)
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 4/8 — Facturen van demo-klanten/subs verwijderen...'
DELETE FROM invoices
 WHERE customerId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR subscriptionId IN (SELECT id FROM subscriptions WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002'));

-- ------------------------------------------------------------
-- STAP 5 — Vehicles (Customer=Restrict)
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 5/8 — Demo-voertuigen verwijderen...'
DELETE FROM vehicles
 WHERE licensePlate IN ('AB-01-CD','EF-23-GH','KP-01-NL','BV-02-DR')
    OR customerId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'));

-- ------------------------------------------------------------
-- STAP 6 — Subscriptions (Customer=Restrict, Product=Restrict)
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 6/8 — Demo-abonnementen verwijderen...'
DELETE FROM subscriptions
 WHERE subscriptionNumber IN ('SUB-2025-000001','SUB-2025-000002')
    OR customerId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR productId IN (SELECT id FROM products WHERE productCode IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM'));

-- ------------------------------------------------------------
-- STAP 7 — Trackers, SIMs, Products, Users, Customers
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 7/8 — Trackers / SIMs / Producten / Gebruikers / Klanten verwijderen...'

DELETE FROM trackers WHERE serialNumber LIKE 'TRK-0000_-ST';

DELETE FROM sims WHERE iccid BETWEEN '8931041012345678901' AND '8931041012345678905';

DELETE FROM products WHERE productCode IN ('TRK-BASIC','TRK-PRO','TRK-PREMIUM');

-- Junction tabel users <-> customers (kan ook overleven tot Cascade delete)
DELETE FROM user_customers
 WHERE customerId IN (SELECT id FROM customers WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003'))
    OR userId IN (SELECT id FROM users WHERE email IN (
      'medewerker@nexus.local','viewer@nexus.local',
      'klant-viewer@vandertransport.test','klant-beheerder@vandertransport.test'
    ));

-- Demo users (LAAT ADMIN STAAN!)
DELETE FROM users
 WHERE email IN (
   'medewerker@nexus.local',
   'viewer@nexus.local',
   'klant-viewer@vandertransport.test',
   'klant-beheerder@vandertransport.test'
 );

-- Demo customers (LAAT NIET-DEMO STAAN! Als je alle echte data
-- ook wilt weghalen, verwijder dan de WHERE-clause).
DELETE FROM customers
 WHERE customerNumber IN ('C-2025-0001','C-2025-0002','C-2025-0003')
    OR email LIKE '%.test'
    OR notes LIKE 'Seed demo%'
    OR notes LIKE '%demo%';

-- ------------------------------------------------------------
-- STAP 8 — SyncJobRun (optioneel: bevat demo test-runs)
--          Zet -- commentaar weg als je hem ook wilt schonen.
-- ------------------------------------------------------------
\echo ''
\echo 'STAP 8/8 — SyncJobRun demo-geschiedenis WISSEN (optioneel, standaard OVERSLAAN)'
-- DELETE FROM sync_job_runs;

-- ------------------------------------------------------------
-- AFSLUITING — Optionele sequence-reset zodat IDs weer netjes
--              beginnen (zie prctl sequences).
-- ------------------------------------------------------------
\echo ''
\echo 'Optioneel — Reset sequences (handmatig draaien):'
\echo '  ALTER SEQUENCE IF EXISTS "customers_id_seq" RESTART;'
\echo '  ALTER SEQUENCE IF EXISTS "subscriptions_id_seq" RESTART;'
\echo '  ALTER SEQUENCE IF EXISTS "invoices_id_seq" RESTART;'

COMMIT;

\echo ''
\echo '==========================================================='
\echo '✅ Demo-data succesvol verwijderd (in transactie = COMMIT).'
\echo '==========================================================='
\echo 'Bewaard gebleven:'
\echo '  • Rollen (roles + role_permissions)'
\echo '  • Admin gebruiker (admin@nexus.local)'
\echo '  • SyncJobConfig + SyncJobRun geschiedenis'
\echo '  • AppSetting'
\echo ''
\echo 'Om ook NIET-demo data (helemaal lege DB) te wissen:'
\echo '  npx prisma migrate reset   -- of --'
\echo '  (pas de WHERE-clauses in dit script aan naar eigen criteria)'
\echo ''
