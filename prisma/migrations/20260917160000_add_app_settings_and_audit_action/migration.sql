-- 20260917160000_add_app_settings_and_audit_action
-- (1) AuditAction: voeg UPDATE_SETTINGS toe voor applicatie-instellingen wijzigingen
-- (2) AppSetting: nieuwe key-value tabel voor applicatie-instellingen (Inserve API, etc.)

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE_SETTINGS';

CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT,
  "isSecret" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_settings_key_key" ON "app_settings"("key");
