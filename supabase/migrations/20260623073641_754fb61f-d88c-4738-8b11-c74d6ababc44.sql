
-- 1. employees: column-level restriction on sensitive financial fields
REVOKE SELECT (bank_account, pan_number) ON public.employees FROM authenticated, anon;
-- service_role retains full access via GRANT ALL elsewhere; edge functions can still read.

-- 2. login_attempts: remove anonymous + authenticated direct inserts
DROP POLICY IF EXISTS la_insert_anon ON public.login_attempts;
DROP POLICY IF EXISTS la_insert_auth ON public.login_attempts;
REVOKE INSERT ON public.login_attempts FROM anon, authenticated;
-- service_role retains insert; the request_password_recovery edge function uses service role.

-- 3. password_recovery_audit: hash recovery_link going forward and scrub existing rows
-- Hash any currently-stored plaintext links (anything that looks like a URL).
UPDATE public.password_recovery_audit
   SET recovery_link = encode(digest(recovery_link, 'sha256'), 'hex')
 WHERE recovery_link IS NOT NULL
   AND recovery_link ~ '^https?://';

CREATE OR REPLACE FUNCTION public.hash_recovery_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.recovery_link IS NOT NULL AND NEW.recovery_link ~ '^https?://' THEN
    NEW.recovery_link := encode(digest(NEW.recovery_link, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_recovery_link ON public.password_recovery_audit;
CREATE TRIGGER trg_hash_recovery_link
  BEFORE INSERT OR UPDATE OF recovery_link ON public.password_recovery_audit
  FOR EACH ROW EXECUTE FUNCTION public.hash_recovery_link();

-- 4. permissions: remove overly broad school-admin write policies (superadmin global_* policies remain)
DROP POLICY IF EXISTS permissions_admin_insert ON public.permissions;
DROP POLICY IF EXISTS permissions_admin_update ON public.permissions;
DROP POLICY IF EXISTS permissions_admin_delete ON public.permissions;

-- 5. role_permissions: scope school-admin writes to their own school's non-system roles
DROP POLICY IF EXISTS role_permissions_admin_insert ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_admin_update ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_admin_delete ON public.role_permissions;

CREATE POLICY role_permissions_admin_insert ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND r.school_id = public.get_auth_school_id()
         AND r.is_system = false
    )
  );

CREATE POLICY role_permissions_admin_update ON public.role_permissions
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND r.school_id = public.get_auth_school_id()
         AND r.is_system = false
    )
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND r.school_id = public.get_auth_school_id()
         AND r.is_system = false
    )
  );

CREATE POLICY role_permissions_admin_delete ON public.role_permissions
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND r.school_id = public.get_auth_school_id()
         AND r.is_system = false
    )
  );

-- 6. roles: school-admin writes must respect is_system and their own school
DROP POLICY IF EXISTS roles_admin_insert ON public.roles;
DROP POLICY IF EXISTS roles_admin_update ON public.roles;
DROP POLICY IF EXISTS roles_admin_delete ON public.roles;

CREATE POLICY roles_admin_insert ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND school_id = public.get_auth_school_id()
    AND is_system = false
  );

CREATE POLICY roles_admin_update ON public.roles
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND school_id = public.get_auth_school_id()
    AND is_system = false
  )
  WITH CHECK (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND school_id = public.get_auth_school_id()
    AND is_system = false
  );

CREATE POLICY roles_admin_delete ON public.roles
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
    AND school_id = public.get_auth_school_id()
    AND is_system = false
  );
