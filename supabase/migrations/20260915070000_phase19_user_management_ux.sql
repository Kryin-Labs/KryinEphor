-- ============================================================================
-- Migration: 20260915070000_phase19_user_management_ux.sql
-- Description: Phase 19 User Management UX
--   Enhances fn_get_profile_family_links to return student_status and
--   is_active for linked students, and is_active for linked guardians.
--   Enables clean presentation of domain statuses (e.g. "Aarav — Active").
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_profile_family_links(
    _target_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_school UUID;
    v_target_school UUID;
    v_guardians JSONB;
    v_students JSONB;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    SELECT school_id INTO v_target_school FROM public.profiles WHERE id = _target_profile_id AND deleted_at IS NULL;
    IF v_target_school IS NULL THEN
        RAISE EXCEPTION 'Target profile not found';
    END IF;

    -- Security check: caller must be target user, superadmin, or admin of same school
    IF v_caller_id <> _target_profile_id AND v_caller_role <> 'superadmin' AND (v_caller_role <> 'admin' OR v_caller_school <> v_target_school) THEN
        RAISE EXCEPTION 'Access denied to view family links';
    END IF;

    -- 1. Guardians linked to this profile (if this profile is a student)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'link_id', ps.id,
        'guardian_id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'primary_role', p.role,
        'relationship', ps.relationship,
        'is_primary', ps.is_primary,
        'status', ps.status,
        'is_active', p.is_active,
        'is_staff', EXISTS (SELECT 1 FROM public.employees e WHERE e.profile_id = p.id AND e.school_id = v_target_school AND e.deleted_at IS NULL AND e.status = 'active'),
        'staff_person_name', (SELECT e.staff_person_name FROM public.employees e WHERE e.profile_id = p.id AND e.school_id = v_target_school AND e.deleted_at IS NULL LIMIT 1),
        'designation', (SELECT e.designation FROM public.employees e WHERE e.profile_id = p.id AND e.school_id = v_target_school AND e.deleted_at IS NULL LIMIT 1)
    )), '[]'::jsonb)
    INTO v_guardians
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.parent_id
    WHERE ps.student_id = _target_profile_id
      AND ps.parent_id <> _target_profile_id
      AND ps.status = 'active'
      AND p.deleted_at IS NULL;

    -- 2. Students linked to this profile (if this profile is a guardian/teacher)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'link_id', ps.id,
        'student_id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'login_id', p.login_id,
        'class_name', cls.class_name,
        'section_name', cls.section_name,
        'relationship', ps.relationship,
        'is_primary', ps.is_primary,
        'status', ps.status,
        'student_status', COALESCE(p.student_status, CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END),
        'is_active', p.is_active
    ) ORDER BY ps.is_primary DESC, ps.created_at ASC), '[]'::jsonb)
    INTO v_students
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.student_id
    LEFT JOIN LATERAL (
        SELECT c.name AS class_name, c.section AS section_name
        FROM public.class_enrollments ce
        JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
        WHERE ce.student_id = p.id AND ce.school_id = v_target_school AND ce.deleted_at IS NULL
        ORDER BY ce.enrolled_at DESC
        LIMIT 1
    ) cls ON true
    WHERE ps.parent_id = _target_profile_id
      AND ps.student_id <> _target_profile_id
      AND ps.status = 'active'
      AND p.deleted_at IS NULL;

    RETURN jsonb_build_object(
        'profile_id', _target_profile_id,
        'guardians', v_guardians,
        'students', v_students
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_profile_family_links(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_profile_family_links(UUID) TO authenticated;
