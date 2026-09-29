CREATE OR REPLACE FUNCTION public.fn_get_my_roles()
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_roles() TO authenticated;