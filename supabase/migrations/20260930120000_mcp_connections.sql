ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS ai_connections_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.mcp_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  redirect_uris jsonb NOT NULL CHECK (jsonb_typeof(redirect_uris)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.mcp_clients(id),
  redirect_uri text NOT NULL,
  state text,
  code_challenge text NOT NULL,
  scope text NOT NULL DEFAULT 'mcp',
  user_id uuid REFERENCES public.profiles(id),
  grant_version uuid,
  code_hash text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','used')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  client_id uuid NOT NULL REFERENCES public.mcp_clients(id),
  school_id uuid REFERENCES public.schools(id),
  token_version uuid NOT NULL DEFAULT gen_random_uuid(),
  refresh_hash text UNIQUE,
  refresh_expires_at timestamptz,
  teacher_session_id uuid,
  teacher_read_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,client_id)
);
CREATE INDEX IF NOT EXISTS mcp_grants_school_idx ON public.mcp_grants(school_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS public.mcp_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.mcp_grants(id),
  grant_version uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  client_id uuid NOT NULL REFERENCES public.mcp_clients(id),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  action text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','running','completed','failed')),
  result jsonb,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  approved_at timestamptz,
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_actions_actor_idx ON public.mcp_action_requests(actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.mcp_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  client_id uuid NOT NULL REFERENCES public.mcp_clients(id),
  grant_id uuid NOT NULL REFERENCES public.mcp_grants(id),
  school_id uuid REFERENCES public.schools(id),
  tool_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('running','succeeded','failed','denied')),
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_call_logs_actor_idx ON public.mcp_call_logs(actor_id,created_at DESC);
ALTER TABLE public.mcp_call_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_call_logs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_call_logs TO service_role;
ALTER TABLE public.mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_action_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_clients,public.mcp_auth_requests,public.mcp_grants,public.mcp_action_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_clients,public.mcp_auth_requests,public.mcp_grants,public.mcp_action_requests TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_set_school_enabled(p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_school uuid:=public.get_auth_school_id();
BEGIN
  IF v_school IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only an active school admin can change AI connections';
  END IF;
  UPDATE public.schools SET ai_connections_enabled=p_enabled WHERE id=v_school AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'School not found'; END IF;
  IF NOT p_enabled THEN
    UPDATE public.mcp_grants SET revoked_at=now(),refresh_hash=NULL,
      teacher_session_id=NULL,teacher_read_until=NULL
      WHERE school_id=v_school AND revoked_at IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_activate_teacher_read(p_grant uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_grant public.mcp_grants%ROWTYPE; v_session uuid; v_until timestamptz;
BEGIN
  SELECT * INTO v_grant FROM public.mcp_grants WHERE id=p_grant AND user_id=auth.uid()
    AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_grant.school_id IS DISTINCT FROM public.get_auth_school_id()
    OR NOT public.has_role(auth.uid(),'teacher')
    OR NOT public.fn_has_valid_staff_unlock(v_grant.school_id)
    OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id=v_grant.school_id AND ai_connections_enabled) THEN
    RAISE EXCEPTION 'Unlock teacher mode before enabling AI reads';
  END IF;
  v_session := (auth.jwt()->>'session_id')::uuid;
  SELECT least(expires_at,now()+interval '2 hours') INTO v_until
    FROM public.staff_unlock_sessions WHERE user_id=auth.uid()
      AND school_id=v_grant.school_id AND auth_session_id=v_session
      AND NOT is_revoked AND expires_at>now() ORDER BY expires_at DESC LIMIT 1;
  IF v_until IS NULL THEN RAISE EXCEPTION 'Staff unlock has expired'; END IF;
  UPDATE public.mcp_grants SET teacher_session_id=v_session,teacher_read_until=v_until WHERE id=p_grant;
  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_my_connections()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',g.id,'client_id',g.client_id,'name',c.name,'created_at',g.created_at,
    'school_id',g.school_id,'teacher_read_until',g.teacher_read_until)
    ORDER BY g.created_at DESC),'[]'::jsonb)
  FROM public.mcp_grants g JOIN public.mcp_clients c ON c.id=g.client_id
  WHERE g.user_id=auth.uid() AND g.revoked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.mcp_my_actions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'client_id',a.client_id,'school_id',a.school_id,'action',a.action,
    'payload',a.payload,'status',a.status,'error',a.error_text,
    'created_at',a.created_at,'expires_at',a.expires_at,'executed_at',a.executed_at,
    'school_name',s.name,'client_name',c.name)
    ORDER BY a.created_at DESC),'[]'::jsonb)
  FROM (SELECT * FROM public.mcp_action_requests WHERE actor_id=auth.uid()
    ORDER BY created_at DESC LIMIT 50) a
  JOIN public.schools s ON s.id=a.school_id JOIN public.mcp_clients c ON c.id=a.client_id
  WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.deleted_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.mcp_my_call_logs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'tool_name',l.tool_name,
    'outcome',l.outcome,'error',l.error_text,'created_at',l.created_at,
    'school_name',s.name,'client_name',c.name) ORDER BY l.created_at DESC),'[]'::jsonb)
  FROM (SELECT * FROM public.mcp_call_logs WHERE actor_id=auth.uid()
    ORDER BY created_at DESC LIMIT 50) l
  JOIN public.mcp_clients c ON c.id=l.client_id LEFT JOIN public.schools s ON s.id=l.school_id
  WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active AND p.deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.mcp_my_call_logs() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_my_call_logs() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_revoke_grant(p_grant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.mcp_grants SET revoked_at=now(),refresh_hash=NULL,
    teacher_session_id=NULL,teacher_read_until=NULL
    WHERE id=p_grant AND user_id=auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found'; END IF;
END;
$$;

-- One caller-owned claim is the execution gate. A second approval cannot replay it.
CREATE OR REPLACE FUNCTION public.mcp_claim_action(p_action uuid, p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.mcp_action_requests%ROWTYPE; g public.mcp_grants%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.mcp_action_requests WHERE id=p_action AND actor_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR a.status<>'pending' OR a.expires_at<=now() THEN
    RAISE EXCEPTION 'Action is unavailable or expired';
  END IF;
  SELECT * INTO g FROM public.mcp_grants WHERE id=a.grant_id AND user_id=a.actor_id
    AND client_id=a.client_id AND token_version=a.grant_version AND revoked_at IS NULL;
  IF NOT FOUND OR (g.school_id IS DISTINCT FROM a.school_id AND NOT
      (g.school_id IS NULL AND public.has_role(a.actor_id,'superadmin'))) OR NOT EXISTS
    (SELECT 1 FROM public.schools s WHERE s.id=a.school_id AND s.ai_connections_enabled AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'AI connection or school was disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=a.actor_id AND p.is_active
    AND p.deleted_at IS NULL AND (p.school_id=a.school_id OR public.has_role(a.actor_id,'superadmin'))) THEN
    RAISE EXCEPTION 'Account or school membership changed';
  END IF;
  IF a.action LIKE 'teacher_%' THEN
    IF NOT public.has_role(a.actor_id,'teacher') OR NOT public.fn_has_valid_staff_unlock(a.school_id) THEN
      RAISE EXCEPTION 'Teacher approval requires an unlocked staff session';
    END IF;
  ELSIF NOT (public.has_role(a.actor_id,'admin') OR public.has_role(a.actor_id,'superadmin')) THEN
    RAISE EXCEPTION 'Administrator approval is required';
  END IF;
  UPDATE public.mcp_action_requests SET status=CASE WHEN p_approve THEN 'running' ELSE 'denied' END,
    approved_at=CASE WHEN p_approve THEN now() ELSE NULL END,
    executed_at=CASE WHEN p_approve THEN NULL ELSE now() END
    WHERE id=p_action;
  RETURN jsonb_build_object('id',a.id,'action',a.action,'payload',a.payload,
    'payload_hash',a.payload_hash,
    'school_id',a.school_id,'client_id',a.client_id,'grant_id',a.grant_id,
    'approved',p_approve);
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_set_school_enabled(boolean),
  public.mcp_activate_teacher_read(uuid),public.mcp_my_connections(),
  public.mcp_my_actions(),public.mcp_revoke_grant(uuid),
  public.mcp_claim_action(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_set_school_enabled(boolean),
  public.mcp_activate_teacher_read(uuid),public.mcp_my_connections(),
  public.mcp_my_actions(),public.mcp_revoke_grant(uuid),
  public.mcp_claim_action(uuid,boolean) TO authenticated;

-- A linked child may have a different announcement audience from the parent.
-- Resolve that audience for the selected child only after checking the live link.
CREATE OR REPLACE FUNCTION public.mcp_child_announcements(p_student uuid)
RETURNS TABLE(id uuid,title text,body text,published_at timestamptz,
  expires_at timestamptz,audience text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_school uuid:=public.get_auth_school_id();
BEGIN
  IF v_school IS NULL OR NOT public.has_role(auth.uid(),'student') OR
    NOT public.has_role(auth.uid(),'parent') OR NOT EXISTS
      (SELECT 1 FROM public.schools s WHERE s.id=v_school
        AND s.ai_connections_enabled AND s.combined_parent_student_account
        AND s.deleted_at IS NULL) OR NOT EXISTS
      (SELECT 1 FROM public.profiles p WHERE p.id=p_student AND p.school_id=v_school
        AND p.is_active AND p.deleted_at IS NULL AND public.has_role(p.id,'student')) OR
    (p_student IS DISTINCT FROM auth.uid() AND NOT EXISTS
      (SELECT 1 FROM public.parent_student ps WHERE ps.parent_id=auth.uid()
        AND ps.student_id=p_student AND ps.school_id=v_school AND ps.status='active')) THEN
    RAISE EXCEPTION 'Selected student is unavailable';
  END IF;
  RETURN QUERY SELECT a.id,a.title,a.body,a.published_at,a.expires_at,a.audience
    FROM public.announcements a WHERE a.school_id=v_school
      AND public.announcement_is_recipient(a.id,p_student)
    ORDER BY a.published_at DESC LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_child_announcements(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_child_announcements(uuid) TO authenticated;
