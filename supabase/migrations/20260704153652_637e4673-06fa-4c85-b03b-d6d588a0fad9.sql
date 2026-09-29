
-- fee_structures: enforce school_id on writes
DROP POLICY IF EXISTS fee_structures_admin_insert ON public.fee_structures;
DROP POLICY IF EXISTS fee_structures_admin_update ON public.fee_structures;
DROP POLICY IF EXISTS fee_structures_admin_delete ON public.fee_structures;

CREATE POLICY fee_structures_tenant_insert ON public.fee_structures
  FOR INSERT TO authenticated
  WITH CHECK (
    (get_auth_role() = 'superadmin')
    OR (
      school_id = get_auth_school_id()
      AND get_auth_role() = ANY (ARRAY['admin','accountant'])
    )
  );

CREATE POLICY fee_structures_tenant_update ON public.fee_structures
  FOR UPDATE TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (
      school_id = get_auth_school_id()
      AND get_auth_role() = ANY (ARRAY['admin','accountant'])
    )
  )
  WITH CHECK (
    (get_auth_role() = 'superadmin')
    OR (
      school_id = get_auth_school_id()
      AND get_auth_role() = ANY (ARRAY['admin','accountant'])
    )
  );

CREATE POLICY fee_structures_tenant_delete ON public.fee_structures
  FOR DELETE TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (
      school_id = get_auth_school_id()
      AND get_auth_role() = 'admin'
    )
  );

-- salary: allow accountant read + tenant-scoped writes
DROP POLICY IF EXISTS salary_admin_select ON public.salary;
DROP POLICY IF EXISTS salary_admin_write  ON public.salary;
DROP POLICY IF EXISTS salary_admin_update ON public.salary;
DROP POLICY IF EXISTS salary_admin_delete ON public.salary;

CREATE POLICY salary_tenant_select ON public.salary
  FOR SELECT TO authenticated
  USING (
    (get_auth_role() = 'superadmin')
    OR (
      school_id = get_auth_school_id()
      AND get_auth_role() = ANY (ARRAY['admin','accountant'])
    )
  );

CREATE POLICY salary_tenant_insert ON public.salary
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  );

CREATE POLICY salary_tenant_update ON public.salary
  FOR UPDATE TO authenticated
  USING (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  )
  WITH CHECK (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  );

CREATE POLICY salary_tenant_delete ON public.salary
  FOR DELETE TO authenticated
  USING (
    school_id = get_auth_school_id()
    AND (get_auth_role() = ANY (ARRAY['admin','superadmin']))
  );

-- transactions: allow accountant writes (receipts)
DROP POLICY IF EXISTS transactions_admin_write  ON public.transactions;
DROP POLICY IF EXISTS transactions_admin_update ON public.transactions;
DROP POLICY IF EXISTS transactions_admin_delete ON public.transactions;

CREATE POLICY transactions_tenant_insert ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  );

CREATE POLICY transactions_tenant_update ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  )
  WITH CHECK (
    school_id = get_auth_school_id()
    AND get_auth_role() = ANY (ARRAY['admin','accountant','superadmin'])
  );

CREATE POLICY transactions_tenant_delete ON public.transactions
  FOR DELETE TO authenticated
  USING (
    school_id = get_auth_school_id()
    AND (get_auth_role() = ANY (ARRAY['admin','superadmin']))
  );
