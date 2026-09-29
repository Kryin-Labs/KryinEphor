-- ════════════════════════════════════════════════════════════════════
-- Phase 11 Migration: Remove the Last Child
-- 
-- Enhances public.fn_unlink_student_guardian:
-- 1. Accurately evaluates remaining capabilities when the last child is unlinked.
-- 2. If Teacher is still active (active employee + teacher role), transitions
--    primary role to 'teacher' (Teacher-only account).
-- 3. If another staff role is active (accountant, receptionist, etc.), transitions
--    primary role to that staff role.
-- 4. If no Teacher and no children remain, evaluates has_active_persona = false.
--    NEVER automatically deletes the Auth or profile account.
-- 5. Audits remaining capabilities and returns structured evaluation to caller.
-- ════════════════════════════════════════════════════════════════════

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
    v_parent_current_role TEXT;
    v_remaining_children INT := 0;
    v_has_active_teacher BOOLEAN := false;
    v_other_staff_role TEXT := null;
    v_new_primary_role TEXT := null;
    v_has_active_persona BOOLEAN := true;
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
    SELECT full_name, role INTO v_parent_name, v_parent_current_role FROM public.profiles WHERE id = v_parent_id;

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

    -- Count remaining active children
    SELECT COUNT(*) INTO v_remaining_children
    FROM public.parent_student
    WHERE parent_id = v_parent_id
      AND school_id = v_effective_school
      AND status = 'active';

    -- Phase 11: Evaluate remaining capabilities if last child unlinked
    IF v_remaining_children = 0 THEN
        -- Check active teacher capability (active staff membership + teacher role)
        SELECT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = v_parent_id
              AND e.school_id = v_effective_school
              AND e.status = 'active'
              AND (
                  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_parent_id AND ur.role = 'teacher')
                  OR v_parent_current_role = 'teacher'
              )
        ) INTO v_has_active_teacher;

        -- Check other staff roles if not active teacher
        IF NOT v_has_active_teacher THEN
            SELECT ur.role INTO v_other_staff_role
            FROM public.user_roles ur
            WHERE ur.user_id = v_parent_id
              AND ur.role IN ('accountant', 'receptionist', 'admin', 'principal')
            LIMIT 1;
        END IF;

        IF v_parent_current_role = 'parent' THEN
            IF v_has_active_teacher THEN
                v_new_primary_role := 'teacher';
                UPDATE public.profiles
                SET role = 'teacher', updated_at = now()
                WHERE id = v_parent_id;
            ELSIF v_other_staff_role IS NOT NULL THEN
                v_new_primary_role := v_other_staff_role;
                UPDATE public.profiles
                SET role = v_other_staff_role, updated_at = now()
                WHERE id = v_parent_id;
            ELSE
                -- No teacher, no staff, no children -> no active school persona
                v_has_active_persona := false;
            END IF;
        ELSE
            -- User's primary role was not parent (e.g., already staff), verify persona
            IF v_parent_current_role = 'teacher' AND NOT v_has_active_teacher THEN
                v_has_active_persona := false;
            END IF;
        END IF;
    END IF;

    -- Canonical Audit log (uses detail column, omits id so identity sequence handles it)
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
        v_parent_id,
        'unlink_student_guardian',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'was_primary', v_was_primary,
            'promoted_next_primary_link_id', v_next_link_id,
            'remaining_children_count', v_remaining_children,
            'has_active_teacher', v_has_active_teacher,
            'new_primary_role', v_new_primary_role,
            'has_active_persona', v_has_active_persona
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'parent_name', v_parent_name,
        'student_id', v_student_id,
        'student_name', v_student_name,
        'was_primary', v_was_primary,
        'next_primary_link_id', v_next_link_id,
        'remaining_children_count', v_remaining_children,
        'has_active_teacher', v_has_active_teacher,
        'new_primary_role', v_new_primary_role,
        'has_active_persona', v_has_active_persona
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unlink_student_guardian(UUID, UUID) TO authenticated;
