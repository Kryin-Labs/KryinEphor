
-- 1. Academic tables: add role guard on write policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exams','classes','subjects','timetable','homework','grading_scales']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() IN ('admin','teacher')))$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() IN ('admin','teacher'))) WITH CHECK (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() IN ('admin','teacher')))$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND get_auth_role() IN ('admin','teacher')))$f$, t);
  END LOOP;
END $$;

-- Leave requests: restrict UPDATE to admin only (approval), keep INSERT open so employees can submit
DROP POLICY IF EXISTS tenant_update ON public.leave_requests;
CREATE POLICY tenant_update ON public.leave_requests FOR UPDATE TO authenticated
  USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND has_role(auth.uid(),'admin')))
  WITH CHECK (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND has_role(auth.uid(),'admin')));

-- 2. feature_flags: scope writes to caller's school
DROP POLICY IF EXISTS feature_flags_admin_insert ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_admin_update ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_admin_delete ON public.feature_flags;
CREATE POLICY feature_flags_admin_insert ON public.feature_flags FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'superadmin') OR (has_role(auth.uid(),'admin') AND school_id = get_auth_school_id()));
CREATE POLICY feature_flags_admin_update ON public.feature_flags FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'superadmin') OR (has_role(auth.uid(),'admin') AND school_id = get_auth_school_id()))
  WITH CHECK (has_role(auth.uid(),'superadmin') OR (has_role(auth.uid(),'admin') AND school_id = get_auth_school_id()));
CREATE POLICY feature_flags_admin_delete ON public.feature_flags FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'superadmin') OR (has_role(auth.uid(),'admin') AND school_id = get_auth_school_id()));

-- 3. Log tables: restrict SELECT to admins only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['system_logs','activity_logs','audit_logs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format($f$CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING (get_auth_role() = 'superadmin' OR (school_id = get_auth_school_id() AND has_role(auth.uid(),'admin')))$f$, t);
  END LOOP;
END $$;

-- 6. audit_logs: allow admins to insert audit rows within their school, and superadmins to purge
DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    get_auth_role() = 'superadmin'
    OR (school_id = get_auth_school_id() AND has_role(auth.uid(),'admin'))
  );

DROP POLICY IF EXISTS tenant_delete ON public.audit_logs;
CREATE POLICY tenant_delete ON public.audit_logs FOR DELETE TO authenticated
  USING (get_auth_role() = 'superadmin');

-- 7 & 8. Restrict global catalog SELECT to authenticated users (was PUBLIC via `USING (true)`)
DROP POLICY IF EXISTS plans_read ON public.plans;
CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS global_select ON public.subscription_plans;
CREATE POLICY global_select ON public.subscription_plans FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS global_select ON public.permissions;
CREATE POLICY global_select ON public.permissions FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.plans FROM anon;
REVOKE SELECT ON public.subscription_plans FROM anon;
REVOKE SELECT ON public.permissions FROM anon;

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.fn_apply_late_fees() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_bulk_assign_fee_plan(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_bulk_enroll_students(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_class_overview(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_extend_invoice_due(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_generate_school_invoice(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_mark_class_attendance(uuid, date, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_record_fee_payment(uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_sync_school_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hash_recovery_link() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_apply_late_fees() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_assign_fee_plan(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_enroll_students(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_class_overview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_extend_invoice_due(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_generate_school_invoice(uuid, date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_class_attendance(uuid, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_fee_payment(uuid, numeric, text, text, text) TO authenticated, service_role;

-- 5. Revoke anon SELECT on fee/enrollment tables exposed via pg_graphql
REVOKE SELECT ON public.additional_charges FROM anon;
REVOKE SELECT ON public.fee_plan_items FROM anon;
REVOKE SELECT ON public.fee_plans FROM anon;
REVOKE SELECT ON public.invoice_items FROM anon;
REVOKE SELECT ON public.student_fee_assignments FROM anon;
