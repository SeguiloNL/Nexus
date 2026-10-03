-- Synchronisatie-taak Scheduler + Run Logging
-- Voegt SyncFrequency / SyncJobStatus / SyncJobTrigger / SyncJobId enums toe,
-- alsmede de tabellen sync_job_configs (per-taak schedule configuratie) en
-- sync_job_runs (audit- en foutlog van elke uitvoering inclusief duur/records).

-- 1. Nieuwe enum types
CREATE TYPE "SyncFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "SyncJobStatus"  AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT');
CREATE TYPE "SyncJobTrigger" AS ENUM ('MANUAL_ADMIN', 'SYSTEMD_TIMER', 'FALLBACK_POLLING', 'API_TOKEN');
CREATE TYPE "SyncJobId"      AS ENUM ('SIMHUIS_USAGE', 'SIMHUIS_SIMS', 'INSERVE');

-- 2. Schedule configuratie-tabel (1 rij per jobId; unique jobId)
CREATE TABLE "sync_job_configs" (
    "id"            TEXT            NOT NULL,
    "jobId"         "SyncJobId"     NOT NULL,
    "enabled"       BOOLEAN         NOT NULL DEFAULT true,
    "frequency"     "SyncFrequency" NOT NULL DEFAULT 'DAILY',
    "hour"          INTEGER         NOT NULL DEFAULT 3,
    "minute"        INTEGER         NOT NULL DEFAULT 0,
    "dayOfWeek"     INTEGER                  DEFAULT 1,
    "dayOfMonth"    INTEGER                  DEFAULT 1,
    "timezone"      TEXT            NOT NULL DEFAULT 'Europe/Amsterdam',
    "updatedById"   TEXT,
    "lastAppliedAt" TIMESTAMPTZ,
    "updatedAt"     TIMESTAMPTZ     NOT NULL,
    "createdAt"     TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_job_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_job_configs_jobId_key" ON "sync_job_configs"("jobId");
CREATE INDEX "sync_job_configs_enabled_idx" ON "sync_job_configs"("enabled");

ALTER TABLE "sync_job_configs"
    ADD CONSTRAINT "sync_job_configs_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Per-uitvoering run-log tabel (audit + debugging)
CREATE TABLE "sync_job_runs" (
    "id"               TEXT            NOT NULL,
    "configId"         TEXT            NOT NULL,
    "jobId"            "SyncJobId"     NOT NULL,
    "triggeredBy"      "SyncJobTrigger" NOT NULL,
    "startedAt"        TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"          TIMESTAMPTZ,
    "status"           "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "durationMs"       INTEGER,
    "recordsAffected"  JSONB,
    "errorMessage"     TEXT,
    "errorDetail"      JSONB,
    "userId"           TEXT,

    CONSTRAINT "sync_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_job_runs_jobId_startedAt_idx" ON "sync_job_runs"("jobId" ASC, "startedAt" DESC);
CREATE INDEX "sync_job_runs_configId_startedAt_idx" ON "sync_job_runs"("configId" ASC, "startedAt" DESC);
CREATE INDEX "sync_job_runs_status_idx"    ON "sync_job_runs"("status");
CREATE INDEX "sync_job_runs_triggeredBy_idx" ON "sync_job_runs"("triggeredBy");

ALTER TABLE "sync_job_runs"
    ADD CONSTRAINT "sync_job_runs_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "sync_job_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_job_runs"
    ADD CONSTRAINT "sync_job_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
