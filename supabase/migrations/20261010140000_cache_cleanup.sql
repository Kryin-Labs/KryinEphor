-- Explicit cleanup only removes telemetry already outside its seven-day retention.
-- No application records, uploaded files or audit evidence are disposable here.
CREATE OR REPLACE FUNCTION public.fn_platform_cache_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_status jsonb;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  SELECT jsonb_build_object('expired_rows',count(*),
    'expired_logical_bytes',coalesce(sum(pg_column_size(m)),0),
    'retention_days',7,'checked_at',now()) INTO v_status
  FROM public.app_request_metrics m WHERE minute < now()-interval '7 days';
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cleanup_request_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_removed bigint; v_name text;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  DELETE FROM public.app_request_metrics WHERE minute < now()-interval '7 days';
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  SELECT full_name INTO v_name FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.system_activity_events(user_id,user_name,actor_role,action,message,category,details)
  VALUES(auth.uid(),v_name,'superadmin','cache.expired_requests_cleanup',
    format('Removed %s expired request measurement rows',v_removed),'system',
    jsonb_build_object('source','authenticated_request','removed_rows',v_removed,'retention_days',7));
  RETURN jsonb_build_object('removed_rows',v_removed,'retention_days',7,'completed_at',clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.fn_platform_cache_status(),public.fn_cleanup_request_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_platform_cache_status(),public.fn_cleanup_request_metrics() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
