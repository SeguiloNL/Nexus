-- Dynamische rollen + klant-/sub-klantgebruikers
-- Fase 1a: Nieuwe tabellen en User FKs

-- ------------------------------------------------------------------
-- RoleScope enum (Postgres)
-- ------------------------------------------------------------------
CREATE TYPE "RoleScope" AS ENUM ('INTERNAL', 'CUSTOMER');

-- ------------------------------------------------------------------
-- Rollen-tabel
-- ------------------------------------------------------------------
CREATE TABLE "roles" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "scope" "RoleScope" NOT NULL,
  "isSystem" boolean NOT NULL DEFAULT false,
  "isDefault" boolean NOT NULL DEFAULT false,
  "description" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_name_scope_key" ON "roles"("name", "scope");
CREATE INDEX "roles_scope_idx" ON "roles"("scope");

-- ------------------------------------------------------------------
-- RolePermission: per-resource read/write bits per rol
-- ------------------------------------------------------------------
CREATE TABLE "role_permissions" (
  "id" text NOT NULL,
  "roleId" text NOT NULL,
  "resource" text NOT NULL,
  "read" boolean NOT NULL DEFAULT false,
  "write" boolean NOT NULL DEFAULT false,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_roleId_resource_key" ON "role_permissions"("roleId", "resource");
CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- User FKs: roleId (optioneel -> Role) en customerId (optioneel -> Customer)
-- ------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN "roleId" text;

ALTER TABLE "users"
  ADD COLUMN "customerId" text;

ALTER TABLE "users"
  ADD CONSTRAINT "users_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_roleId_idx" ON "users"("roleId");
CREATE INDEX "users_customerId_idx" ON "users"("customerId");
