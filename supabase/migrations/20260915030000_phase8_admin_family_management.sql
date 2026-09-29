-- Migration: 20260915030000_phase8_admin_family_management.sql
-- Description: Phase 8 - Admin / Superadmin Family Management UI backend functions, unique primary index, and relationship mutations.

-- 1. CLEAN UP LEGACY MULTI-PRIMARY ROWS BEFORE INDEX CREATION
ALTER TABLE public.parent_student ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
    WITH ranked_primaries AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY parent_id, school_id
                   ORDER BY updated_at DESC, created_at DESC, id ASC
               ) AS rn
        FROM public.parent_student
        WHERE status = 'active' AND is_primary = true
    )
    UPDATE public.parent_student ps
    SET is_primary = false, updated_at = now()
    FROM ranked_primaries rp
    WHERE ps.id = rp.id AND rp.rn > 1;
END $$;

-- 2. PARTIAL UNIQUE INDEX ON ACTIVE PRIMARY CHILD PER PARENT & SCHOOL
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_student_active_primary
ON public.parent_student (parent_id, school_id)
WHERE status = 'active' AND is_primary = true;

-- 3. SEARCH STUDENTS FOR FAMILY ACCOUNT (School-scoped, minimal safe identifiers)
CREATE OR REPLACE FUNCTION public.fn_search_students_for_family(
    _school_id UUID,
    _query TEXT DEFAULT '',
    _parent_id UUID DEFAULT NULL
)
RETURNS TABLE (
    student_id UUID,
    full_name TEXT,
    login_id TEXT,
    class_name TEXT,
    section_name TEXT,
    already_linked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_parent_school UUID;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot search students for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Untrusted _parent_id validation: ensure parent belongs to effective school
    IF _parent_id IS NOT NULL THEN
        SELECT school_id INTO v_parent_school
        FROM public.profiles
        WHERE id = _parent_id AND deleted_at IS NULL;

        IF v_parent_school IS NULL OR v_parent_school <> v_effective_school THEN
            RAISE EXCEPTION 'Access denied: target parent account does not belong to the effective school';
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        p.id AS student_id,
        COALESCE(p.full_name, '')::TEXT AS full_name,
        p.login_id::TEXT,
        cls.class_name::TEXT,
        cls.section_name::TEXT,
        CASE
            WHEN _parent_id IS NOT NULL THEN
                EXISTS (
                    SELECT 1 FROM public.parent_student ps
                    WHERE ps.parent_id = _parent_id
                      AND ps.student_id = p.id
                      AND ps.school_id = v_effective_school
                      AND ps.status = 'active'
                )
            ELSE false
        END AS already_linked
    FROM public.profiles p
    LEFT JOIN LATERAL (
        SELECT c.name AS class_name, c.section AS section_name
        FROM public.class_enrollments ce
        JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
        WHERE ce.student_id = p.id AND ce.school_id = v_effective_school AND ce.deleted_at IS NULL
        ORDER BY ce.created_at DESC
        LIMIT 1
    ) cls ON true
    WHERE p.school_id = v_effective_school
      AND p.deleted_at IS NULL
      AND (
          p.role = 'student'
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student')
          OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.student_id = p.id AND ce.school_id = v_effective_school AND ce.deleted_at IS NULL)
      )
      AND (_parent_id IS NULL OR p.id <> _parent_id)
      AND (
          _query IS NULL
          OR btrim(_query) = ''
          OR p.full_name ILIKE '%' || btrim(_query) || '%'
          OR (p.login_id IS NOT NULL AND p.login_id ILIKE '%' || btrim(_query) || '%')
          OR (cls.class_name IS NOT NULL AND cls.class_name ILIKE '%' || btrim(_query) || '%')
      )
    ORDER BY p.full_name ASC
    LIMIT 25;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_students_for_family(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_search_students_for_family(UUID, TEXT, UUID) TO authenticated;

-- 4. HARDENED LINK STUDENT TO GUARDIAN RPC
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
        WHERE parent_id = _parent_id AND school_id = v_effective_school AND status = 'active' AND student_id <> _student_id
    ) INTO v_has_other_active_students;

    -- If this is the first active child, it MUST be primary; otherwise honor _is_primary
    v_make_primary := CASE WHEN NOT v_has_other_active_students THEN true ELSE COALESCE(_is_primary, false) END;

    -- If marking as primary, demote any other active children of this parent atomically
    IF v_make_primary THEN
        UPDATE public.parent_student
        SET is_primary = false, updated_at = now()
        WHERE parent_id = _parent_id AND school_id = v_effective_school AND student_id <> _student_id AND is_primary = true;
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
        v_effective_school,
        _parent_id,
        'link_student_guardian',
        jsonb_build_object(
            'link_id', v_link_id,
            'student_id', _student_id,
            'student_name', v_student_name,
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'relationship', _relationship,
            'is_primary', v_make_primary
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
        'is_primary', v_make_primary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;

-- 5. UNLINK STUDENT FROM GUARDIAN RPC
CREATE OR REPLACE FUNCTION public.fn_unlink_student_guardian(
    _school_id UUID,
    _link_id UUID
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
    v_parent_id UUID;
    v_student_id UUID;
    v_was_primary BOOLEAN;
    v_link_school UUID;
    v_next_link_id UUID;
    v_student_name TEXT;
    v_parent_name TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot unlink accounts for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Locate target relationship
    SELECT parent_id, student_id, is_primary, school_id
    INTO v_parent_id, v_student_id, v_was_primary, v_link_school
    FROM public.parent_student
    WHERE id = _link_id;

    IF v_parent_id IS NULL THEN
        RAISE EXCEPTION 'Family link not found';
    END IF;

    IF v_link_school <> v_effective_school THEN
        RAISE EXCEPTION 'Link does not belong to school %', v_effective_school;
    END IF;

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name INTO v_parent_name FROM public.profiles WHERE id = v_parent_id;

    -- Mark link inactive (revokes access immediately; never deletes student or academic records)
    UPDATE public.parent_student
    SET status = 'inactive',
        is_primary = false,
        updated_at = now()
    WHERE id = _link_id;

    -- If this was the primary child, atomically promote the next active child
    IF v_was_primary THEN
        SELECT id INTO v_next_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND status = 'active'
          AND id <> _link_id
        ORDER BY updated_at DESC, created_at ASC
        LIMIT 1;

        IF v_next_link_id IS NOT NULL THEN
            UPDATE public.parent_student
            SET is_primary = true, updated_at = now()
            WHERE id = v_next_link_id;
        END IF;
    END IF;

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
        v_effective_school,
        v_parent_id,
        'unlink_student_guardian',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'was_primary', v_was_primary,
            'promoted_next_primary_link_id', v_next_link_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'student_id', v_student_id,
        'student_name', v_student_name,
        'was_primary', v_was_primary,
        'next_primary_link_id', v_next_link_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) TO authenticated;

-- 6. UPDATE GUARDIAN RELATIONSHIP RPC
CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _school_id UUID,
    _link_id UUID,
    _relationship TEXT,
    _is_primary BOOLEAN DEFAULT NULL
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
    v_parent_id UUID;
    v_student_id UUID;
    v_old_relationship TEXT;
    v_old_primary BOOLEAN;
    v_link_school UUID;
    v_target_primary BOOLEAN;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationships for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    SELECT parent_id, student_id, relationship, is_primary, school_id
    INTO v_parent_id, v_student_id, v_old_relationship, v_old_primary, v_link_school
    FROM public.parent_student
    WHERE id = _link_id AND status = 'active';

    IF v_parent_id IS NULL THEN
        RAISE EXCEPTION 'Active family link not found';
    END IF;

    IF v_link_school <> v_effective_school THEN
        RAISE EXCEPTION 'Link does not belong to school %', v_effective_school;
    END IF;

    v_target_primary := COALESCE(_is_primary, v_old_primary);

    -- If promoting to primary, demote any other active children of this parent first
    IF v_target_primary AND NOT v_old_primary THEN
        UPDATE public.parent_student
        SET is_primary = false, updated_at = now()
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND is_primary = true;
    END IF;

    UPDATE public.parent_student
    SET relationship = COALESCE(NULLIF(btrim(_relationship), ''), relationship),
        is_primary = v_target_primary,
        updated_at = now()
    WHERE id = _link_id;

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
        v_effective_school,
        v_parent_id,
        'update_student_guardian_relationship',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'student_id', v_student_id,
            'old_relationship', v_old_relationship,
            'new_relationship', _relationship,
            'old_primary', v_old_primary,
            'new_primary', v_target_primary
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'student_id', v_student_id,
        'relationship', COALESCE(NULLIF(btrim(_relationship), ''), v_old_relationship),
        'is_primary', v_target_primary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) TO authenticated;

-- 7. ENHANCE fn_get_profile_family_links WITH CLASS, SECTION, LOGIN_ID, AND STATUS
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
        ORDER BY ce.created_at DESC
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
