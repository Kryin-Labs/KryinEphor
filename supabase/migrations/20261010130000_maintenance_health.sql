-- Public availability contains only the maintenance notice, never administrative data.
GRANT EXECUTE ON FUNCTION public.fn_platform_status() TO anon;

-- Browser-measured request totals are separate from authoritative audit evidence.
CREATE TABLE IF NOT EXISTS public.app_request_metrics (
  user_id uuid NOT NULL, school_id uuid, minute timestamptz NOT NULL,
  requests bigint NOT NULL DEFAULT 0, failures bigint NOT NULL DEFAULT 0,
  duration_ms numeric NOT NULL DEFAULT 0, last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,minute)
);
CREATE INDEX IF NOT EXISTS app_request_metrics_time_idx ON public.app_request_metrics(minute DESC,school_id);
ALTER TABLE public.app_request_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_request_metrics FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public.app_request_metrics TO service_role;

CREATE TABLE IF NOT EXISTS public.platform_infrastructure_snapshot (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), measured_at timestamptz NOT NULL, payload jsonb NOT NULL
);
ALTER TABLE public.platform_infrastructure_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_infrastructure_snapshot FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.platform_infrastructure_snapshot TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_request_metrics(p_requests integer,p_failures integer,p_duration_ms numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_school uuid; v_minute timestamptz:=date_trunc('minute',now());
BEGIN
  SELECT school_id INTO v_school FROM public.profiles WHERE id=auth.uid() AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active authenticated user required' USING ERRCODE='42501'; END IF;
  IF p_requests IS NULL OR p_requests NOT BETWEEN 1 AND 1000 OR p_failures IS NULL OR p_failures NOT BETWEEN 0 AND p_requests
    OR p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 0 AND p_requests::numeric*120000 THEN RAISE EXCEPTION 'Invalid request measurements'; END IF;
  INSERT INTO public.app_request_metrics(user_id,school_id,minute,requests,failures,duration_ms)
    VALUES(auth.uid(),v_school,v_minute,p_requests,p_failures,p_duration_ms)
    ON CONFLICT(user_id,minute) DO UPDATE SET requests=app_request_metrics.requests+excluded.requests,
      failures=app_request_metrics.failures+excluded.failures,duration_ms=app_request_metrics.duration_ms+excluded.duration_ms,last_seen_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_operations_storage_inventory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_result jsonb; v_uploads jsonb;
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RETURN jsonb_build_object('status','unavailable','reason','Storage catalog is not installed');
  END IF;
  -- Read catalog metadata only. Never change Supabase-owned storage records.
  EXECUTE $q$
    WITH objects AS (
      SELECT o.bucket_id,CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint END AS bytes,
        coalesce(s.id,a.school_id,p.school_id) AS school_id,o.created_at
      FROM storage.objects o
      LEFT JOIN public.schools s ON s.id::text=split_part(o.name,'/',1)
      LEFT JOIN public.announcements a ON o.bucket_id='announcement-images' AND a.id::text=split_part(o.name,'/',1)
      LEFT JOIN public.profiles p ON p.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')
    ), school_files AS (
      SELECT school_id,count(*) AS files,coalesce(sum(bytes),0) AS bytes,count(*) FILTER(WHERE bytes IS NULL) AS unknown_size_files
      FROM objects GROUP BY school_id
    ), bucket_files AS (
      SELECT b.id,b.name,b.public,b.file_size_limit,count(o.bucket_id) AS files,coalesce(sum(o.bytes),0) AS bytes,
        count(o.bucket_id) FILTER(WHERE o.bytes IS NULL) AS unknown_size_files,max(o.created_at) AS last_upload_at
      FROM storage.buckets b LEFT JOIN objects o ON o.bucket_id=b.id GROUP BY b.id,b.name,b.public,b.file_size_limit
    ) SELECT jsonb_build_object('status','available','files',(SELECT count(*) FROM objects),
      'bytes',(SELECT coalesce(sum(bytes),0) FROM objects),'unknown_size_files',(SELECT count(*) FROM objects WHERE bytes IS NULL),
      'unassigned_files',(SELECT count(*) FROM objects WHERE school_id IS NULL),
      'unassigned_bytes',(SELECT coalesce(sum(bytes),0) FROM objects WHERE school_id IS NULL),
      'schools',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM school_files f),'[]'::jsonb),
      'buckets',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.name) FROM bucket_files b),'[]'::jsonb))
  $q$ INTO v_result;
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    EXECUTE 'SELECT jsonb_build_object(''count'',count(*),''bytes'',coalesce(sum(in_progress_size),0),''oldest_at'',min(created_at)) FROM storage.s3_multipart_uploads' INTO v_uploads;
  END IF;
  RETURN v_result||jsonb_build_object('uploads',v_uploads);
