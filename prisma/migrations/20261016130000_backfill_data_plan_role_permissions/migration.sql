-- Backfill ontbrekende data_plan permissies voor legacy interne systeemrollen.
-- Nodig omdat oudere seeds/install-scripts deze resource nog niet meenamen.

INSERT INTO "role_permissions" (id, "roleId", resource, read, write)
SELECT
  'perm_' || r.id || '_data_plan',
  r.id,
  'data_plan',
  true,
  CASE
    WHEN r.name = 'VIEWER' THEN false
    ELSE true
  END
FROM "roles" r
WHERE r.scope = 'INTERNAL'
  AND r."isSystem" = true
  AND r.name IN ('ADMIN', 'EMPLOYEE', 'VIEWER')
ON CONFLICT ("roleId", resource) DO UPDATE
SET
  read = EXCLUDED.read,
  write = EXCLUDED.write;
