-- Initial migration for Nexus
-- Gegenereerd op basis van prisma/schema.prisma + aanvullende database-specifieke constraints
-- Volledige compatibiliteit: PostgreSQL 14+

-- -------------------------------------------------------------
-- ENUM TYPES
-- -------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EMPLOYEE', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'SUSPENDED', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('DRAFT', 'PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'TERMINATED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TrackerStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'ACTIVE', 'SUSPENDED', 'DEFECTIVE', 'RMA', 'RETIRED', 'LOST');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SimStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'CANCELLED', 'RETIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ActivationOrderStatus" AS ENUM ('DRAFT', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AssignmentReason" AS ENUM ('INITIAL', 'REPLACEMENT', 'REMOVED', 'RMA', 'UPGRADE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'SUSPEND', 'RESUME', 'CANCEL', 'TERMINATE', 'ASSIGN_TRACKER', 'UNASSIGN_TRACKER', 'ASSIGN_SIM', 'UNASSIGN_SIM', 'REPLACE_TRACKER', 'REPLACE_SIM', 'COMPLETE_ACTIVATION', 'FAIL_ACTIVATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- -------------------------------------------------------------
-- TABLE: users
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- -------------------------------------------------------------
-- TABLE: customers
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customers" (
    "id" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "parentCustomerId" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'NL',
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_customerNumber_key" ON "customers"("customerNumber");
CREATE INDEX IF NOT EXISTS "customers_status_idx" ON "customers"("status");
CREATE INDEX IF NOT EXISTS "customers_parentCustomerId_idx" ON "customers"("parentCustomerId");

ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_parentCustomerId_fkey";
ALTER TABLE "customers" ADD CONSTRAINT "customers_parentCustomerId_fkey" FOREIGN KEY ("parentCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: products
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_productCode_key" ON "products"("productCode");

-- -------------------------------------------------------------
-- TABLE: subscriptions
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "subscriptionNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_subscriptionNumber_key" ON "subscriptions"("subscriptionNumber");
CREATE INDEX IF NOT EXISTS "subscriptions_customerId_idx" ON "subscriptions"("customerId");
CREATE INDEX IF NOT EXISTS "subscriptions_productId_idx" ON "subscriptions"("productId");
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions"("status");

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_customerId_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_productId_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: trackers
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "trackers" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "imei" VARCHAR(15) NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "hardwareType" TEXT,
    "firmwareVersion" TEXT,
    "purchaseDate" DATE,
    "supplier" TEXT,
    "status" "TrackerStatus" NOT NULL DEFAULT 'IN_STOCK',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trackers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trackers_serialNumber_key" ON "trackers"("serialNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "trackers_imei_key" ON "trackers"("imei");
CREATE INDEX IF NOT EXISTS "trackers_status_idx" ON "trackers"("status");
CREATE INDEX IF NOT EXISTS "trackers_brand_model_idx" ON "trackers"("brand", "model");

-- -------------------------------------------------------------
-- TABLE: sims
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sims" (
    "id" TEXT NOT NULL,
    "iccid" VARCHAR(20) NOT NULL,
    "msisdn" TEXT,
    "imsi" TEXT,
    "provider" TEXT NOT NULL,
    "simType" TEXT,
    "apn" TEXT,
    "status" "SimStatus" NOT NULL DEFAULT 'IN_STOCK',
    "providerActivationDate" DATE,
    "providerDeactivationDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sims_iccid_key" ON "sims"("iccid");
CREATE UNIQUE INDEX IF NOT EXISTS "sims_msisdn_key" ON "sims"("msisdn") WHERE "msisdn" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sims_status_idx" ON "sims"("status");
CREATE INDEX IF NOT EXISTS "sims_provider_idx" ON "sims"("provider");

-- -------------------------------------------------------------
-- TABLE: vehicles
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vehicles" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "licensePlate" TEXT,
    "vin" VARCHAR(17),
    "brand" TEXT,
    "model" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_licensePlate_key" ON "vehicles"("licensePlate") WHERE "licensePlate" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_vin_key" ON "vehicles"("vin") WHERE "vin" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "vehicles_customerId_idx" ON "vehicles"("customerId");

ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "vehicles_customerId_fkey";
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: tracker_assignments
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tracker_assignments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ,
    "reason" "AssignmentReason",
    "createdById" TEXT NOT NULL,

    CONSTRAINT "tracker_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tracker_assignments_subscriptionId_idx" ON "tracker_assignments"("subscriptionId");
CREATE INDEX IF NOT EXISTS "tracker_assignments_trackerId_idx" ON "tracker_assignments"("trackerId");
CREATE INDEX IF NOT EXISTS "tracker_assignments_vehicleId_idx" ON "tracker_assignments"("vehicleId");

-- CRITICAL BUSINESS CONSTRAINT: Een tracker kan op elk moment maximaal 1 ACTIVE assignment hebben
CREATE UNIQUE INDEX IF NOT EXISTS "active_tracker_unique" ON "tracker_assignments"("trackerId") WHERE "endAt" IS NULL;

-- CHECK: Correcte datum volgorde
ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignment_dates_check";
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignment_dates_check" CHECK ("endAt" IS NULL OR "endAt" > "startAt");

ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignments_subscriptionId_fkey";
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignments_trackerId_fkey";
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignments_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "trackers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignments_vehicleId_fkey";
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tracker_assignments" DROP CONSTRAINT IF EXISTS "tracker_assignments_createdById_fkey";
ALTER TABLE "tracker_assignments" ADD CONSTRAINT "tracker_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: sim_assignments
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sim_assignments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "simId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ,
    "reason" "AssignmentReason",
    "createdById" TEXT NOT NULL,

    CONSTRAINT "sim_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sim_assignments_subscriptionId_idx" ON "sim_assignments"("subscriptionId");
CREATE INDEX IF NOT EXISTS "sim_assignments_simId_idx" ON "sim_assignments"("simId");

-- CRITICAL BUSINESS CONSTRAINT: Een SIM kan op elk moment maximaal 1 ACTIVE assignment hebben
CREATE UNIQUE INDEX IF NOT EXISTS "active_sim_unique" ON "sim_assignments"("simId") WHERE "endAt" IS NULL;

-- CHECK: Correcte datum volgorde
ALTER TABLE "sim_assignments" DROP CONSTRAINT IF EXISTS "sim_assignment_dates_check";
ALTER TABLE "sim_assignments" ADD CONSTRAINT "sim_assignment_dates_check" CHECK ("endAt" IS NULL OR "endAt" > "startAt");

ALTER TABLE "sim_assignments" DROP CONSTRAINT IF EXISTS "sim_assignments_subscriptionId_fkey";
ALTER TABLE "sim_assignments" ADD CONSTRAINT "sim_assignments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sim_assignments" DROP CONSTRAINT IF EXISTS "sim_assignments_simId_fkey";
ALTER TABLE "sim_assignments" ADD CONSTRAINT "sim_assignments_simId_fkey" FOREIGN KEY ("simId") REFERENCES "sims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sim_assignments" DROP CONSTRAINT IF EXISTS "sim_assignments_createdById_fkey";
ALTER TABLE "sim_assignments" ADD CONSTRAINT "sim_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: activation_orders
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "activation_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subCustomerId" TEXT,
    "productId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "trackerId" TEXT,
    "simId" TEXT,
    "vehicleId" TEXT,
    "desiredStartDate" DATE NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "ActivationOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "internalNotes" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activation_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "activation_orders_orderNumber_key" ON "activation_orders"("orderNumber");
CREATE INDEX IF NOT EXISTS "activation_orders_customerId_idx" ON "activation_orders"("customerId");
CREATE INDEX IF NOT EXISTS "activation_orders_subCustomerId_idx" ON "activation_orders"("subCustomerId");
CREATE INDEX IF NOT EXISTS "activation_orders_productId_idx" ON "activation_orders"("productId");
CREATE INDEX IF NOT EXISTS "activation_orders_subscriptionId_idx" ON "activation_orders"("subscriptionId");
CREATE INDEX IF NOT EXISTS "activation_orders_status_idx" ON "activation_orders"("status");
CREATE INDEX IF NOT EXISTS "activation_orders_trackerId_idx" ON "activation_orders"("trackerId");
CREATE INDEX IF NOT EXISTS "activation_orders_simId_idx" ON "activation_orders"("simId");

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_customerId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_subCustomerId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_subCustomerId_fkey" FOREIGN KEY ("subCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_productId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_subscriptionId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_trackerId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "trackers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_simId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_simId_fkey" FOREIGN KEY ("simId") REFERENCES "sims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_vehicleId_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activation_orders" DROP CONSTRAINT IF EXISTS "activation_orders_createdById_fkey";
ALTER TABLE "activation_orders" ADD CONSTRAINT "activation_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------
-- TABLE: audit_logs
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_userId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
