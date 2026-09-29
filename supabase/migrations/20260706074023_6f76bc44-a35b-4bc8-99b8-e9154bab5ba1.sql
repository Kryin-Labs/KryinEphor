
-- 1) dash_stats_no_role_chk: role gate inside fn_admin_dashboard_stats
CREATE OR REPLACE FUNCTION public.fn_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_school UUID := get_auth_school_id();
  v_role TEXT := get_auth_role();
  v_students INT := 0; v_teachers INT := 0; v_classes INT := 0;
  v_month_revenue NUMERIC := 0; v_pending NUMERIC := 0; v_overdue NUMERIC := 0;
  v_paid_count INT := 0; v_pending_count INT := 0;
  v_collection_pct NUMERIC := 0;
  v_top_payers JSONB;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin','accountant','superadmin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF v_school IS NULL AND v_role <> 'superadmin' THEN
    RETURN jsonb_build_object('error','no school context');
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.profiles
   WHERE school_id = v_school AND role = 'student' AND is_active = true AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_teachers FROM public.profiles
   WHERE school_id = v_school AND role = 'teacher' AND is_active = true AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_classes FROM public.classes
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount),0) INTO v_month_revenue
    FROM public.transactions
   WHERE school_id = v_school AND type='payment' AND status='completed'
     AND created_at >= date_trunc('month', now());

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0),
         COUNT(*) FILTER (WHERE status='paid'),
         COUNT(*) FILTER (WHERE status IN ('pending','partial','overdue'))
    INTO v_pending, v_paid_count, v_pending_count
    FROM public.invoices
   WHERE school_id = v_school AND deleted_at IS NULL;

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) INTO v_overdue
    FROM public.invoices
   WHERE school_id = v_school AND status='overdue' AND deleted_at IS NULL;

  IF (v_paid_count + v_pending_count) > 0 THEN
    v_collection_pct := ROUND(v_paid_count::numeric * 100 / (v_paid_count + v_pending_count), 1);
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top_payers FROM (
    SELECT p.full_name AS name, p.id AS student_id,
           SUM(tx.amount) AS total_paid
      FROM public.transactions tx
      JOIN public.profiles p ON p.id = tx.student_id
     WHERE tx.school_id = v_school AND tx.type='payment' AND tx.status='completed'
       AND tx.created_at >= date_trunc('month', now())
     GROUP BY p.id, p.full_name
     ORDER BY total_paid DESC
     LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'students', v_students,
    'teachers', v_teachers,
    'classes', v_classes,
    'month_revenue', v_month_revenue,
    'pending_amount', v_pending,
    'overdue_amount', v_overdue,
    'paid_invoices', v_paid_count,
    'pending_invoices', v_pending_count,
    'collection_pct', v_collection_pct,
    'top_payers', v_top_payers
  );
END $function$;

-- 2) late_fees_no_role_chk: restrict to service_role
REVOKE EXECUTE ON FUNCTION public.fn_apply_late_fees() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_apply_late_fees() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_apply_late_fees() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_apply_late_fees() TO service_role;

-- 3) thread_participants_insert_arbitrary: tighten insert policy
DROP POLICY IF EXISTS tenant_insert ON public.thread_participants;
CREATE POLICY tenant_insert ON public.thread_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    get_auth_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.message_threads t
       WHERE t.id = thread_participants.thread_id
         AND t.school_id = get_auth_school_id()
         AND (
           -- thread creator can add anyone (including themselves)
           t.created_by = auth.uid()
           -- school admins can add anyone
           OR has_role(auth.uid(), 'admin')
           -- existing participants can only add themselves
           OR (
             thread_participants.user_id = auth.uid()
             AND EXISTS (
               SELECT 1 FROM public.thread_participants tp
                WHERE tp.thread_id = t.id AND tp.user_id = auth.uid()
             )
           )
         )
    )
  );

-- 4) leave_requests_insert_unscoped_employee: bind to caller's employee row
DROP POLICY IF EXISTS tenant_insert ON public.leave_requests;
CREATE POLICY tenant_insert ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    get_auth_role() = 'superadmin'
    OR (
      school_id = get_auth_school_id()
      AND (
        has_role(auth.uid(), 'admin')
        OR EXISTS (
          SELECT 1 FROM public.employees e
           WHERE e.id = leave_requests.employee_id
             AND e.profile_id = auth.uid()
             AND e.school_id = leave_requests.school_id
        )
      )
    )
  );

-- 5) memberships_admin_write_unvalidated_role: ensure role belongs to same tenant and is not a system role
DROP POLICY IF EXISTS memberships_admin_write ON public.memberships;
CREATE POLICY memberships_admin_write ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = get_auth_school_id()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'))
    AND EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = memberships.role_id
         AND r.school_id = memberships.school_id
         AND r.is_system = false
    )
  );

-- 6) SUPA_pg_graphql_anon_table_exposed: revoke anon SELECT on the only anon-exposed public object
REVOKE SELECT ON public.school_summary_metrics FROM anon;

-- 7) SUPA_anon_security_definer_function_executable:
--    revoke anon EXECUTE on all SECURITY DEFINER functions in public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon',
                   r.nspname, r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;
