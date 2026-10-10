-- Real platform configuration and durable activity history. No credentials belong here.
CREATE TABLE IF NOT EXISTS public.platform_configuration (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  maintenance_enabled boolean NOT NULL DEFAULT false,
  maintenance_message text NOT NULL DEFAULT 'The platform is undergoing scheduled maintenance. Please try again shortly.',
  support_email text NOT NULL DEFAULT '',
  metrics_stale_minutes integer NOT NULL DEFAULT 60 CHECK(metrics_stale_minutes BETWEEN 5 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.platform_configuration(id) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.platform_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_configuration FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.platform_configuration TO service_role;

CREATE TABLE IF NOT EXISTS public.system_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid, school_name text, user_id uuid, user_name text, actor_role text,
  action text NOT NULL, message text NOT NULL, category text NOT NULL,
  level text NOT NULL DEFAULT 'info', status text NOT NULL DEFAULT 'success',
  details jsonb NOT NULL DEFAULT '{}', ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Snapshots deliberately have no foreign keys: deletion must not erase history.
CREATE INDEX IF NOT EXISTS system_activity_events_time_idx ON public.system_activity_events(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS system_activity_events_school_idx ON public.system_activity_events(school_id,created_at DESC);
ALTER TABLE public.system_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_activity_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.system_activity_events TO service_role;

CREATE OR REPLACE FUNCTION public.fn_operations_actor()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id text;
BEGIN
  IF auth.uid() IS NOT NULL THEN RETURN auth.uid(); END IF;
  -- Only a server holding the service credential may supply a verified actor.
  IF auth.role()='service_role' THEN
    v_id := nullif(current_setting('request.headers',true),'')::jsonb->>'x-kryin-actor-id';
    IF v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id::uuid AND is_active AND deleted_at IS NULL)
    THEN RETURN v_id::uuid; END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_redact_activity(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_result jsonb; v_key text; v_value jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value)='object' THEN
    v_result := '{}';
    FOR v_key,v_value IN SELECT * FROM jsonb_each(p_value) LOOP
      v_result := v_result || jsonb_build_object(v_key,CASE
        WHEN v_key ~* '(password|passwd|(^|_)pin($|_)|(^|_)otp($|_)|token|secret|hash|authorization|cookie|private_key|api_key|code_challenge|push_endpoint|endpoint_url|p256dh|(^|_)auth($|_))' THEN '"[REDACTED]"'::jsonb
        ELSE public.fn_redact_activity(v_value) END);
    END LOOP;
    RETURN v_result;
  ELSIF jsonb_typeof(p_value)='array' THEN
    SELECT coalesce(jsonb_agg(public.fn_redact_activity(value)),'[]') INTO v_result FROM jsonb_array_elements(p_value);
    RETURN v_result;
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_require_platform_superadmin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL)
    OR NOT public.has_role(auth.uid(),'superadmin') THEN
    RAISE EXCEPTION 'Active superadmin access is required' USING ERRCODE='42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_platform_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('maintenance_enabled',maintenance_enabled,
    'maintenance_message',maintenance_message,'support_email',support_email,'updated_at',updated_at)
  FROM public.platform_configuration WHERE id;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_platform_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  RETURN (SELECT to_jsonb(c) FROM public.platform_configuration c WHERE id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_platform_settings(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.platform_configuration%ROWTYPE;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k NOT IN ('maintenance_enabled','maintenance_message','support_email','metrics_stale_minutes')) THEN
    RAISE EXCEPTION 'Unknown or unsupported platform setting';
  END IF;
  SELECT * INTO v_row FROM public.platform_configuration WHERE id FOR UPDATE;
  IF p_patch ? 'maintenance_enabled' THEN
    IF jsonb_typeof(p_patch->'maintenance_enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid maintenance flag'; END IF;
    v_row.maintenance_enabled := (p_patch->>'maintenance_enabled')::boolean;
  END IF;
  IF p_patch ? 'maintenance_message' THEN
    IF jsonb_typeof(p_patch->'maintenance_message') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid maintenance message'; END IF;
    v_row.maintenance_message := btrim(p_patch->>'maintenance_message');
  END IF;
  IF length(v_row.maintenance_message) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Maintenance message must contain 1 to 1000 characters'; END IF;
  IF p_patch ? 'support_email' THEN
    IF jsonb_typeof(p_patch->'support_email') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid support email'; END IF;
    v_row.support_email := btrim(p_patch->>'support_email');
  END IF;
  IF length(v_row.support_email)>254 OR (v_row.support_email<>'' AND v_row.support_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Invalid support email'; END IF;
  IF p_patch ? 'metrics_stale_minutes' THEN
    IF jsonb_typeof(p_patch->'metrics_stale_minutes') IS DISTINCT FROM 'number' OR (p_patch->>'metrics_stale_minutes') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid metrics threshold'; END IF;
    v_row.metrics_stale_minutes := (p_patch->>'metrics_stale_minutes')::integer;
  END IF;
  IF v_row.metrics_stale_minutes NOT BETWEEN 5 AND 1440 THEN RAISE EXCEPTION 'Metrics threshold must be between 5 and 1440 minutes'; END IF;
  UPDATE public.platform_configuration SET maintenance_enabled=v_row.maintenance_enabled,
    maintenance_message=v_row.maintenance_message,support_email=v_row.support_email,
    metrics_stale_minutes=v_row.metrics_stale_minutes,updated_by=auth.uid(),updated_at=now() WHERE id;
  PERFORM public.fn_reconcile_system_alerts();
  RETURN public.fn_get_platform_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_platform_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid := public.fn_operations_actor();
BEGIN
  IF v_actor IS NOT NULL AND NOT public.has_role(v_actor,'superadmin')
    AND (SELECT maintenance_enabled FROM public.platform_configuration WHERE id) THEN
    RAISE EXCEPTION 'Platform maintenance is in progress; school changes are paused' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_capture_system_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_row jsonb; v_actor uuid := public.fn_operations_actor();
  v_school uuid; v_school_name text; v_actor_name text; v_actor_role text;
  v_fields text[]; v_target text; v_action text; v_source text; v_headers jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN v_old := public.fn_redact_activity(to_jsonb(OLD)); END IF;
  IF TG_OP<>'DELETE' THEN v_new := public.fn_redact_activity(to_jsonb(NEW)); END IF;
  v_row := coalesce(v_new,v_old);
  IF TG_OP='UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(to_jsonb(NEW) || to_jsonb(OLD)) k
      WHERE to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k AND k NOT IN ('updated_at','last_seen_at','last_login_at');
    IF coalesce(cardinality(v_fields),0)=0 THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='schools' THEN v_school := (v_row->>'id')::uuid;
  ELSE v_school := nullif(v_row->>'school_id','')::uuid; END IF;
  IF v_school IS NULL AND TG_TABLE_NAME='user_roles' THEN
    SELECT school_id INTO v_school FROM public.profiles WHERE id=(v_row->>'user_id')::uuid;
  END IF;
  SELECT name INTO v_school_name FROM public.schools WHERE id=v_school;
  IF TG_TABLE_NAME='schools' THEN v_school_name := v_row->>'name'; END IF;
  SELECT full_name,role INTO v_actor_name,v_actor_role FROM public.profiles WHERE id=v_actor;
  IF TG_TABLE_NAME='profiles' AND TG_OP='DELETE' AND v_row->>'id'=v_actor::text THEN
    v_actor_name := v_row->>'full_name'; v_actor_role := v_row->>'role';
  END IF;
  v_target := coalesce(nullif(v_row->>'full_name',''),nullif(v_row->>'name',''),nullif(v_row->>'title',''),v_row->>'id','record');
  IF TG_TABLE_NAME='user_roles' THEN
    SELECT coalesce(full_name,'User') || ' (' || coalesce(v_row->>'role','role') || ')' INTO v_target FROM public.profiles WHERE id=(v_row->>'user_id')::uuid;
  END IF;
  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  IF TG_OP='UPDATE' AND v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NOT NULL THEN v_action := TG_TABLE_NAME || '.delete'; END IF;
  v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  v_source := CASE WHEN auth.uid() IS NOT NULL THEN 'authenticated_request'
    WHEN auth.role()='service_role' AND v_actor IS NOT NULL THEN 'server_request'
    WHEN auth.role()='service_role' THEN 'system_service' ELSE 'database_session' END;
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,details,user_agent)
  VALUES(v_school,v_school_name,v_actor,coalesce(v_actor_name,CASE WHEN v_actor IS NULL THEN 'System / database session' ELSE v_actor::text END),coalesce(v_actor_role,'system'),
    v_action,coalesce(v_actor_name,'System / database session') || ' · ' || v_action || ' · ' || coalesce(v_target,'record'),'audit',
    jsonb_build_object('table',TG_TABLE_NAME,'record_id',v_row->>'id','target_name',v_target,'changed_fields',v_fields,
      'old_data',v_old,'new_data',v_new,'source',v_source,'database_user',session_user),v_headers->>'user-agent');
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Business data changes are captured transactionally, including direct SQL and cascades.
-- Operational queues and logs are excluded to avoid recursion and noisy per-read events.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN
      ('system_activity_events','system_logs','audit_logs','activity_logs','admin_action_audit',
       'migration_audit','dashboard_metrics','system_alerts','notifications','notification_preferences',
       'announcement_receipts','announcement_push_subscriptions','push_subscriptions','user_sessions',
       'login_attempts','password_resets','recovery_email_otp','staff_unlock_sessions','staff_pin_attempts','failed_jobs',
       'backup_logs','storage_usage','mcp_auth_requests','mcp_call_logs','mcp_clients')
    AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS capture_system_activity ON public.%I',t);
    EXECUTE format('CREATE TRIGGER capture_system_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_system_activity()',t);
    IF t <> 'platform_configuration' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS guard_platform_write ON public.%I',t);
      EXECUTE format('CREATE TRIGGER guard_platform_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_guard_platform_write()',t);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_record_client_event(p_action text,p_message text,p_category text DEFAULT 'system',
  p_level text DEFAULT 'info',p_status text DEFAULT 'success',p_details jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_headers jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'An active authenticated account is required' USING ERRCODE='42501'; END IF;
  IF p_level NOT IN ('info','warn','error') OR length(p_action) NOT BETWEEN 1 AND 120
    OR length(p_message) NOT BETWEEN 1 AND 2000 OR length(p_category) NOT BETWEEN 1 AND 60
    OR octet_length(p_details::text)>16384 THEN RAISE EXCEPTION 'Invalid client event'; END IF;
  v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,user_agent)
  VALUES(v_profile.school_id,(SELECT name FROM public.schools WHERE id=v_profile.school_id),v_profile.id,v_profile.full_name,
    v_profile.role,p_action,p_message,p_category,p_level,left(p_status,40),
    public.fn_redact_activity(coalesce(p_details,'{}')) || jsonb_build_object('source','browser_report'),v_headers->>'user-agent');
END;
$$;

-- Bring canonical security / AI / activity events into the same durable feed.
CREATE OR REPLACE FUNCTION public.fn_capture_operation_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row jsonb:=to_jsonb(NEW); v_actor uuid; v_school uuid; v_status text; v_name text; v_role text; v_action text;
BEGIN
  v_actor := coalesce(nullif(v_row->>'actor_id','')::uuid,nullif(v_row->>'user_id','')::uuid,public.fn_operations_actor());
  v_school := nullif(v_row->>'school_id','')::uuid;
  SELECT full_name,role INTO v_name,v_role FROM public.profiles WHERE id=v_actor;
  v_action := coalesce(v_row->>'tool_name',v_row->>'action','system event');
  IF TG_TABLE_NAME='audit_logs' THEN v_action := coalesce(v_row->>'table_name','record') || '.' || v_action; END IF;
  v_status := coalesce(v_row->>'outcome',v_row->>'status','success');
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=v_row THEN RETURN NEW; END IF;
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,ip_address,user_agent)
  VALUES(v_school,(SELECT name FROM public.schools WHERE id=v_school),v_actor,coalesce(v_name,'System / unknown actor'),coalesce(v_role,v_row->>'actor_role','system'),
    v_action,coalesce(v_name,'System / unknown actor') || ' · ' || v_action || ' · ' || v_status,
    CASE WHEN TG_TABLE_NAME='mcp_call_logs' THEN 'ai' ELSE 'security' END,
    CASE WHEN v_status IN ('failed','denied','error') THEN 'warn' ELSE 'info' END,v_status,
    public.fn_redact_activity(v_row) || jsonb_build_object('source',TG_TABLE_NAME,'origin_id',v_row->>'id'),
    v_row->>'ip_address',v_row->>'user_agent');
  RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['admin_action_audit','activity_logs','audit_logs','mcp_call_logs'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS capture_operation_log ON public.%I',t);
      EXECUTE format('CREATE TRIGGER capture_operation_log AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_operation_log()',t);
      -- Retain existing events, including historical security actions omitted by the old screen.
      EXECUTE format($backfill$
        INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,created_at)
        SELECT nullif(r->>'school_id','')::uuid,s.name,p.id,coalesce(p.full_name,'System / unknown actor'),coalesce(p.role,r->>'actor_role','system'),
          coalesce(r->>'tool_name',r->>'action','system event'),coalesce(p.full_name,'System / unknown actor') || ' · ' || coalesce(r->>'tool_name',r->>'action','system event'),
          CASE WHEN %L='mcp_call_logs' THEN 'ai' ELSE 'security' END,'info',coalesce(r->>'outcome',r->>'status','success'),
          public.fn_redact_activity(r) || jsonb_build_object('source',%L,'origin_id',r->>'id'),coalesce((r->>'created_at')::timestamptz,now())
        FROM (SELECT to_jsonb(x) r FROM public.%I x) rows
        LEFT JOIN public.profiles p ON p.id=coalesce(nullif(r->>'actor_id','')::uuid,nullif(r->>'user_id','')::uuid)
        LEFT JOIN public.schools s ON s.id=nullif(r->>'school_id','')::uuid
        WHERE NOT EXISTS(SELECT 1 FROM public.system_activity_events e WHERE e.details->>'source'=%L AND e.details->>'origin_id'=r->>'id')
      $backfill$,t,t,t,t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_system_activity(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0,
  p_search text DEFAULT '',p_level text DEFAULT '',p_school uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_school uuid; v_super boolean; v_result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Active administrator access is required'; END IF;
  v_super := public.has_role(auth.uid(),'superadmin');
  IF NOT v_super AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  v_school := CASE WHEN v_super THEN p_school ELSE public.get_auth_school_id() END;
  IF NOT v_super AND v_school IS NULL THEN RAISE EXCEPTION 'School membership is required'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO v_result FROM (
    SELECT * FROM (
      SELECT id,school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,ip_address,user_agent,created_at FROM public.system_activity_events
      UNION ALL
      SELECT l.id,l.school_id,s.name,l.user_id,coalesce(p.full_name,CASE WHEN l.user_id IS NULL THEN 'System (legacy)' ELSE 'Unknown actor' END),p.role,
        l.action,l.message,l.category,l.level,l.status,public.fn_redact_activity(coalesce(l.details,'{}')) || jsonb_build_object('source','legacy_system_log'),l.ip_address,l.user_agent,l.created_at
      FROM public.system_logs l LEFT JOIN public.schools s ON s.id=l.school_id LEFT JOIN public.profiles p ON p.id=l.user_id
    ) events WHERE (v_school IS NULL OR school_id=v_school) AND (p_level='' OR level=p_level)
      AND (p_search='' OR message ILIKE '%' || left(p_search,200) || '%' OR action ILIKE '%' || left(p_search,200) || '%' OR user_name ILIKE '%' || left(p_search,200) || '%')
    ORDER BY created_at DESC,id DESC LIMIT greatest(1,least(p_limit,200)) OFFSET greatest(0,least(p_offset,100000))
  ) r;
  RETURN v_result;
END;
$$;

-- Fix global cache upserts: the old UNIQUE(school_id,metric_key) admits duplicate NULL school IDs.
DELETE FROM public.dashboard_metrics d USING (
  SELECT id,row_number() OVER(PARTITION BY metric_key ORDER BY updated_at DESC,id DESC) n
  FROM public.dashboard_metrics WHERE school_id IS NULL
) duplicate WHERE d.id=duplicate.id AND duplicate.n>1;
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_metrics_global_key_idx ON public.dashboard_metrics(metric_key) WHERE school_id IS NULL;

CREATE OR REPLACE FUNCTION public.refresh_dashboard_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rev numeric; v_mrr numeric; v_values jsonb; k text; v numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NOT NULL THEN PERFORM public.fn_require_platform_superadmin(); END IF;
  -- Prevent concurrent page refreshes / scheduler runs from duplicating work.
  PERFORM pg_advisory_xact_lock(hashtext('kryin-platform-metrics'));
  IF EXISTS(SELECT 1 FROM public.transactions WHERE status='completed') THEN
    SELECT coalesce(sum(CASE WHEN type='refund' THEN -amount ELSE amount END),0),
      coalesce(sum(CASE WHEN created_at>=date_trunc('month',now()) THEN CASE WHEN type='refund' THEN -amount ELSE amount END ELSE 0 END),0)
      INTO v_rev,v_mrr FROM public.transactions WHERE status='completed';
  ELSE
    SELECT coalesce(sum(amount),0),coalesce(sum(CASE WHEN created_at>=date_trunc('month',now()) THEN amount ELSE 0 END),0)
      INTO v_rev,v_mrr FROM public.invoices WHERE status='paid' AND deleted_at IS NULL;
  END IF;
  v_values := jsonb_build_object(
    'total_schools',(SELECT count(*) FROM public.schools WHERE deleted_at IS NULL),
    'total_students',(SELECT count(*) FROM public.profiles p WHERE p.deleted_at IS NULL AND p.is_active AND (p.role IN ('student','Student','Parent/Student') OR public.has_role(p.id,'student'))),
    'total_teachers',(SELECT count(*) FROM public.profiles p WHERE p.deleted_at IS NULL AND p.is_active AND (p.role='teacher' OR public.has_role(p.id,'teacher'))),
    'total_admins',(SELECT count(*) FROM public.profiles p WHERE p.deleted_at IS NULL AND p.is_active AND (p.role IN ('admin','superadmin') OR public.has_role(p.id,'admin') OR public.has_role(p.id,'superadmin'))),
    'total_employees',(SELECT count(*) FROM public.employees WHERE deleted_at IS NULL),
    'total_revenue',v_rev,'mrr',v_mrr,'active_subscriptions',(SELECT count(*) FROM public.school_subscriptions WHERE status='active'));
  FOR k,v IN SELECT key,value::text::numeric FROM jsonb_each(v_values) LOOP
    INSERT INTO public.dashboard_metrics(school_id,metric_key,metric_value,updated_at) VALUES(NULL,k,v,now())
    ON CONFLICT(metric_key) WHERE school_id IS NULL DO UPDATE SET previous_value=public.dashboard_metrics.metric_value,metric_value=EXCLUDED.metric_value,updated_at=now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_system_alerts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config public.platform_configuration%ROWTYPE; v_latest timestamptz; v_message text; v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NOT NULL THEN PERFORM public.fn_require_platform_superadmin(); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kryin-platform-alerts'));
  SELECT * INTO v_config FROM public.platform_configuration WHERE id;
  -- Recognize the existing platform alerts; other alerts are left intact.
  IF NOT v_config.maintenance_enabled THEN
    UPDATE public.system_alerts SET is_resolved=true,resolved_at=now(),resolved_by=auth.uid()
      WHERE school_id IS NULL AND category='maintenance' AND title='Platform maintenance mode enabled' AND NOT is_resolved;
  ELSE
    SELECT id INTO v_id FROM public.system_alerts WHERE school_id IS NULL AND category='maintenance' AND title='Platform maintenance mode enabled' AND NOT is_resolved ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NULL THEN INSERT INTO public.system_alerts(severity,category,title,message) VALUES('warning','maintenance','Platform maintenance mode enabled',v_config.maintenance_message);
    ELSE UPDATE public.system_alerts SET message=v_config.maintenance_message WHERE id=v_id; END IF;
  END IF;
  SELECT min(updated_at) INTO v_latest FROM public.dashboard_metrics WHERE school_id IS NULL;
  IF v_latest IS NOT NULL AND v_latest>=now()-make_interval(mins=>v_config.metrics_stale_minutes) THEN
    UPDATE public.system_alerts SET is_resolved=true,resolved_at=now(),resolved_by=auth.uid()
      WHERE school_id IS NULL AND category='metrics' AND title='Dashboard metrics are stale' AND NOT is_resolved;
  ELSE
    v_message := CASE WHEN v_latest IS NULL THEN 'Platform metrics have never been refreshed.'
      ELSE 'The latest platform metric refresh is ' || floor(extract(epoch FROM now()-v_latest)/60)::text || ' minute(s) old.' END;
    v_id := NULL;
    SELECT id INTO v_id FROM public.system_alerts WHERE school_id IS NULL AND category='metrics' AND title='Dashboard metrics are stale' AND NOT is_resolved ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NULL THEN INSERT INTO public.system_alerts(severity,category,title,message) VALUES('critical','metrics','Dashboard metrics are stale',v_message);
    ELSE UPDATE public.system_alerts SET message=v_message WHERE id=v_id; END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_school_ai_enabled(p_school uuid,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  UPDATE public.schools SET ai_connections_enabled=p_enabled WHERE id=p_school AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'School not found'; END IF;
  IF NOT p_enabled AND to_regclass('public.mcp_grants') IS NOT NULL THEN
    UPDATE public.mcp_grants SET revoked_at=now(),refresh_hash=NULL,teacher_session_id=NULL,teacher_read_until=NULL WHERE school_id=p_school AND revoked_at IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_platform_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_scheduler boolean:=false;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=''kryin-platform-metrics'' AND active)' INTO v_scheduler;
  END IF;
  RETURN jsonb_build_object('checked_at',clock_timestamp(),'metrics_updated_at',
    (SELECT min(updated_at) FROM public.dashboard_metrics WHERE school_id IS NULL),
    'scheduler_enabled',v_scheduler,'active_alerts',(SELECT count(*) FROM public.system_alerts WHERE NOT is_resolved),
    'errors_last_hour',(SELECT count(*) FROM public.system_activity_events WHERE level='error' AND created_at>now()-interval '1 hour'),
    'schools',(SELECT count(*) FROM public.schools WHERE deleted_at IS NULL),
    'users',(SELECT count(*) FROM public.profiles WHERE is_active AND deleted_at IS NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_resolve_system_alert(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_alert public.system_alerts%ROWTYPE; v_stale integer;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  SELECT * INTO v_alert FROM public.system_alerts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alert not found'; END IF;
  IF v_alert.school_id IS NULL AND v_alert.category='maintenance'
    AND v_alert.title='Platform maintenance mode enabled'
    AND (SELECT maintenance_enabled FROM public.platform_configuration WHERE id) THEN
    RAISE EXCEPTION 'Disable maintenance in Settings before resolving this alert';
  END IF;
  SELECT metrics_stale_minutes INTO v_stale FROM public.platform_configuration WHERE id;
  IF v_alert.school_id IS NULL AND v_alert.category='metrics' AND v_alert.title='Dashboard metrics are stale'
    AND NOT EXISTS(SELECT 1 FROM public.dashboard_metrics WHERE school_id IS NULL HAVING min(updated_at)>=now()-make_interval(mins=>v_stale)) THEN
    RAISE EXCEPTION 'Refresh metrics in Settings before resolving this alert';
  END IF;
  UPDATE public.system_alerts SET is_resolved=true,resolved_by=auth.uid(),resolved_at=now() WHERE id=p_id;
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,details)
  SELECT v_alert.school_id,(SELECT name FROM public.schools WHERE id=v_alert.school_id),p.id,p.full_name,p.role,
    'system_alerts.resolve',p.full_name || ' resolved ' || v_alert.title,'system',
    jsonb_build_object('source','authenticated_request','record_id',p_id,'target_name',v_alert.title)
  FROM public.profiles p WHERE id=auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_operations_actor(),public.fn_redact_activity(jsonb),public.fn_require_platform_superadmin(),
  public.fn_guard_platform_write(),public.fn_capture_system_activity(),public.fn_platform_status(),public.fn_get_platform_settings(),
  public.fn_update_platform_settings(jsonb),public.fn_record_client_event(text,text,text,text,text,jsonb),
  public.fn_get_system_activity(integer,integer,text,text,uuid),public.refresh_dashboard_metrics(),public.fn_reconcile_system_alerts(),
  public.fn_set_school_ai_enabled(uuid,boolean),public.fn_capture_operation_log(),public.fn_platform_health(),public.fn_resolve_system_alert(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_platform_status(),public.fn_get_platform_settings(),public.fn_update_platform_settings(jsonb),
  public.fn_record_client_event(text,text,text,text,text,jsonb),public.fn_get_system_activity(integer,integer,text,text,uuid),
  public.refresh_dashboard_metrics(),public.fn_reconcile_system_alerts(),public.fn_set_school_ai_enabled(uuid,boolean),public.fn_platform_health(),public.fn_resolve_system_alert(uuid) TO authenticated,service_role;
-- Application accounts must not erase or rewrite evidence through a console request.
REVOKE UPDATE,DELETE ON public.system_logs FROM authenticated,anon;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs','activity_logs','admin_action_audit'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('REVOKE UPDATE,DELETE ON public.%I FROM authenticated,anon',t); END IF;
  END LOOP;
END $$;

SELECT public.refresh_dashboard_metrics();
SELECT public.fn_reconcile_system_alerts();

-- Install a scheduler only when pg_cron is already enabled. No fake scheduler status.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('kryin-platform-metrics','*/5 * * * *','SELECT public.refresh_dashboard_metrics(); SELECT public.fn_reconcile_system_alerts();');
  END IF;
END;
$$;
NOTIFY pgrst,'reload schema';
