-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 MIGRATION — Safe Identity Foundation
-- Date: 2026-09-14
-- Establishes additive data model distinguishing Auth Account, Student Persona,
-- Family/Guardian Relationships, and Staff Identity with strict tenant isolation.
-- ════════════════════════════════════════════════════════════════════

-- 1. ENHANCE parent_student TABLE
ALTER TABLE public.parent_student
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ensure status constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parent_student_status_check'
  ) THEN
    ALTER TABLE public.parent_student
      ADD CONSTRAINT parent_student_status_check
      CHECK (status IN ('active', 'inactive', 'unlinked'));
  END IF;
END $$;

-- Allow self_student and flexible family relationships
ALTER TABLE public.parent_student DROP CONSTRAINT IF EXISTS parent_student_relationship_check;

-- Prevent duplicate relationships for the same parent and student
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parent_student_unique_link'
  ) THEN
    ALTER TABLE public.parent_student
      ADD CONSTRAINT parent_student_unique_link
      UNIQUE (parent_id, student_id);
  END IF;
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_parent_student_parent_status
  ON public.parent_student(parent_id, status);

CREATE INDEX IF NOT EXISTS idx_parent_student_student_status
  ON public.parent_student(student_id, status);

-- 2. ENHANCE employees TABLE (STAFF IDENTITY)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS staff_person_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_profile_school_active
  ON public.employees(profile_id, school_id)
  WHERE deleted_at IS NULL;

-- 3. TENANT CONSISTENCY TRIGGERS
CREATE OR REPLACE FUNCTION public.fn_validate_parent_student_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent_school UUID;
  v_student_school UUID;
  v_student_deleted TIMESTAMPTZ;
BEGIN
  SELECT school_id INTO v_parent_school FROM public.profiles WHERE id = NEW.parent_id;
  SELECT school_id, deleted_at INTO v_student_school, v_student_deleted FROM public.profiles WHERE id = NEW.student_id;

  IF v_parent_school IS NULL OR v_student_school IS NULL THEN
    RAISE EXCEPTION 'Parent and student profiles must have a valid school assigned';
  END IF;

  IF v_parent_school <> v_student_school THEN
    RAISE EXCEPTION 'Cross-tenant link forbidden: parent school (%) does not match student school (%)', v_parent_school, v_student_school;
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := v_parent_school;
  ELSIF NEW.school_id <> v_parent_school THEN
    RAISE EXCEPTION 'school_id (%) must match parent and student school (%)', NEW.school_id, v_parent_school;
  END IF;

  IF v_student_deleted IS NOT NULL AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Cannot link to a deleted/inactive student record';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_parent_student_link ON public.parent_student;
CREATE TRIGGER trg_validate_parent_student_link
  BEFORE INSERT OR UPDATE ON public.parent_student
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_parent_student_link();

CREATE OR REPLACE FUNCTION public.fn_validate_employee_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_school UUID;
BEGIN
  SELECT school_id INTO v_profile_school FROM public.profiles WHERE id = NEW.profile_id;

  IF v_profile_school IS NULL THEN
    RAISE EXCEPTION 'Profile must have a valid school assigned before creating staff membership';
  END IF;

  IF NEW.school_id IS NULL THEN
    NEW.school_id := v_profile_school;
  ELSIF NEW.school_id <> v_profile_school THEN
    RAISE EXCEPTION 'Cross-tenant staff membership forbidden: employee school (%) does not match profile school (%)', NEW.school_id, v_profile_school;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_employee_membership ON public.employees;
CREATE TRIGGER trg_validate_employee_membership
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_employee_membership();

-- 4. BACKFILL EXISTING ACCOUNTS SAFELY
-- A. Backfill existing students into parent_student as self-link (preserves single-child UX)
INSERT INTO public.parent_student (id, parent_id, student_id, school_id, relationship, is_primary, status, created_at)
SELECT
  gen_random_uuid(),
  p.id,
  p.id,
  p.school_id,
  'self_student',
  true,
  'active',
  now()
