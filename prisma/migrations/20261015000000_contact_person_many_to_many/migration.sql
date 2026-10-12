-- Many-to-many: ContactPerson <-> Customer
-- Een contactpersoon kan bij meerdere bedrijven horen.

-- CreateTable
CREATE TABLE "customer_contact_persons" (
    "customerId" TEXT NOT NULL,
    "contactPersonId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedBy" TEXT,

    CONSTRAINT "customer_contact_persons_pkey" PRIMARY KEY ("customerId", "contactPersonId")
);

-- CreateIndex
CREATE INDEX "customer_contact_persons_customerId_idx" ON "customer_contact_persons"("customerId");

-- CreateIndex
CREATE INDEX "customer_contact_persons_contactPersonId_idx" ON "customer_contact_persons"("contactPersonId");

-- AddForeignKey
ALTER TABLE "customer_contact_persons" ADD CONSTRAINT "customer_contact_persons_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_persons" ADD CONSTRAINT "customer_contact_persons_contactPersonId_fkey" FOREIGN KEY ("contactPersonId") REFERENCES "contact_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing customerId FKs into the junction table.
INSERT INTO "customer_contact_persons" ("customerId", "contactPersonId", "linkedAt")
SELECT "customerId", "id", "createdAt"
FROM "contact_persons"
WHERE "customerId" IS NOT NULL
ON CONFLICT ("customerId", "contactPersonId") DO NOTHING;

-- DropIndex
DROP INDEX IF EXISTS "contact_persons_customerId_inserveContactId_key";

-- DropIndex
DROP INDEX IF EXISTS "contact_persons_customerId_idx";

-- DropForeignKey
ALTER TABLE "contact_persons" DROP CONSTRAINT IF EXISTS "contact_persons_customerId_fkey";

-- AlterTable
ALTER TABLE "contact_persons" DROP COLUMN IF EXISTS "customerId";
