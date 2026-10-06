-- Role action-level permission overrides (fijnmazige toggles per resource/action, bovenop NONE/READ/WRITE).
ALTER TABLE "roles" ADD COLUMN "action_overrides" JSON;