EXCEPTION WHEN insufficient_privilege THEN
  RETURN jsonb_build_object('status','unavailable','reason','Storage catalog permissions are unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_platform_health_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_storage jsonb; v_database jsonb; v_tables jsonb; v_schools jsonb; v_requests jsonb;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  v_storage:=public.fn_operations_storage_inventory();
  SELECT jsonb_build_object('status','reachable','size_bytes',pg_database_size(current_database()),
    'max_connections',current_setting('max_connections')::integer,'connections',d.numbackends,
    'active_connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active'),
    'idle_in_transaction',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'),
    'waiting_connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'),
    'cache_hit_percent',round(100.0*d.blks_hit/nullif(d.blks_hit+d.blks_read,0),2),
    'commits',d.xact_commit,'rollbacks',d.xact_rollback,'deadlocks',d.deadlocks,
    'temp_files',d.temp_files,'temp_bytes',d.temp_bytes,'stats_reset_at',d.stats_reset,
    'database_started_at',pg_postmaster_start_time(),
    'temporary_relation_bytes',(SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c WHERE c.relpersistence='t' AND c.relkind='r'))
    INTO v_database FROM pg_stat_database d WHERE d.datname=current_database();
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.bytes DESC),'[]') INTO v_tables FROM (
    SELECT c.relname AS name,pg_total_relation_size(c.oid) AS bytes,pg_indexes_size(c.oid) AS index_bytes,
      coalesce(st.n_live_tup,0) AS estimated_rows,coalesce(st.n_dead_tup,0) AS estimated_dead_rows,
      st.last_autovacuum,st.last_autoanalyze
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_stat_user_tables st ON st.relid=c.oid
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 40
  ) t;
  SELECT jsonb_build_object('requests',coalesce(sum(requests),0),'failures',coalesce(sum(failures),0),
    'average_ms',round(sum(duration_ms)/nullif(sum(requests),0),1),'reporting_users',count(DISTINCT user_id),
    'last_report_at',max(last_seen_at),'window_minutes',60,'source','browser_measurements') INTO v_requests
    FROM public.app_request_metrics WHERE minute>=now()-interval '1 hour';
  WITH people AS (
    SELECT school_id,count(*) AS users,count(*) FILTER(WHERE role='student') AS students,
      count(*) FILTER(WHERE role='teacher' OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.id AND ur.role='teacher')) AS teachers,
      count(*) FILTER(WHERE role='parent') AS parents,count(*) FILTER(WHERE role='admin') AS admins
    FROM public.profiles p WHERE is_active AND deleted_at IS NULL GROUP BY school_id
  ), requests AS (
    SELECT school_id,sum(requests) AS requests,sum(failures) AS failures,
      round(sum(duration_ms)/nullif(sum(requests),0),1) AS average_ms,count(DISTINCT user_id) AS reporting_users,max(last_seen_at) AS last_report_at
    FROM public.app_request_metrics WHERE minute>=now()-interval '1 hour' GROUP BY school_id
  ), activity AS (
    SELECT school_id,count(*) AS changes_24h,count(*) FILTER(WHERE level='error') AS errors_24h,
      count(*) FILTER(WHERE action='auth.session_started') AS logins_24h,max(created_at) AS last_activity_at
    FROM public.system_activity_events WHERE created_at>=now()-interval '24 hours' GROUP BY school_id
  ), school_classes AS (SELECT school_id,count(*) AS classes FROM public.classes WHERE deleted_at IS NULL GROUP BY school_id),
  school_staff AS (SELECT school_id,count(*) AS staff FROM public.employees WHERE deleted_at IS NULL GROUP BY school_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,
    'subscription_status',to_jsonb(s)->>'subscription_status','student_limit',(to_jsonb(s)->>'max_students')::integer,
    'ai_enabled',s.ai_connections_enabled,'users',coalesce(p.users,0),'students',coalesce(p.students,0),
    'teachers',coalesce(p.teachers,0),'parents',coalesce(p.parents,0),'admins',coalesce(p.admins,0),
    'classes',coalesce(c.classes,0),'staff',coalesce(e.staff,0),
    'files',CASE WHEN v_storage->>'status'='available' THEN coalesce((f->>'files')::bigint,0) END,
    'file_bytes',CASE WHEN v_storage->>'status'='available' THEN coalesce((f->>'bytes')::bigint,0) END,
    'unknown_size_files',CASE WHEN v_storage->>'status'='available' THEN coalesce((f->>'unknown_size_files')::bigint,0) END,
    'requests',coalesce(r.requests,0),'request_failures',coalesce(r.failures,0),'average_ms',r.average_ms,
    'reporting_users',coalesce(r.reporting_users,0),'last_report_at',r.last_report_at,
    'changes_24h',coalesce(a.changes_24h,0),'errors_24h',coalesce(a.errors_24h,0),'logins_24h',coalesce(a.logins_24h,0),
    'last_activity_at',a.last_activity_at) ORDER BY s.name),'[]') INTO v_schools
  FROM public.schools s LEFT JOIN people p ON p.school_id=s.id LEFT JOIN requests r ON r.school_id=s.id
    LEFT JOIN activity a ON a.school_id=s.id LEFT JOIN school_classes c ON c.school_id=s.id LEFT JOIN school_staff e ON e.school_id=s.id
    LEFT JOIN LATERAL (SELECT value AS f FROM jsonb_array_elements(coalesce(v_storage->'schools','[]')) WHERE value->>'school_id'=s.id::text) sf ON true
  WHERE s.deleted_at IS NULL;
  RETURN public.fn_platform_health()||jsonb_build_object('database',v_database,'storage',v_storage,'tables',v_tables,
    'school_details',v_schools,'requests',v_requests,'infrastructure',
      (SELECT payload||jsonb_build_object('measured_at',measured_at,'fresh',measured_at>now()-interval '150 seconds') FROM public.platform_infrastructure_snapshot WHERE id),
    'cache',jsonb_build_object(
      'metric_rows',(SELECT count(*) FROM public.dashboard_metrics),'metric_bytes',pg_total_relation_size('public.dashboard_metrics'),
      'request_metric_bytes',pg_total_relation_size('public.app_request_metrics'),'request_retention_days',7),
    'recent_errors',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (
      SELECT action,message,school_name,created_at FROM public.system_activity_events WHERE level='error' ORDER BY created_at DESC LIMIT 5) e),'[]'::jsonb));