FROM public.profiles p
WHERE (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
  AND p.school_id IS NOT NULL
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.parent_student ps
    WHERE ps.parent_id = p.id AND ps.student_id = p.id
  );

-- B. Backfill existing teachers into employees if missing
INSERT INTO public.employees (id, profile_id, school_id, designation, department, status, staff_person_name, created_at)
SELECT
  gen_random_uuid(),
  p.id,
  p.school_id,
  'Teacher',
  'Academics',
  'active',
  COALESCE(p.full_name, 'Teacher'),
  now()
FROM public.profiles p
WHERE (p.role = 'teacher' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'teacher'))
  AND p.school_id IS NOT NULL
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.profile_id = p.id AND e.school_id = p.school_id AND e.deleted_at IS NULL
  );

-- 5. HELPER SECURITY FUNCTIONS
CREATE OR REPLACE FUNCTION public.fn_can_access_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    target_student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.parent_student ps
      WHERE ps.parent_id = auth.uid()
        AND ps.student_id = target_student_id
        AND ps.status = 'active'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_can_access_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_access_student(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_get_my_linked_students()
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  email TEXT,
  school_id UUID,
  relationship TEXT,
  is_primary BOOLEAN,
  status TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id AS student_id,
    p.full_name,
    p.email,
    ps.school_id,
    ps.relationship,
    ps.is_primary,
    ps.status,
    p.avatar_url
  FROM public.parent_student ps
  JOIN public.profiles p ON p.id = ps.student_id
  WHERE ps.parent_id = auth.uid()
    AND ps.status = 'active'
    AND p.deleted_at IS NULL
  ORDER BY ps.is_primary DESC, p.full_name ASC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_linked_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_linked_students() TO authenticated;

-- 6. TIGHTEN ROW LEVEL SECURITY
-- parent_student policies
DROP POLICY IF EXISTS "parent_student_tenant_select" ON public.parent_student;
CREATE POLICY "parent_student_tenant_select" ON public.parent_student
  FOR SELECT TO authenticated
  USING (
    public.get_auth_role() = 'superadmin'
    OR (school_id = public.get_auth_school_id() AND public.get_auth_role() IN ('admin', 'receptionist'))
    OR (school_id = public.get_auth_school_id() AND (parent_id = auth.uid() OR student_id = auth.uid()))
  );

DROP POLICY IF EXISTS "parent_student_tenant_insert" ON public.parent_student;
CREATE POLICY "parent_student_tenant_insert" ON public.parent_student
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_auth_role() = 'superadmin'
    OR (school_id = public.get_auth_school_id() AND public.get_auth_role() = 'admin')
  );

DROP POLICY IF EXISTS "parent_student_tenant_update" ON public.parent_student;
CREATE POLICY "parent_student_tenant_update" ON public.parent_student
  FOR UPDATE TO authenticated
  USING (
    public.get_auth_role() = 'superadmin'
    OR (school_id = public.get_auth_school_id() AND public.get_auth_role() = 'admin')
  );

DROP POLICY IF EXISTS "parent_student_tenant_delete" ON public.parent_student;
CREATE POLICY "parent_student_tenant_delete" ON public.parent_student
  FOR DELETE TO authenticated
  USING (
    public.get_auth_role() = 'superadmin'
    OR (school_id = public.get_auth_school_id() AND public.get_auth_role() = 'admin')
  );

-- employees select policy: allows employees to read their own staff membership record
DROP POLICY IF EXISTS employees_admin_select ON public.employees;
CREATE POLICY employees_admin_select ON public.employees FOR SELECT TO authenticated
  USING (
    public.get_auth_role() = 'superadmin'
    OR (school_id = public.get_auth_school_id() AND public.get_auth_role() IN ('admin', 'receptionist', 'accountant'))
    OR (school_id = public.get_auth_school_id() AND profile_id = auth.uid())
  );
