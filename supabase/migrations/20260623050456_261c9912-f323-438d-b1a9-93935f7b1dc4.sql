
-- failed_jobs: only service role inserts
DROP POLICY IF EXISTS tenant_insert ON public.failed_jobs;
REVOKE INSERT ON public.failed_jobs FROM authenticated, anon;
GRANT ALL ON public.failed_jobs TO service_role;

-- login_attempts: keep open for anon/auth login flows, but with a real predicate
DROP POLICY IF EXISTS la_insert_anon ON public.login_attempts;
DROP POLICY IF EXISTS la_insert_auth ON public.login_attempts;
CREATE POLICY la_insert_anon ON public.login_attempts
  FOR INSERT TO anon
  WITH CHECK (ip_address IS NOT NULL);
CREATE POLICY la_insert_auth ON public.login_attempts
  FOR INSERT TO authenticated
  WITH CHECK (ip_address IS NOT NULL);
