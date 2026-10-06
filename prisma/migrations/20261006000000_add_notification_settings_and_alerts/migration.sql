-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "AlertThresholdLevel" AS ENUM ('WARNING_80');

-- AlterEnum
ALTER TYPE "SyncJobId" ADD VALUE IF NOT EXISTS 'SIMHUIS_USAGE_ALERT_NOTIFY';

-- CreateTable
CREATE TABLE "user_notification_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabledEmail" BOOLEAN NOT NULL DEFAULT true,
    "enabledDataThresholdAlert" BOOLEAN NOT NULL DEFAULT true,
    "dataThresholdPercent" INTEGER NOT NULL DEFAULT 80,
    "notifyAllSims" BOOLEAN NOT NULL DEFAULT false,
    "channels" "NotificationChannel"[] NOT NULL DEFAULT ARRAY['EMAIL']::"NotificationChannel"[],
    "lastNotificationAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_settings_userId_key" ON "user_notification_settings"("userId");

-- CreateIndex
CREATE INDEX "user_notification_settings_userId_idx" ON "user_notification_settings"("userId");

-- CreateTable
CREATE TABLE "sim_usage_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "simId" TEXT NOT NULL,
    "thresholdLevel" "AlertThresholdLevel" NOT NULL,
    "dataUsedBytes" BIGINT NOT NULL,
    "dataLimitBytes" BIGINT NOT NULL,
    "usagePeriodStart" TIMESTAMPTZ,
    "channel" "NotificationChannel" NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_usage_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sim_usage_alerts_userId_simId_thresholdLevel_usagePeriodStart_key" ON "sim_usage_alerts"("userId", "simId", "thresholdLevel", "usagePeriodStart");

-- CreateIndex
CREATE INDEX "sim_usage_alerts_userId_sentAt_idx" ON "sim_usage_alerts"("userId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "sim_usage_alerts_simId_idx" ON "sim_usage_alerts"("simId");

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_usage_alerts" ADD CONSTRAINT "sim_usage_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_usage_alerts" ADD CONSTRAINT "sim_usage_alerts_simId_fkey" FOREIGN KEY ("simId") REFERENCES "sims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
