-- Lock down SECURITY DEFINER admin functions: only service_role may invoke directly.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'fn_recompute_school_status','fn_billing_run','fn_archive_school',
        'fn_generate_invoice','fn_restore_school','fn_manual_unlock',
        'fn_mark_invoice_paid','fn_extend_due_date','refresh_dashboard_metrics',
        'sync_profile_user_role','sync_user_membership','handle_new_user',
        'handle_updated_at','prevent_self_role_or_tenant_change',
        'reset_recovery_email_verified'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Hide internal-only tables from the GraphQL schema for signed-in users.
-- These tables are accessed via SECURITY DEFINER helpers, edge functions, or service_role only.
REVOKE SELECT ON public.user_roles FROM authenticated, anon;
REVOKE SELECT ON public.password_resets FROM authenticated, anon;
REVOKE SELECT ON public.password_recovery_audit FROM authenticated, anon;
REVOKE SELECT ON public.recovery_email_otp FROM authenticated, anon;
REVOKE SELECT ON public.failed_jobs FROM authenticated, anon;
REVOKE SELECT ON public.migration_audit FROM authenticated, anon;
REVOKE SELECT ON public.login_attempts FROM authenticated, anon;
REVOKE SELECT ON public.admin_action_audit FROM authenticated, anon;
REVOKE SELECT ON public.audit_logs FROM authenticated, anon;
REVOKE SELECT ON public.backup_logs FROM authenticated, anon;
REVOKE SELECT ON public.school_backups FROM authenticated, anon;
REVOKE SELECT ON public.subscription_events FROM authenticated, anon;
REVOKE SELECT ON public.api_keys FROM authenticated, anon;