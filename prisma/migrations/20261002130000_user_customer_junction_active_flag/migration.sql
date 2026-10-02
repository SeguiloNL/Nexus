-- Gebruikers- en Rollensysteem Herziening
-- Creëert M:N junction tussen User en Customer (UserCustomer),
-- voegt isActive + invitation velden toe aan User,
-- en breidt AuditAction enum uit met 5 nieuwe acties.

-- 1. Nieuwe waardes voor AuditAction (Postgres: ALTER TYPE ... ADD VALUE)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLONE_ROLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LINK_USER_CUSTOMER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UNLINK_USER_CUSTOMER';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TOGGLE_USER_ACTIVE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BULK_UPDATE_ROLE';

-- 2. Nieuwe User velden
ALTER TABLE "users"
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "users"
    ADD COLUMN "invitationToken" TEXT;

ALTER TABLE "users"
    ADD COLUMN "invitationExpiresAt" TIMESTAMPTZ;

CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- 3. Junction-tabel UserCustomer
CREATE TABLE "user_customers" (
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "user_customers_pkey" PRIMARY KEY ("userId","customerId")
);

CREATE INDEX "user_customers_userId_idx" ON "user_customers"("userId");
CREATE INDEX "user_customers_customerId_idx" ON "user_customers"("customerId");

ALTER TABLE "user_customers"
    ADD CONSTRAINT "user_customers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_customers"
    ADD CONSTRAINT "user_customers_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
