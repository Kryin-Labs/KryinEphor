-- Drop loose policies that only check school membership (no admin/superadmin gate).
-- Stricter roles_admin_* / role_permissions_admin_* policies stay in place.
DROP POLICY IF EXISTS global_insert ON public.roles;
DROP POLICY IF EXISTS global_update ON public.roles;
DROP POLICY IF EXISTS global_delete ON public.roles;

DROP POLICY IF EXISTS global_insert ON public.role_permissions;
DROP POLICY IF EXISTS global_update ON public.role_permissions;
DROP POLICY IF EXISTS global_delete ON public.role_permissions;