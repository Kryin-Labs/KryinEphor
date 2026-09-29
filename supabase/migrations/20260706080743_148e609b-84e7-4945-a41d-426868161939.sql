CREATE OR REPLACE FUNCTION public.fn_get_user_roles(_target_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.has_role(auth.uid(), 'superadmin') OR public.has_role(auth.uid(), 'admin')) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;
    RETURN QUERY
        SELECT ur.role::text
          FROM public.user_roles ur
         WHERE ur.user_id = _target_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_get_user_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_user_roles(uuid) TO authenticated;