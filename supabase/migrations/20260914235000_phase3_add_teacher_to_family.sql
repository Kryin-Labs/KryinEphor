-- ════════════════════════════════════════════════════════════════════
-- PHASE 3 MIGRATION — Add Teacher to Existing Family/Student Account
-- Date: 2026-09-14
-- Provides secure search and linking of existing family accounts for staff identity.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_search_school_accounts_for_staff(
  _school_id UUID,
  _query TEXT
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  primary_role TEXT,
  additional_roles TEXT[],
  is_active BOOLEAN,
  staff_name TEXT,
  has_teacher_role BOOLEAN,
  linked_students JSONB
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role TEXT := get_auth_role();
  v_caller_school UUID := get_auth_school_id();
  v_search TEXT;
BEGIN
  -- Security: Only school admin in the same school or platform superadmin can search accounts
  IF v_caller_role IS NULL OR (v_caller_role <> 'superadmin' AND (v_caller_role <> 'admin' OR v_caller_school <> _school_id)) THEN
    RAISE EXCEPTION 'Forbidden: Admin access required for this school';
  END IF;

  v_search := '%' || LOWER(TRIM(_query)) || '%';

  RETURN QUERY
  WITH user_roles_agg AS (
    SELECT
      ur.user_id,
      ARRAY_AGG(ur.role::TEXT) AS roles
    FROM public.user_roles ur
    GROUP BY ur.user_id
  ),
  linked_students_agg AS (
    SELECT
      ps.parent_id,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'student_id', s.id,
          'full_name', s.full_name,
          'relationship', ps.relationship,
          'is_primary', ps.is_primary,
          'status', ps.status,
          'class_name', c.name,
          'section', c.section
        )
      ) AS students
    FROM public.parent_student ps
    JOIN public.profiles s ON s.id = ps.student_id AND s.deleted_at IS NULL
    LEFT JOIN public.class_enrollments ce ON ce.student_id = s.id AND ce.school_id = _school_id
    LEFT JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
    WHERE ps.school_id = _school_id AND ps.status = 'active'
    GROUP BY ps.parent_id
  )
  SELECT
    p.id AS user_id,
    p.email,
    p.full_name,
    p.role AS primary_role,
    COALESCE(ura.roles, ARRAY[]::TEXT[]) AS additional_roles,
    p.is_active,
    emp.staff_person_name AS staff_name,
    (p.role = 'teacher' OR 'teacher' = ANY(COALESCE(ura.roles, ARRAY[]::TEXT[]))) AS has_teacher_role,
    COALESCE(lsa.students, '[]'::JSONB) AS linked_students
  FROM public.profiles p
  LEFT JOIN user_roles_agg ura ON ura.user_id = p.id
  LEFT JOIN linked_students_agg lsa ON lsa.parent_id = p.id
  LEFT JOIN public.employees emp ON emp.profile_id = p.id AND emp.school_id = _school_id AND emp.deleted_at IS NULL
  WHERE p.school_id = _school_id
    AND p.deleted_at IS NULL
    AND (
      LOWER(p.email) LIKE v_search
      OR LOWER(COALESCE(p.full_name, '')) LIKE v_search
      OR LOWER(COALESCE(emp.staff_person_name, '')) LIKE v_search
      OR EXISTS (
        SELECT 1 FROM public.parent_student ps2
        JOIN public.profiles s2 ON s2.id = ps2.student_id
        WHERE ps2.parent_id = p.id
          AND ps2.school_id = _school_id
          AND LOWER(COALESCE(s2.full_name, '')) LIKE v_search
      )
    )
  ORDER BY p.full_name ASC
  LIMIT 25;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_school_accounts_for_staff(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_search_school_accounts_for_staff(UUID, TEXT) TO authenticated;
