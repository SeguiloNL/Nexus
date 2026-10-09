-- CreateEnum
CREATE TYPE "CustomerLinkSource" AS ENUM ('INSERVE_ASSET', 'MANUAL', 'SUBSCRIPTION_DERIVED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SIM_LINKED';
ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SIM_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SIM_LINK_CONFLICT';
ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SIM_LINKED_BATCH';

-- AlterTable
ALTER TABLE "sims" ADD COLUMN "customerId" TEXT;
ALTER TABLE "sims" ADD COLUMN "customerLinkSource" "CustomerLinkSource";
ALTER TABLE "sims" ADD COLUMN "customerLinkedAt" TIMESTAMPTZ;
ALTER TABLE "sims" ADD COLUMN "inserveAssetId" INTEGER;
ALTER TABLE "sims" ADD COLUMN "inserveAssetLinkedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE UNIQUE INDEX "sims_inserveAssetId_key" ON "sims"("inserveAssetId");

-- CreateIndex
CREATE INDEX "sims_customerId_idx" ON "sims"("customerId");

-- AddForeignKey
ALTER TABLE "sims" ADD CONSTRAINT "sims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
