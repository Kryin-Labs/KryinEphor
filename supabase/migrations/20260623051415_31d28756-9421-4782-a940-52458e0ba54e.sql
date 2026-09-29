-- Helper: admin-or-superadmin within same school
-- (uses existing has_role + get_auth_school_id)

-- ============ api_keys ============
DROP POLICY IF EXISTS tenant_insert ON public.api_keys;
DROP POLICY IF EXISTS tenant_update ON public.api_keys;
DROP POLICY IF EXISTS tenant_delete ON public.api_keys;
DROP POLICY IF EXISTS tenant_select ON public.api_keys;
CREATE POLICY api_keys_admin_select ON public.api_keys FOR SELECT TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY api_keys_admin_write ON public.api_keys FOR ALL TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ webhooks ============
DROP POLICY IF EXISTS tenant_insert ON public.webhooks;
DROP POLICY IF EXISTS tenant_update ON public.webhooks;
DROP POLICY IF EXISTS tenant_delete ON public.webhooks;
DROP POLICY IF EXISTS tenant_select ON public.webhooks;
CREATE POLICY webhooks_admin_all ON public.webhooks FOR ALL TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ transactions ============
DROP POLICY IF EXISTS tenant_insert ON public.transactions;
DROP POLICY IF EXISTS tenant_update ON public.transactions;
DROP POLICY IF EXISTS tenant_delete ON public.transactions;
CREATE POLICY transactions_admin_write ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY transactions_admin_update ON public.transactions FOR UPDATE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY transactions_admin_delete ON public.transactions FOR DELETE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ salary ============
DROP POLICY IF EXISTS tenant_insert ON public.salary;
DROP POLICY IF EXISTS tenant_update ON public.salary;
DROP POLICY IF EXISTS tenant_delete ON public.salary;
CREATE POLICY salary_admin_write ON public.salary FOR INSERT TO authenticated
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY salary_admin_update ON public.salary FOR UPDATE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY salary_admin_delete ON public.salary FOR DELETE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ memberships ============
DROP POLICY IF EXISTS tenant_insert ON public.memberships;
DROP POLICY IF EXISTS tenant_update ON public.memberships;
DROP POLICY IF EXISTS tenant_delete ON public.memberships;
CREATE POLICY memberships_admin_write ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY memberships_admin_update ON public.memberships FOR UPDATE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY memberships_admin_delete ON public.memberships FOR DELETE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ payment_methods ============
DROP POLICY IF EXISTS tenant_insert ON public.payment_methods;
DROP POLICY IF EXISTS tenant_update ON public.payment_methods;
DROP POLICY IF EXISTS tenant_delete ON public.payment_methods;
DROP POLICY IF EXISTS tenant_select ON public.payment_methods;
CREATE POLICY payment_methods_admin_all ON public.payment_methods FOR ALL TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ employees ============
DROP POLICY IF EXISTS employees_admin_select ON public.employees;
DROP POLICY IF EXISTS tenant_insert ON public.employees;
DROP POLICY IF EXISTS tenant_update ON public.employees;
DROP POLICY IF EXISTS tenant_delete ON public.employees;
CREATE POLICY employees_admin_select ON public.employees FOR SELECT TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY employees_admin_write ON public.employees FOR INSERT TO authenticated
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY employees_admin_update ON public.employees FOR UPDATE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')))
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY employees_admin_delete ON public.employees FOR DELETE TO authenticated
  USING (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));

-- ============ message_threads (DELETE) ============
DROP POLICY IF EXISTS tenant_delete ON public.message_threads;
CREATE POLICY message_threads_delete_creator_or_admin ON public.message_threads FOR DELETE TO authenticated
  USING (
    school_id = public.get_auth_school_id()
    AND (
      created_by = auth.uid()
      OR public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'superadmin')
    )
  );

-- ============ notifications ============
DROP POLICY IF EXISTS tenant_insert ON public.notifications;
DROP POLICY IF EXISTS tenant_update ON public.notifications;
DROP POLICY IF EXISTS tenant_delete ON public.notifications;
CREATE POLICY notifications_admin_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (school_id = public.get_auth_school_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')));
CREATE POLICY notifications_recipient_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE POLICY notifications_recipient_delete ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));

-- ============ feature_flags / roles / permissions / role_permissions / fee_structures (admin-only writes) ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['feature_flags','roles','permissions','role_permissions','fee_structures']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
        WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
    $f$, t || '_admin_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
        USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
        WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
    $f$, t || '_admin_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
        USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
    $f$, t || '_admin_delete', t);
  END LOOP;
END $$;