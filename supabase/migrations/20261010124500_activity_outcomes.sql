-- Preserve explicit outcomes; old audit rows without an outcome are simply "recorded".
CREATE OR REPLACE FUNCTION public.fn_activity_outcome(p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT coalesce(nullif(p_row->>'outcome',''),nullif(p_row->>'status',''),
    CASE WHEN p_row->'detail'->>'blocked'='true' OR p_row->'metadata'->>'blocked'='true' THEN 'denied'
      WHEN coalesce(p_row->>'action','') ~* '(^|[ _])(failed|failure)($|[ _])' THEN 'failed'
      WHEN coalesce(p_row->>'action','') ~* '(^|[ _])(denied|blocked)($|[ _])' THEN 'denied'
      ELSE 'recorded' END);
$$;

CREATE OR REPLACE FUNCTION public.fn_capture_operation_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row jsonb:=to_jsonb(NEW); v_actor uuid; v_school uuid; v_status text; v_name text; v_role text; v_action text; v_target text;
BEGIN
  v_actor := coalesce(nullif(v_row->>'actor_id','')::uuid,nullif(v_row->>'user_id','')::uuid,public.fn_operations_actor());
  v_school := nullif(v_row->>'school_id','')::uuid;
  SELECT full_name,role INTO v_name,v_role FROM public.profiles WHERE id=v_actor;
  v_action := coalesce(v_row->>'tool_name',v_row->>'action','system event');
  IF TG_TABLE_NAME='audit_logs' THEN v_action := coalesce(v_row->>'table_name','record') || '.' || v_action; END IF;
  v_status := public.fn_activity_outcome(v_row);
  v_target := coalesce(v_row->'detail'->>'target_user_name',v_row->'detail'->>'target_name',v_row->'detail'->>'student_name',v_row->'metadata'->>'full_name');
  IF v_target IS NULL AND v_row->>'target_user_id' IS NOT NULL THEN SELECT full_name INTO v_target FROM public.profiles WHERE id=(v_row->>'target_user_id')::uuid; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=v_row THEN RETURN NEW; END IF;
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,ip_address,user_agent)
  VALUES(v_school,(SELECT name FROM public.schools WHERE id=v_school),v_actor,coalesce(v_name,'System / unknown actor'),coalesce(v_role,v_row->>'actor_role','system'),
    v_action,coalesce(v_name,'System / unknown actor') || ' · ' || v_action || coalesce(' · ' || v_target,'') || ' · ' || v_status,
    CASE WHEN TG_TABLE_NAME='mcp_call_logs' THEN 'ai' ELSE 'security' END,
    CASE WHEN v_status IN ('failed','error') THEN 'error' WHEN v_status IN ('denied','blocked') THEN 'warn' ELSE 'info' END,v_status,
    public.fn_redact_activity(v_row) || jsonb_build_object('source',TG_TABLE_NAME,'origin_id',v_row->>'id','target_name',v_target),
    v_row->>'ip_address',v_row->>'user_agent');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_activity_outcome(jsonb),public.fn_capture_operation_log() FROM PUBLIC,anon,authenticated;

UPDATE public.system_activity_events SET status=public.fn_activity_outcome(details),
  level=CASE WHEN public.fn_activity_outcome(details) IN ('failed','error') THEN 'error'
    WHEN public.fn_activity_outcome(details) IN ('denied','blocked') THEN 'warn' ELSE 'info' END
WHERE details->>'source' IN ('admin_action_audit','activity_logs','audit_logs','mcp_call_logs');
NOTIFY pgrst,'reload schema';
