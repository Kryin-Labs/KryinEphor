
-- ============ Profiles: tighten school-wide SELECT ============
DROP POLICY IF EXISTS tenant_select ON public.profiles;
CREATE POLICY profiles_tenant_admin_select ON public.profiles
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR id = auth.uid()
    OR (
      school_id IS NOT NULL
      AND school_id = get_auth_school_id()
      AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'receptionist'))
    )
  );

-- ============ Employees: restrict SELECT to admin/self ============
DROP POLICY IF EXISTS tenant_select ON public.employees;
CREATE POLICY employees_admin_select ON public.employees
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR profile_id = auth.uid()
    OR (
      school_id = get_auth_school_id()
      AND (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'receptionist'))
    )
  );

-- ============ Salary: restrict SELECT to admin/self ============
DROP POLICY IF EXISTS tenant_select ON public.salary;
CREATE POLICY salary_admin_select ON public.salary
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR (
      school_id = get_auth_school_id()
      AND has_role(auth.uid(),'admin')
    )
  );

-- ============ Leave requests: admin or owner ============
DROP POLICY IF EXISTS tenant_select ON public.leave_requests;
CREATE POLICY leave_requests_admin_or_owner_select ON public.leave_requests
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR (
      school_id = get_auth_school_id()
      AND (
        has_role(auth.uid(),'admin')
        OR EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = leave_requests.employee_id
            AND e.profile_id = auth.uid()
        )
      )
    )
  );

-- ============ Messages: participant-only ============
DROP POLICY IF EXISTS tenant_select ON public.messages;
CREATE POLICY messages_participant_select ON public.messages
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.thread_participants tp
      WHERE tp.thread_id = messages.thread_id
        AND tp.user_id = auth.uid()
    )
  );

-- ============ Message threads: participant-only ============
DROP POLICY IF EXISTS tenant_select ON public.message_threads;
CREATE POLICY message_threads_participant_select ON public.message_threads
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR EXISTS (
      SELECT 1 FROM public.thread_participants tp
      WHERE tp.thread_id = message_threads.id
        AND tp.user_id = auth.uid()
    )
  );

-- ============ Thread participants ============
DROP POLICY IF EXISTS tenant_select ON public.thread_participants;
CREATE POLICY thread_participants_self_or_admin_select ON public.thread_participants
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.thread_participants tp2
      WHERE tp2.thread_id = thread_participants.thread_id
        AND tp2.user_id = auth.uid()
    )
  );

-- ============ Notifications: recipient only ============
DROP POLICY IF EXISTS tenant_select ON public.notifications;
CREATE POLICY notifications_recipient_select ON public.notifications
  FOR SELECT USING (
    get_auth_role() = 'superadmin'
    OR user_id = auth.uid()
  );

-- ============ Log tables: restrict INSERT ============
DROP POLICY IF EXISTS tenant_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs
  FOR INSERT WITH CHECK (get_auth_role() = 'superadmin');

DROP POLICY IF EXISTS tenant_insert ON public.activity_logs;
CREATE POLICY activity_logs_admin_insert ON public.activity_logs
  FOR INSERT WITH CHECK (get_auth_role() = 'superadmin');

DROP POLICY IF EXISTS tenant_insert ON public.system_logs;
CREATE POLICY system_logs_admin_insert ON public.system_logs
  FOR INSERT WITH CHECK (get_auth_role() = 'superadmin');

-- ============ password_resets: self-only INSERT ============
DROP POLICY IF EXISTS self_insert ON public.password_resets;
CREATE POLICY password_resets_self_insert ON public.password_resets
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============ Recreate v_school_subscription_summary as security_invoker ============
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_viewdef('public.v_school_subscription_summary'::regclass, true) INTO v_def;
  IF v_def IS NOT NULL THEN
    EXECUTE 'DROP VIEW public.v_school_subscription_summary';
    EXECUTE 'CREATE VIEW public.v_school_subscription_summary WITH (security_invoker=true) AS ' || v_def;
    EXECUTE 'GRANT SELECT ON public.v_school_subscription_summary TO authenticated';
    EXECUTE 'GRANT ALL ON public.v_school_subscription_summary TO service_role';
  END IF;
