-- Migration: 20260915003000_phase4_teacher_first_child_later.sql
-- Description: Supports Teacher-first, Child-later workflow (linking child to existing teacher/staff account without duplicate logins)

-- 1. SEARCH GUARDIANS / STAFF FOR STUDENT LINKING
CREATE OR REPLACE FUNCTION public.fn_search_guardians_for_student(
    _school_id UUID,
    _query TEXT DEFAULT ''
)
RETURNS TABLE (
    guardian_id UUID,
    email TEXT,
    full_name TEXT,
    primary_role TEXT,
    roles TEXT[],
    is_active BOOLEAN,
    has_staff_role BOOLEAN,
    staff_person_name TEXT,
    designation TEXT,
    department TEXT,
    linked_children_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role <> 'superadmin' AND (v_caller_school IS NULL OR v_caller_school <> _school_id) THEN
        RAISE EXCEPTION 'Access denied: cannot search accounts for another school';
    END IF;

    RETURN QUERY
    SELECT
        p.id AS guardian_id,
        p.email::TEXT,
        COALESCE(p.full_name, '')::TEXT AS full_name,
        p.role::TEXT AS primary_role,
        COALESCE(
            (SELECT array_agg(DISTINCT r.role::TEXT) FROM (
                SELECT p.role AS role
                UNION
                SELECT unnest(p.roles) AS role
                UNION
                SELECT m.role AS role FROM public.memberships m WHERE m.profile_id = p.id AND m.school_id = _school_id AND m.deleted_at IS NULL
             ) r WHERE r.role IS NOT NULL),
            ARRAY[p.role::TEXT]
        ) AS roles,
        COALESCE(p.is_active, true) AS is_active,
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = p.id
              AND e.school_id = _school_id
              AND e.deleted_at IS NULL
              AND e.status = 'active'
        ) AS has_staff_role,
        e.staff_person_name::TEXT,
        e.designation::TEXT,
        e.department::TEXT,
        COUNT(ps.student_id) FILTER (WHERE ps.status = 'active' AND ps.student_id <> p.id) AS linked_children_count
    FROM public.profiles p
    LEFT JOIN public.employees e ON e.profile_id = p.id AND e.school_id = _school_id AND e.deleted_at IS NULL
    LEFT JOIN public.parent_student ps ON ps.parent_id = p.id AND ps.school_id = _school_id
    WHERE p.school_id = _school_id
      AND p.deleted_at IS NULL
      AND (
          _query IS NULL
          OR btrim(_query) = ''
          OR p.email ILIKE '%' || btrim(_query) || '%'
          OR p.full_name ILIKE '%' || btrim(_query) || '%'
          OR (e.staff_person_name IS NOT NULL AND e.staff_person_name ILIKE '%' || btrim(_query) || '%')
      )
    GROUP BY p.id, p.email, p.full_name, p.role, p.roles, p.is_active, e.staff_person_name, e.designation, e.department
    ORDER BY has_staff_role DESC, p.full_name ASC
    LIMIT 30;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_guardians_for_student(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_search_guardians_for_student(UUID, TEXT) TO authenticated;

-- 2. LINK STUDENT TO GUARDIAN / TEACHER
CREATE OR REPLACE FUNCTION public.fn_link_student_guardian(
    _school_id UUID,
    _parent_id UUID,
    _student_id UUID,
    _relationship TEXT DEFAULT 'parent',
    _is_primary BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_parent_school UUID;
    v_student_school UUID;
    v_parent_name TEXT;
    v_student_name TEXT;
    v_link_id UUID;
    v_parent_roles TEXT[];
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role <> 'superadmin' AND (v_caller_role <> 'admin' OR v_caller_school <> _school_id) THEN
        RAISE EXCEPTION 'Access denied: only school admins can link students to guardians';
    END IF;

    IF _parent_id = _student_id THEN
        RAISE EXCEPTION 'Cannot link account to itself as guardian';
    END IF;

    -- Validate parent profile
    SELECT school_id, full_name INTO v_parent_school, v_parent_name
    FROM public.profiles
    WHERE id = _parent_id AND deleted_at IS NULL;

    IF v_parent_school IS NULL THEN
        RAISE EXCEPTION 'Guardian/parent profile not found or inactive';
    END IF;

    IF v_parent_school <> _school_id THEN
        RAISE EXCEPTION 'Guardian does not belong to school %', _school_id;
    END IF;

    -- Validate student profile
    SELECT school_id, full_name INTO v_student_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id AND deleted_at IS NULL;

    IF v_student_school IS NULL THEN
        RAISE EXCEPTION 'Student profile not found or inactive';
    END IF;

    IF v_student_school <> _school_id THEN
        RAISE EXCEPTION 'Student does not belong to school %', _school_id;
    END IF;

    -- If this is marked as primary, unmark other primary links for this student if any
    IF _is_primary THEN
        UPDATE public.parent_student
        SET is_primary = false, updated_at = now()
        WHERE student_id = _student_id AND school_id = _school_id AND parent_id <> _student_id;
    END IF;

    -- Upsert parent_student link
    INSERT INTO public.parent_student (
        id,
        school_id,
        parent_id,
        student_id,
        relationship,
        is_primary,
        status,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        _school_id,
        _parent_id,
        _student_id,
        COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
        COALESCE(_is_primary, true),
        'active',
        auth.uid(),
        now(),
        now()
    )
    ON CONFLICT (parent_id, student_id)
    DO UPDATE SET
        relationship = EXCLUDED.relationship,
        is_primary = EXCLUDED.is_primary,
        status = 'active',
        school_id = EXCLUDED.school_id,
        updated_at = now()
    RETURNING id INTO v_link_id;

    -- Ensure the guardian profile has 'parent' in roles so the parent switcher is active
    SELECT COALESCE(roles, ARRAY[role]) INTO v_parent_roles FROM public.profiles WHERE id = _parent_id;
    IF NOT ('parent' = ANY(v_parent_roles)) THEN
        UPDATE public.profiles
        SET roles = array_append(v_parent_roles, 'parent'),
            updated_at = now()
        WHERE id = _parent_id;
    END IF;

    -- Also ensure membership record exists for parent role
    INSERT INTO public.memberships (id, profile_id, school_id, role, created_at, updated_at)
    VALUES (gen_random_uuid(), _parent_id, _school_id, 'parent', now(), now())
    ON CONFLICT DO NOTHING;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        id,
        actor_id,
        school_id,
        target_user_id,
        action,
        details,
        created_at
    ) VALUES (
        gen_random_uuid(),
        auth.uid(),
        _school_id,
        _parent_id,
        'link_student_guardian',
        jsonb_build_object(
            'link_id', v_link_id,
            'student_id', _student_id,
            'student_name', v_student_name,
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'relationship', _relationship,
            'is_primary', _is_primary
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_link_id,
        'parent_id', _parent_id,
        'parent_name', v_parent_name,
        'student_id', _student_id,
        'student_name', v_student_name,
        'relationship', _relationship,
        'is_primary', _is_primary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;

-- 3. GET PROFILE LINKED FAMILY (both directions: student -> guardians, and guardian/teacher -> students)
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
        'roles', p.roles,
        'relationship', ps.relationship,
        'is_primary', ps.is_primary,
        'status', ps.status,
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
        'class_name', (SELECT c.name FROM public.class_enrollments ce JOIN public.classes c ON c.id = ce.class_id WHERE ce.student_id = p.id AND ce.deleted_at IS NULL LIMIT 1),
        'relationship', ps.relationship,
        'is_primary', ps.is_primary,
        'status', ps.status
    )), '[]'::jsonb)
    INTO v_students
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.student_id
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
