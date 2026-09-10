/*
  Warnings:

  - A unique constraint covering the columns `[inserveCompanyId]` on the table `customers` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[inserveArticleId]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[inserveSubscriptionId]` on the table `subscriptions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "InserveSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SYNCED';
ALTER TYPE "AuditAction" ADD VALUE 'INSERVE_SYNC_FAILED';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "btwNr" TEXT,
ADD COLUMN     "inserveCompanyId" INTEGER,
ADD COLUMN     "kvkNr" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "btwPercentage" DECIMAL(4,2) DEFAULT 21,
ADD COLUMN     "inserveArticleId" INTEGER;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "inserveLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "inserveSubscriptionId" INTEGER,
ADD COLUMN     "inserveSyncError" TEXT,
ADD COLUMN     "inserveSyncStatus" "InserveSyncStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "customers_inserveCompanyId_key" ON "customers"("inserveCompanyId");

-- CreateIndex
CREATE INDEX "customers_kvkNr_idx" ON "customers"("kvkNr");

-- CreateIndex
CREATE UNIQUE INDEX "products_inserveArticleId_key" ON "products"("inserveArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_inserveSubscriptionId_key" ON "subscriptions"("inserveSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_inserveSyncStatus_idx" ON "subscriptions"("inserveSyncStatus");
