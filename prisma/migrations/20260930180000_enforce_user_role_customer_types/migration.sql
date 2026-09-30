-- Afdwingen van geldige rol-klant type koppelingen op databaseniveau
-- Voorkomt ongeldige combinaties ook buiten de applicatie om (bv. directe SQL).
-- ---------------------------------------------------------------------------
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper functie: valideer (role_scope, customer_type) combinatie
--    Wordt aangeroepen door de row-level trigger op users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_user_role_customer_binding()
RETURNS TRIGGER AS $$
DECLARE
  v_role_scope    TEXT;
  v_customer_type TEXT;
  v_required_type TEXT;
BEGIN
  -- Klant is leeg: alleen toegestaan als scope = INTERNAL (of legacy: geen roleId)
  IF NEW."roleId" IS NOT NULL THEN
    SELECT scope INTO STRICT v_role_scope
      FROM roles
     WHERE id = NEW."roleId";
  ELSE
    -- Legacy: geen roleId → intern gebruiker (geen customer toegestaan)
    v_role_scope := 'INTERNAL';
  END IF;

  -- Als er een customerId is opgegeven, haal dan zijn type op
  IF NEW."customerId" IS NOT NULL THEN
    SELECT type INTO STRICT v_customer_type
      FROM customers
     WHERE id = NEW."customerId";
  ELSE
    v_customer_type := NULL;
  END IF;

  -- -----------------------------------------------------------------------
  -- Bepaal het vereiste customer-type obv de role-scope
  -- -----------------------------------------------------------------------
  CASE v_role_scope
    WHEN 'INTERNAL' THEN
      IF NEW."customerId" IS NOT NULL THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Interne gebruikers (scope INTERNAL) mogen GEEN klant toegewezen krijgen (user=%)', NEW.id;
      END IF;

    WHEN 'RESELLER' THEN
      v_required_type := 'RESELLER';
      IF NEW."customerId" IS NULL THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Reseller-gebruikers (scope RESELLER) moeten gekoppeld zijn aan een RESELLER-klant (user=%)', NEW.id;
      ELSIF v_customer_type <> v_required_type THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Reseller-gebruiker kan alleen worden gekoppeld aan een Klant met type RESELLER (klanttype=%, user=%)',
          v_customer_type, NEW.id;
      END IF;

    WHEN 'PARTNER' THEN
      v_required_type := 'PARTNER';
      IF NEW."customerId" IS NULL THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Partner-gebruikers (scope PARTNER) moeten gekoppeld zijn aan een PARTNER-klant (user=%)', NEW.id;
      ELSIF v_customer_type <> v_required_type THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Partner-gebruiker kan alleen worden gekoppeld aan een Klant met type PARTNER (klanttype=%, user=%)',
          v_customer_type, NEW.id;
      END IF;

    WHEN 'CUSTOMER' THEN
      v_required_type := 'DIRECT';
      IF NEW."customerId" IS NULL THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Klant-gebruikers (scope CUSTOMER) moeten gekoppeld zijn aan een DIRECT-klant (user=%)', NEW.id;
      ELSIF v_customer_type <> v_required_type THEN
        RAISE EXCEPTION
          'DATABASE CHECK: Klant-gebruiker kan alleen worden gekoppeld aan een Klant met type DIRECT (klanttype=%, user=%)',
          v_customer_type, NEW.id;
      END IF;

    ELSE
      -- Onbekende scope: conservatief blokkeren
      RAISE EXCEPTION
        'DATABASE CHECK: Onbekende role-scope % voor user %', v_role_scope, NEW.id;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Row-level triggers: aanroepen bij INSERT en UPDATE
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_users_check_role_customer_binding ON users;

CREATE TRIGGER trg_users_check_role_customer_binding
  BEFORE INSERT OR UPDATE OF "roleId", "customerId"
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION check_user_role_customer_binding();

COMMIT;
