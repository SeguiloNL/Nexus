-- 20260917170000_add_audit_action_hard_delete
-- (1) AuditAction: voeg HARD_DELETE toe voor het permanent verwijderen van entiteiten (alleen ADMIN)

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'HARD_DELETE';
