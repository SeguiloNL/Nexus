-- Correctie: kolom action_overrides (snake_case) hernoemen naar actionOverrides (camelCase)
-- zodat deze overeenkomt met de projectconventie (zie o.a. isSystem, createdAt, passwordHash).
-- De foutieve kolom is aangemaakt in migratie 20261006150000_add_role_action_overrides.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'roles'
          AND column_name  = 'action_overrides'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'roles'
          AND column_name  = 'actionOverrides'
    ) THEN
        ALTER TABLE "roles" RENAME COLUMN "action_overrides" TO "actionOverrides";
    END IF;
END $$;
