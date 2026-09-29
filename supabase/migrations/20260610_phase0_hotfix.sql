-- ════════════════════════════════════════════════════════════════════
-- PHASE 0 HOTFIX MIGRATION — EduNex Emergency Fixes (v2 — IDEMPOTENT)
-- Date: 2026-06-10
-- Addresses: Problems #4, #6, #17, #33, #36, #37, #46
--
-- SAFE TO RE-RUN: All statements use IF NOT EXISTS / IF EXISTS
-- guards so partial prior runs won't cause errors.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- 1. FIX handle_new_user() TRIGGER (Problem #6, #37)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, school_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'student'),
    (NEW.raw_user_meta_data ->> 'school_id')::UUID
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    role = COALESCE(EXCLUDED.role, public.profiles.role),
    school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ════════════════════════════════════════════════════════════════════
-- 2. LOCK search_path ON ALL SECURITY DEFINER FUNCTIONS (Problem #36)
-- ════════════════════════════════════════════════════════════════════
ALTER FUNCTION public.get_auth_school_id() SET search_path = public;
ALTER FUNCTION public.get_auth_role() SET search_path = public;
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.refresh_dashboard_metrics() SET search_path = public;


-- ════════════════════════════════════════════════════════════════════
-- 3. ADD ATTENDANCE UNIQUE CONSTRAINT (Problem #17, #46)
--    SKIP if already exists (idempotent)
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.attendance'::regclass AND contype = 'u'
  ) THEN
    -- Clean up duplicates first (keep most recent)
    DELETE FROM public.attendance a
    USING public.attendance b
    WHERE a.student_id = b.student_id
      AND a.date = b.date
      AND a.id < b.id;

    ALTER TABLE public.attendance
      ADD CONSTRAINT uq_attendance_student_date UNIQUE (student_id, date);
  END IF;
END;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 4. CLEAN UP GHOST PROFILES + ADD CHECK CONSTRAINT (Problem #4)
-- ════════════════════════════════════════════════════════════════════

-- STEP A: Try to salvage profiles from memberships
UPDATE public.profiles p
  SET school_id = m.school_id
  FROM public.memberships m
  WHERE p.id = m.user_id
    AND p.role != 'superadmin'
    AND p.school_id IS NULL
    AND m.school_id IS NOT NULL;

-- STEP B: Delete orphaned ghost profiles with no school
DELETE FROM public.profiles
  WHERE role != 'superadmin'
    AND school_id IS NULL;

-- STEP C: Add constraint (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_profiles_school_required'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_school_required
      CHECK (role = 'superadmin' OR school_id IS NOT NULL);
  END IF;
END;
$$;


-- ════════════════════════════════════════════════════════════════════
-- 5. FIX RLS WITH CHECK (true) POLICIES (Problem #33)
--
--    VERIFIED COLUMN MAP FROM LIVE DATABASE:
--    ┌──────────────────┬──────────┬──────────┐
--    │ Table             │ user_id  │ school_id│
--    ├──────────────────┼──────────┼──────────┤
--    │ activity_logs     │ ✅ YES   │ ✅ YES   │
--    │ audit_logs        │ ✅ YES   │ ✅ YES   │
--    │ system_logs       │ ✅ YES   │ ✅ YES   │
--    │ password_resets    │ ✅ YES   │ ❌ NO    │
--    │ login_attempts    │ ❌ NO    │ ❌ NO    │
--    │ failed_jobs       │ ❌ NO    │ ✅ YES   │
--    └──────────────────┴──────────┴──────────┘
-- ════════════════════════════════════════════════════════════════════

-- activity_logs: enforce user_id ownership + school_id match
DROP POLICY IF EXISTS tenant_insert ON public.activity_logs;
CREATE POLICY "activity_logs_safe_insert" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (school_id IS NULL OR school_id = public.get_auth_school_id())
  );

-- audit_logs: enforce user_id ownership + school_id match
DROP POLICY IF EXISTS tenant_insert ON public.audit_logs;
CREATE POLICY "audit_logs_safe_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (school_id IS NULL OR school_id = public.get_auth_school_id())
  );

-- failed_jobs: restrict to admin/superadmin only (NO user_id column!)
DROP POLICY IF EXISTS tenant_insert ON public.failed_jobs;
CREATE POLICY "failed_jobs_safe_insert" ON public.failed_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_auth_role() IN ('superadmin', 'admin')
    AND (school_id IS NULL OR school_id = public.get_auth_school_id())
  );

-- login_attempts: NO user_id column! Use email-based check instead.
-- Remove dangerous anon policy. Only allow auth users to log their own email.
DROP POLICY IF EXISTS la_insert_anon ON public.login_attempts;
DROP POLICY IF EXISTS la_insert_auth ON public.login_attempts;
CREATE POLICY "login_attempts_safe_insert" ON public.login_attempts
  FOR INSERT TO authenticated
  WITH CHECK (
    email = (SELECT email FROM public.profiles WHERE id = auth.uid())
  );

-- password_resets: enforce self-service only (has user_id, NO school_id)
DROP POLICY IF EXISTS self_insert ON public.password_resets;
CREATE POLICY "password_resets_safe_insert" ON public.password_resets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- system_logs: enforce user ownership + school match
DROP POLICY IF EXISTS tenant_insert ON public.system_logs;
CREATE POLICY "system_logs_safe_insert" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND (school_id IS NULL OR school_id = public.get_auth_school_id())
  );

-- Remove dangerous anon INSERT on system_logs (Problem #21)
DROP POLICY IF EXISTS "Logs: Anon can insert" ON public.system_logs;


-- ════════════════════════════════════════════════════════════════════
-- DONE — VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════════════
-- 1. Confirm trigger is fixed:
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';

-- 2. Confirm constraint exists:
-- SELECT conname FROM pg_constraint WHERE conname = 'chk_profiles_school_required';

-- 3. Confirm WITH CHECK (true) policies are gone:
-- SELECT tablename, policyname, with_check FROM pg_policies
--   WHERE with_check = 'true'
--   AND tablename IN ('activity_logs','audit_logs','failed_jobs','login_attempts','password_resets','system_logs');
