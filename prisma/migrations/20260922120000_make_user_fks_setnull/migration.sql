-- Maak user-gerelateerde foreign keys nullable met ON DELETE SET NULL
-- Zodat een gebruiker verwijderd kan worden zonder verlies van business data
-- (audit logs, assignments en activatie-orders blijven bewaard zonder dangling user reference)

-- -------------------------------------------------------------
-- 1. tracker_assignments.createdById -> users(id)
-- -------------------------------------------------------------
ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignments_createdById_fkey";
ALTER TABLE "tracker_assignments" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- 2. sim_assignments.createdById -> users(id)
-- -------------------------------------------------------------
ALTER TABLE "sim_assignments" DROP CONSTRAINT IF EXISTS "sim_assignments_createdById_fkey";
ALTER TABLE "sim_assignments" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "sim_assignments" ADD CONSTRAINT "sim_assignments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- 3. activation_orders.createdById -> users(id)
-- -------------------------------------------------------------
ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_createdById_fkey";
ALTER TABLE "activation_orders" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- 4. audit_logs.userId -> users(id)
-- -------------------------------------------------------------
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_userId_fkey";
ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