END $$;

-- ============ GraphQL/Anon discoverability: revoke SELECT from anon on all public tables/views ============
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','f')
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', r.relname);
  END LOOP;
END $$;

-- ============ Revoke SELECT from authenticated on highly sensitive server-only tables ============
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'api_keys','webhooks','audit_logs','activity_logs','system_logs',
    'login_attempts','password_resets','recovery_email_otp',
    'password_recovery_audit','migration_audit','admin_action_audit',
    'failed_jobs','backup_logs','school_backups','data_exports',
    'subscription_events','system_alerts'
  ])
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ============ SECURITY DEFINER functions: revoke from public/anon ============
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'can_manage_recovery_email(uuid,uuid)',
    'fn_archive_school(uuid,uuid)',
    'fn_billing_run()',
    'fn_extend_due_date(uuid,integer,uuid)',
    'fn_generate_invoice(uuid)',
    'fn_manual_unlock(uuid,date,uuid)',
    'fn_mark_invoice_paid(uuid,uuid)',
    'fn_recompute_school_status(uuid)',
    'fn_restore_school(uuid,uuid)',
    'get_auth_role()',
    'get_auth_school_id()',
    'handle_new_user()',
    'handle_updated_at()',
    'has_role(uuid,text)',
    'prevent_self_role_or_tenant_change()',
    'refresh_dashboard_metrics()',
    'reset_recovery_email_verified()',
    'sync_profile_user_role()',
    'sync_user_membership()'
  ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
  END LOOP;
END $$;

-- Trigger-only / admin-only functions: also revoke from authenticated
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'handle_new_user()',
    'handle_updated_at()',
    'prevent_self_role_or_tenant_change()',
    'reset_recovery_email_verified()',
    'sync_profile_user_role()',
    'sync_user_membership()',
    'refresh_dashboard_metrics()',
    'fn_billing_run()',
    'fn_generate_invoice(uuid)',
    'fn_recompute_school_status(uuid)'
  ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Admin RPCs callable from app: keep authenticated EXECUTE but add internal role check
CREATE OR REPLACE FUNCTION public.fn_archive_school(p_school uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.schools SET archived_at=now(), subscription_status='archived' WHERE id=p_school;
  INSERT INTO public.subscription_events(school_id,event_type,actor_id) VALUES (p_school,'archived',p_actor);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_restore_school(p_school uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.schools SET archived_at=NULL, subscription_status='active',
    manual_unlock_until = CURRENT_DATE + INTERVAL '30 days' WHERE id=p_school;
  INSERT INTO public.subscription_events(school_id,event_type,actor_id) VALUES (p_school,'restored',p_actor);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_manual_unlock(p_school uuid, p_until date, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.schools SET manual_unlock_until = p_until WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'manual_unlock',p_actor,jsonb_build_object('until',p_until));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_mark_invoice_paid(p_invoice uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_school uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.invoices SET status='paid', paid_at=now() WHERE id=p_invoice
  RETURNING school_id INTO v_school;
  IF v_school IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  PERFORM public.fn_recompute_school_status(v_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (v_school,'manual_paid',p_actor,jsonb_build_object('invoice_id',p_invoice));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_extend_due_date(p_school uuid, p_days integer, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(),'superadmin') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_days <= 0 OR p_days > 365 THEN RAISE EXCEPTION 'invalid days'; END IF;
  UPDATE public.invoices SET due_date = due_date + p_days, status='pending'
    WHERE school_id=p_school AND status IN ('pending','overdue') AND deleted_at IS NULL;
  UPDATE public.schools SET next_due_date = COALESCE(next_due_date, CURRENT_DATE) + p_days
    WHERE id = p_school;
  PERFORM public.fn_recompute_school_status(p_school);
  INSERT INTO public.subscription_events(school_id,event_type,actor_id,metadata)
  VALUES (p_school,'due_extended',p_actor,jsonb_build_object('days',p_days));
END $fn$;
