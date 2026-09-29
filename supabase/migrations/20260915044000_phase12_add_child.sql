-- ════════════════════════════════════════════════════════════════════
-- Phase 12 Migration: Add Another Child (Link Existing & Create New)
-- 
-- Hardens public.fn_link_student_guardian:
-- 1. Validates same-school tenant isolation for guardian and student.
-- 2. Prevents self-linking as guardian/child.
-- 3. Upserts parent_student relationship, restoring status = 'active'
--    if link was previously inactivated.
-- 4. Atomically manages primary child promotion/demotion.
-- 5. Ensures 'parent' role exists in public.user_roles.
-- 6. Ensures guardian profile has is_active = true.
-- 7. Fixes canonical audit insert into public.admin_action_audit
--    (uses detail column, omits id so identity sequence handles it,
--    populates actor_role and school_id).
-- ════════════════════════════════════════════════════════════════════

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
    v_effective_school UUID;
    v_parent_school UUID;
    v_student_school UUID;
    v_parent_name TEXT;
    v_student_name TEXT;
    v_link_id UUID;
    v_has_other_active_students BOOLEAN;
    v_make_primary BOOLEAN;
    v_was_reactivated BOOLEAN := false;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot link accounts for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: only school admins can link students to guardians';
    END IF;

    IF _parent_id = _student_id THEN
        RAISE EXCEPTION 'Cannot link account to itself as child/guardian';
    END IF;

    -- Validate parent profile
    SELECT school_id, full_name INTO v_parent_school, v_parent_name
    FROM public.profiles
    WHERE id = _parent_id AND deleted_at IS NULL;

    IF v_parent_school IS NULL THEN
        RAISE EXCEPTION 'Guardian/parent profile not found or inactive';
    END IF;

    IF v_parent_school <> v_effective_school THEN
        RAISE EXCEPTION 'Guardian does not belong to school %', v_effective_school;
    END IF;

    -- Validate student profile
    SELECT school_id, full_name INTO v_student_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id AND deleted_at IS NULL;

    IF v_student_school IS NULL THEN
        RAISE EXCEPTION 'Student profile not found or inactive';
    END IF;

    IF v_student_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Check if parent already has other active children
    SELECT EXISTS (
        SELECT 1 FROM public.parent_student
        WHERE parent_id = _parent_id
          AND school_id = v_effective_school
          AND status = 'active'
          AND student_id <> _student_id
    ) INTO v_has_other_active_students;

    -- If this is the first active child, it MUST be primary; otherwise honor _is_primary
    v_make_primary := CASE WHEN NOT v_has_other_active_students THEN true ELSE COALESCE(_is_primary, false) END;

    -- If marking as primary, demote any other active children of this parent atomically
    IF v_make_primary THEN
        UPDATE public.parent_student
        SET is_primary = false, updated_at = now()
        WHERE parent_id = _parent_id
          AND school_id = v_effective_school
          AND student_id <> _student_id
          AND is_primary = true;
    END IF;

    -- Check if link previously existed in inactive state
    SELECT EXISTS (
        SELECT 1 FROM public.parent_student
        WHERE parent_id = _parent_id AND student_id = _student_id AND status = 'inactive'
    ) INTO v_was_reactivated;

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
        v_effective_school,
        _parent_id,
        _student_id,
        COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
        v_make_primary,
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

    -- Ensure parent role exists in user_roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_parent_id, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Ensure parent profile is active
    UPDATE public.profiles
    SET is_active = true, updated_at = now()
    WHERE id = _parent_id AND is_active = false;

    -- Canonical Audit log (uses detail column, omits id for identity sequence)
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        auth.uid(),
        v_caller_role,
        v_effective_school,
        _parent_id,
        'link_student_guardian',
        jsonb_build_object(
            'link_id', v_link_id,
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'relationship', COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
            'is_primary', v_make_primary,
            'was_reactivated', v_was_reactivated
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
        'relationship', COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
        'is_primary', v_make_primary,
        'was_reactivated', v_was_reactivated
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Fix fn_get_profile_family_links to order by ce.enrolled_at DESC
-- (class_enrollments does not have created_at, it has enrolled_at)
-- ════════════════════════════════════════════════════════════════════
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
        'status', ps.status
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

