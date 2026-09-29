-- Migration: 20260915013000_phase6_persona_view_switcher.sql
-- Description: Phase 6 - Comprehensive persona and view summary RPC for unified Family & Work switcher

CREATE OR REPLACE FUNCTION public.fn_get_my_persona_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_profile RECORD;
    v_roles TEXT[];
    v_staff_record RECORD;
    v_students JSONB := '[]'::JSONB;
    v_pin_status RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Fetch profile
    SELECT id, email, full_name, role, school_id
    INTO v_profile
    FROM public.profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PROFILE_NOT_FOUND');
    END IF;

    -- Fetch assigned roles
    v_roles := public.fn_get_my_roles();
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_roles := ARRAY[v_profile.role];
    END IF;

    -- Fetch staff/employee details if any
    SELECT staff_person_name, designation, department
    INTO v_staff_record
    FROM public.employees
    WHERE profile_id = v_user_id
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1;

    -- Fetch linked students/children
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'student_id', s.student_id,
                'full_name', s.full_name,
                'email', s.email,
                'school_id', s.school_id,
                'relationship', s.relationship,
                'is_primary', s.is_primary,
                'avatar_url', s.avatar_url
            ) ORDER BY s.is_primary DESC, s.full_name ASC
        ),
        '[]'::JSONB
    )
    INTO v_students
    FROM public.fn_get_my_linked_students() s;

    -- Fetch staff pin info if staff role exists
    SELECT has_pin, must_change, is_locked, locked_until, attempts_remaining, is_temporary
    INTO v_pin_status
    FROM public.fn_check_staff_pin_status(v_profile.school_id, v_user_id);

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'email', v_profile.email,
        'full_name', v_profile.full_name,
        'primary_role', v_profile.role,
        'roles', v_roles,
        'school_id', v_profile.school_id,
        'staff_profile', CASE
            WHEN v_staff_record.staff_person_name IS NOT NULL THEN
                jsonb_build_object(
                    'staff_person_name', v_staff_record.staff_person_name,
                    'designation', v_staff_record.designation,
                    'department', v_staff_record.department
                )
            ELSE NULL
        END,
        'linked_students', v_students,
        'staff_pin_status', to_jsonb(v_pin_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_persona_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_persona_summary() TO authenticated;
