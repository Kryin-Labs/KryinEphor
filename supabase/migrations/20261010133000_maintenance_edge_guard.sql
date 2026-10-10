-- Check before an Edge Function mutates Auth, not only after it writes public tables.
CREATE OR REPLACE FUNCTION public.fn_check_platform_access()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Active authenticated account required' USING ERRCODE='42501';
  END IF;
  IF (SELECT maintenance_enabled FROM public.platform_configuration WHERE id) AND NOT public.has_role(auth.uid(),'superadmin') THEN
    RAISE EXCEPTION 'Platform maintenance is in progress; school changes are paused' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_platform_access() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_platform_access() TO authenticated;
NOTIFY pgrst,'reload schema';
