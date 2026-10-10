-- Authentication lifecycle comes from server-owned sessions, independently of browser telemetry.
CREATE OR REPLACE FUNCTION public.fn_capture_auth_session_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row jsonb; v_user uuid; v_profile public.profiles%ROWTYPE; v_action text;
BEGIN
  v_row := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_user := (v_row->>'user_id')::uuid;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
  v_action := CASE WHEN TG_OP='INSERT' THEN 'auth.session_started' ELSE 'auth.session_ended' END;
  INSERT INTO public.system_activity_events(school_id,school_name,user_id,user_name,actor_role,
    action,message,category,status,details,ip_address,user_agent)
  VALUES(v_profile.school_id,(SELECT name FROM public.schools WHERE id=v_profile.school_id),v_user,
    coalesce(v_profile.full_name,'Unknown account'),coalesce(v_profile.role,'unknown'),v_action,
    coalesce(v_profile.full_name,'Unknown account') || CASE WHEN TG_OP='INSERT' THEN ' signed in; an authentication session started' ELSE ' authentication session ended or was revoked' END,
    'auth','success',jsonb_build_object('source','auth_service','session_id',v_row->>'id'),
    v_row->>'ip',v_row->>'user_agent');
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_capture_auth_session_activity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS capture_auth_session_activity ON auth.sessions;
CREATE TRIGGER capture_auth_session_activity AFTER INSERT OR DELETE ON auth.sessions
FOR EACH ROW EXECUTE FUNCTION public.fn_capture_auth_session_activity();
NOTIFY pgrst,'reload schema';