END;
$$;

-- Exact logical row sizes are calculated only on demand for the selected school.
-- They exclude shared database indexes, free space, and storage-provider billing.
CREATE OR REPLACE FUNCTION public.fn_school_health(p_school uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_table record; v_rows bigint; v_bytes bigint; v_tables jsonb:='[]'; v_total numeric:=0;
BEGIN
  PERFORM public.fn_require_platform_superadmin();
  IF NOT EXISTS(SELECT 1 FROM public.schools WHERE id=p_school AND deleted_at IS NULL) THEN RAISE EXCEPTION 'School not found'; END IF;
  FOR v_table IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
    ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='school_id' AND c.data_type='uuid' AND t.table_type='BASE TABLE'
    ORDER BY c.table_name LOOP
    EXECUTE format('SELECT count(*),coalesce(sum(pg_column_size(t)),0) FROM public.%I t WHERE school_id=$1',v_table.table_name)
      INTO v_rows,v_bytes USING p_school;
    v_total:=v_total+v_bytes;
    v_tables:=v_tables||jsonb_build_array(jsonb_build_object('name',v_table.table_name,'rows',v_rows,'logical_bytes',v_bytes));
  END LOOP;
  RETURN jsonb_build_object('school_id',p_school,'checked_at',clock_timestamp(),'logical_bytes',v_total,'tables',v_tables);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_request_metrics(integer,integer,numeric),public.fn_operations_storage_inventory(),
  public.fn_platform_health_console(),public.fn_school_health(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_request_metrics(integer,integer,numeric),public.fn_platform_health_console(),public.fn_school_health(uuid) TO authenticated,service_role;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('kryin-request-metrics-retention','17 * * * *','DELETE FROM public.app_request_metrics WHERE minute<now()-interval ''7 days'';');
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
