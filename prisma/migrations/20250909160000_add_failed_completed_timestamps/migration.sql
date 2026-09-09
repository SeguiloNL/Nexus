-- AlterTable
ALTER TABLE "activation_orders" ADD COLUMN "failedAt" TIMESTAMPTZ;
ALTER TABLE "activation_orders" ADD COLUMN "completedAt" TIMESTAMPTZ;
