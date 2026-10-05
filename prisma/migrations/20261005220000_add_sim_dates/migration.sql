-- AlterTable
ALTER TABLE "sims" ADD COLUMN "activationDate" TIMESTAMPTZ;
ALTER TABLE "sims" ADD COLUMN "reactivationDate" TIMESTAMPTZ;
ALTER TABLE "sims" ADD COLUMN "subscriptionDate" TIMESTAMPTZ;
