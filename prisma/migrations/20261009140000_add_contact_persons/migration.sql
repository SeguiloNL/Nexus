-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_CONTACT';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_CONTACT';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_CONTACT';

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "functionTitle" TEXT,
    "inserveContactId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_persons_inserveContactId_key" ON "contact_persons"("inserveContactId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_persons_customerId_inserveContactId_key" ON "contact_persons"("customerId", "inserveContactId");

-- CreateIndex
CREATE INDEX "contact_persons_customerId_idx" ON "contact_persons"("customerId");

-- CreateIndex
CREATE INDEX "contact_persons_inserveContactId_idx" ON "contact_persons"("inserveContactId");

-- CreateIndex
CREATE INDEX "contact_persons_lastName_idx" ON "contact_persons"("lastName");

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
