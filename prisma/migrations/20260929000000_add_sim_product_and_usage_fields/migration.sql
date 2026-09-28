-- AlterTable
ALTER TABLE "sims" ADD COLUMN "productType" VARCHAR(150);
ALTER TABLE "sims" ADD COLUMN "dataUsedBytes" BIGINT;
ALTER TABLE "sims" ADD COLUMN "dataLimitBytes" BIGINT;
ALTER TABLE "sims" ADD COLUMN "lowestDataLimitBytes" BIGINT;
ALTER TABLE "sims" ADD COLUMN "smsUsedCount" INTEGER;
ALTER TABLE "sims" ADD COLUMN "smsLimitCount" INTEGER;
ALTER TABLE "sims" ADD COLUMN "lowestSmsLimitCount" INTEGER;
ALTER TABLE "sims" ADD COLUMN "lastUsageSyncAt" TIMESTAMPTZ;
