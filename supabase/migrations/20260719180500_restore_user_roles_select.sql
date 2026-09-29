-- Restore user_roles readability: migration 20260623051225 revoked SELECT from
-- authenticated (to hide the table from GraphQL) but left the RLS policies in place.
-- RLS policies cannot work without the table-level grant, so every role check failed
-- with "permission denied for table user_roles".
GRANT SELECT ON public.user_roles TO authenticated;

-- Admins can read roles of users in their own school (self-select policy already exists).
DROP POLICY IF EXISTS user_roles_admin_school_select ON public.user_roles;
CREATE POLICY user_roles_admin_school_select ON public.user_roles
FOR SELECT TO authenticated
USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND p.school_id = public.get_auth_school_id()
          AND p.deleted_at IS NULL
    )
);
