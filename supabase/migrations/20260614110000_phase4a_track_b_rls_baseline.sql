-- ════════════════════════════════════════════════════════════════════
-- Phase 4A — Track B: RLS Baseline (profiles, schools, memberships)
-- ────────────────────────────────────────────────────────────────────
-- Enables RLS on the three identity-critical tables, installs the
-- has_role() helper, and writes baseline policies. Preserves the
-- PostgREST embed `schools:school_id(name)` used by AuthContext.
--
-- Other tables (~51) remain untouched in this migration.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. has_role helper (reads profiles.role until user_roles lands) ──
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = _user_id
           AND role = _role
           AND is_active = true
    )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated, service_role;

-- ── 2. GRANTs (required for PostgREST access under RLS) ────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles    TO authenticated;
GRANT ALL                            ON public.profiles    TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schools     TO authenticated;
GRANT ALL                            ON public.schools     TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL                            ON public.memberships TO service_role;

-- ── 3. Enable RLS ──────────────────────────────────────────────────
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- ── 4. profiles policies ───────────────────────────────────────────
DROP POLICY IF EXISTS profiles_self_select         ON public.profiles;
DROP POLICY IF EXISTS profiles_superadmin_select   ON public.profiles;
DROP POLICY IF EXISTS profiles_same_school_select  ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update         ON public.profiles;
DROP POLICY IF EXISTS profiles_superadmin_update   ON public.profiles;

CREATE POLICY profiles_self_select
    ON public.profiles FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY profiles_superadmin_select
    ON public.profiles FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY profiles_same_school_select
    ON public.profiles FOR SELECT TO authenticated
    USING (
        school_id IS NOT NULL
        AND school_id = public.get_auth_school_id()
        AND public.has_role(auth.uid(), 'admin')
    );

CREATE POLICY profiles_self_update
    ON public.profiles FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        -- prevent privilege escalation: cannot change own role / school / activation
        AND role      = (SELECT role      FROM public.profiles WHERE id = auth.uid())
        AND school_id IS NOT DISTINCT FROM
                        (SELECT school_id FROM public.profiles WHERE id = auth.uid())
        AND is_active = (SELECT is_active FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY profiles_superadmin_update
    ON public.profiles FOR UPDATE TO authenticated
    USING      (public.has_role(auth.uid(), 'superadmin'))
    WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- ── 5. schools policies ────────────────────────────────────────────
DROP POLICY IF EXISTS schools_superadmin_all ON public.schools;
DROP POLICY IF EXISTS schools_own_select     ON public.schools;

CREATE POLICY schools_superadmin_all
    ON public.schools FOR ALL TO authenticated
    USING      (public.has_role(auth.uid(), 'superadmin'))
    WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- Preserves AuthContext embed `schools:school_id(name)` for tenant users.
CREATE POLICY schools_own_select
    ON public.schools FOR SELECT TO authenticated
    USING (id = public.get_auth_school_id());

-- ── 6. memberships policies ────────────────────────────────────────
DROP POLICY IF EXISTS memberships_self_select         ON public.memberships;
DROP POLICY IF EXISTS memberships_superadmin_all      ON public.memberships;
DROP POLICY IF EXISTS memberships_school_admin_select ON public.memberships;

CREATE POLICY memberships_self_select
    ON public.memberships FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY memberships_superadmin_all
    ON public.memberships FOR ALL TO authenticated
    USING      (public.has_role(auth.uid(), 'superadmin'))
    WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY memberships_school_admin_select
    ON public.memberships FOR SELECT TO authenticated
    USING (
        school_id = public.get_auth_school_id()
        AND public.has_role(auth.uid(), 'admin')
    );

COMMIT;
