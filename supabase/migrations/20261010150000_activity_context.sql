-- Save actor identity with the event, independently of later profile changes/deletion.
ALTER TABLE public.system_activity_events
  ADD COLUMN IF NOT EXISTS user_email text,
  ADD COLUMN IF NOT EXISTS user_username text,
  ADD COLUMN IF NOT EXISTS identity_source text,
  ADD COLUMN IF NOT EXISTS ip_address_source text,
  ADD COLUMN IF NOT EXISTS user_agent_source text;

CREATE OR REPLACE FUNCTION public.fn_enrich_activity_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_headers jsonb; v_session text; v_session_ip text; v_session_agent text;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id=NEW.user_id;
  IF FOUND THEN
    NEW.user_email := nullif(v_profile.email,'');
    NEW.user_username := nullif(v_profile.login_id,'');
    NEW.user_name := coalesce(nullif(NEW.user_name,''),v_profile.full_name,'Unknown actor');
    NEW.actor_role := coalesce(nullif(NEW.actor_role,''),v_profile.role,'unknown');
    NEW.identity_source := 'event_snapshot';
  ELSE
    NEW.identity_source := 'not_captured';
  END IF;
  v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  NEW.ip_address := nullif(NEW.ip_address,'');
  NEW.user_agent := nullif(NEW.user_agent,'');
  NEW.ip_address_source := CASE WHEN NEW.ip_address IS NULL THEN 'not_captured'
    WHEN NEW.details->>'source'='auth_service' THEN 'auth_session' ELSE 'recorded_event' END;
  NEW.user_agent_source := CASE WHEN NEW.user_agent IS NULL THEN 'not_captured'
    WHEN NEW.details->>'source'='auth_service' THEN 'auth_session' ELSE 'recorded_event' END;
  IF NEW.details->>'source' IS DISTINCT FROM 'auth_service' THEN
    IF auth.uid()=NEW.user_id THEN
      v_session := auth.jwt()->>'session_id';
      IF nullif(v_headers->>'user-agent','') IS NOT NULL THEN
        NEW.user_agent := left(v_headers->>'user-agent',2048);
        NEW.user_agent_source := 'request';
      END IF;
    ELSIF auth.role()='service_role' AND public.fn_operations_actor()=NEW.user_id THEN
      -- These context headers are accepted only from a verified server-side actor.
      v_session := v_headers->>'x-kryin-session-id';
      IF nullif(v_headers->>'x-kryin-user-agent','') IS NOT NULL THEN
        NEW.user_agent := left(v_headers->>'x-kryin-user-agent',2048);
        NEW.user_agent_source := 'verified_edge_request';
      END IF;
    END IF;
    IF v_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      -- Never borrow the user's latest session or another user's device/IP.
      SELECT host(s.ip),nullif(s.user_agent,'') INTO v_session_ip,v_session_agent
      FROM auth.sessions s WHERE s.id=v_session::uuid AND s.user_id=NEW.user_id;
      IF NEW.ip_address IS NULL AND v_session_ip IS NOT NULL THEN
        NEW.ip_address := v_session_ip; NEW.ip_address_source := 'auth_session';
      END IF;
      IF NEW.user_agent IS NULL AND v_session_agent IS NOT NULL THEN
        NEW.user_agent := left(v_session_agent,2048); NEW.user_agent_source := 'auth_session';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_enrich_activity_context() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enrich_activity_context ON public.system_activity_events;
CREATE TRIGGER enrich_activity_context BEFORE INSERT ON public.system_activity_events
FOR EACH ROW EXECUTE FUNCTION public.fn_enrich_activity_context();

-- Old records did not save email/login ID. Label recovery from a surviving profile
-- explicitly instead of pretending it was captured at the historical event time.
UPDATE public.system_activity_events e SET user_email=nullif(p.email,''),user_username=nullif(p.login_id,''),identity_source='profile_backfill'
FROM public.profiles p WHERE p.id=e.user_id AND e.identity_source IS NULL;
UPDATE public.system_activity_events SET
  identity_source=coalesce(identity_source,'not_captured'),
  ip_address_source=coalesce(ip_address_source,CASE WHEN nullif(ip_address,'') IS NULL THEN 'not_captured'
    WHEN details->>'source'='auth_service' THEN 'auth_session' ELSE 'recorded_event' END),
  user_agent_source=coalesce(user_agent_source,CASE WHEN nullif(user_agent,'') IS NULL THEN 'not_captured'
    WHEN details->>'source'='auth_service' THEN 'auth_session' ELSE 'recorded_event' END)
WHERE identity_source IS NULL OR ip_address_source IS NULL OR user_agent_source IS NULL;

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
      SELECT id,school_id,school_name,user_id,user_name,actor_role,action,message,category,level,status,details,ip_address,user_agent,created_at,
        user_email,user_username,identity_source,ip_address_source,user_agent_source FROM public.system_activity_events
      UNION ALL
      SELECT l.id,l.school_id,s.name,l.user_id,coalesce(p.full_name,CASE WHEN l.user_id IS NULL THEN 'System (legacy)' ELSE 'Unknown actor' END),p.role,
        l.action,l.message,l.category,l.level,l.status,public.fn_redact_activity(coalesce(l.details,'{}')) || jsonb_build_object('source','legacy_system_log'),l.ip_address,l.user_agent,l.created_at,
        nullif(p.email,''),nullif(p.login_id,''),CASE WHEN p.id IS NULL THEN 'not_captured' ELSE 'current_profile' END,
        CASE WHEN nullif(l.ip_address,'') IS NULL THEN 'not_captured' ELSE 'recorded_event' END,
        CASE WHEN nullif(l.user_agent,'') IS NULL THEN 'not_captured' ELSE 'recorded_event' END
      FROM public.system_logs l LEFT JOIN public.schools s ON s.id=l.school_id LEFT JOIN public.profiles p ON p.id=l.user_id
    ) events WHERE (v_school IS NULL OR school_id=v_school) AND (p_level='' OR level=p_level)
      AND (p_search='' OR message ILIKE '%' || left(p_search,200) || '%' OR action ILIKE '%' || left(p_search,200) || '%'
        OR user_name ILIKE '%' || left(p_search,200) || '%' OR user_email ILIKE '%' || left(p_search,200) || '%'
        OR user_username ILIKE '%' || left(p_search,200) || '%')
    ORDER BY created_at DESC,id DESC LIMIT greatest(1,least(p_limit,200)) OFFSET greatest(0,least(p_offset,100000))
  ) r;
  RETURN v_result;
END;
$$;
NOTIFY pgrst,'reload schema';
