-- Migration: 20260924220000_post_phase18_neutralize_unsafe_rpc_and_hardening.sql
-- Description: 
--   1. Drop unsafe public.fn_remove_teacher_access (Items 21, 22, 23).
--   2. Authoritatively harden fn_disable_teacher_access_internal with assignment history snapshot,
--      safe multi-persona role transition, staff unlock revocation, and zero secret logging (Items 21, 22, 30).
--   3. Enforce strict Superadmin explicit school tenant context across fn_update_guardian_relationship
--      and fn_admin_set_account_active (Item 29).

-- ────────────────────────────────────────────────────────────────────
-- 1. DROP UNSAFE fn_remove_teacher_access (Item 21)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_remove_teacher_access(UUID, UUID, UUID);


-- ────────────────────────────────────────────────────────────────────
-- 2. HARDEN fn_disable_teacher_access_internal (Items 21, 22, 30)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_disable_teacher_access_internal(
    _school_id UUID,
    _target_profile_id UUID,
    _actor_profile_id UUID,
    _clear_assignments BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_target_profile RECORD;
    v_existing_emp RECORD;
    v_actor_name TEXT;
    v_actor_role TEXT;
    v_active_count INT := 0;
    v_prev_role TEXT;
    v_new_role TEXT;
    v_primary_role_changed BOOLEAN := FALSE;
    v_revoked_session_count INT := 0;
    v_active_children_count INT := 0;
    v_has_parent_role BOOLEAN := FALSE;
    v_other_role TEXT := NULL;
    v_cleared_classes INT := 0;
    v_cleared_subjects INT := 0;
    v_cleared_st INT := 0;
    v_cleared_tt INT := 0;
    v_cleared_oc INT := 0;
BEGIN
    -- 0. School context validation
    IF _school_id IS NULL THEN
        RAISE EXCEPTION 'Explicit school context is required to disable teacher access';
    END IF;

    -- 1. Validate Target Profile
    SELECT id, email, full_name, role, school_id, is_active
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_profile_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found or has been deleted';
    END IF;

    IF v_target_profile.school_id IS NOT NULL AND v_target_profile.school_id <> _school_id THEN
        RAISE EXCEPTION 'Target user does not belong to the specified school';
    END IF;

    -- Fetch actor full name and role for snapshot attribution & audit
    SELECT full_name, role INTO v_actor_name, v_actor_role
    FROM public.profiles
    WHERE id = _actor_profile_id;

    v_actor_role := COALESCE(v_actor_role, 'admin');

    v_prev_role := v_target_profile.role;
    v_new_role := v_prev_role;

    -- 2. Fetch Employee identity snapshot
    SELECT id, staff_person_name, designation, department, status
    INTO v_existing_emp
    FROM public.employees
    WHERE profile_id = _target_profile_id
      AND school_id = _school_id
      AND deleted_at IS NULL
    LIMIT 1;

    -- 3. Check for Active Teaching Assignments
    SELECT (
        (SELECT COUNT(*) FROM public.classes WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM public.subjects WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM public.subject_teachers WHERE teacher_id = _target_profile_id AND school_id = _school_id) +
        (SELECT COUNT(*) FROM public.timetable WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM public.online_classes WHERE teacher_id = _target_profile_id AND school_id = _school_id AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now())) AND deleted_at IS NULL)
    ) INTO v_active_count;

    -- If active assignments exist and clear flag was not provided, FAIL ATOMICALLY
    IF v_active_count > 0 AND _clear_assignments IS NOT TRUE THEN
        RAISE EXCEPTION 'ACTIVE_ASSIGNMENTS_EXIST: Target teacher has % active teaching assignments. Reassign them or explicitly choose to clear them.', v_active_count;
    END IF;

    -- 4. Snapshot & Clear Operational Assignments (if requested)
    IF v_active_count > 0 AND _clear_assignments IS TRUE THEN
        -- A. Classes
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT c.school_id, c.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'class_teacher', c.id, c.name, c.id, NULL, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('name', c.name, 'section', c.section, 'grade_level', c.grade_level, 'source_row_created_at', c.created_at)
        FROM public.classes c
        WHERE c.teacher_id = _target_profile_id AND c.school_id = _school_id AND c.deleted_at IS NULL;
        GET DIAGNOSTICS v_cleared_classes = ROW_COUNT;

        UPDATE public.classes
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- B. Subjects
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT s.school_id, s.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'subject', s.id, s.name, s.class_id, c.name, s.id, NULL, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('name', s.name, 'code', s.code, 'source_row_created_at', s.created_at)
        FROM public.subjects s
        LEFT JOIN public.classes c ON c.id = s.class_id
        WHERE s.teacher_id = _target_profile_id AND s.school_id = _school_id AND s.deleted_at IS NULL;
        GET DIAGNOSTICS v_cleared_subjects = ROW_COUNT;

        UPDATE public.subjects
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- C. Subject Teachers
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT st.school_id, st.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'subject_teacher', st.subject_id, s.name, st.class_id, c.name, st.id, st.created_at, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('subject_id', st.subject_id, 'class_id', st.class_id, 'source_row_created_at', st.created_at)
        FROM public.subject_teachers st
        JOIN public.subjects s ON s.id = st.subject_id
        JOIN public.classes c ON c.id = st.class_id
        WHERE st.teacher_id = _target_profile_id AND st.school_id = _school_id;
        GET DIAGNOSTICS v_cleared_st = ROW_COUNT;

        DELETE FROM public.subject_teachers
        WHERE teacher_id = _target_profile_id AND school_id = _school_id;

        -- D. Timetable
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT tt.school_id, tt.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'timetable', tt.subject_id, s.name, tt.class_id, c.name, tt.id, NULL, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('day_of_week', tt.day_of_week, 'start_time', tt.start_time, 'end_time', tt.end_time, 'room', tt.room, 'source_row_created_at', tt.created_at)
        FROM public.timetable tt
        JOIN public.classes c ON c.id = tt.class_id
        JOIN public.subjects s ON s.id = tt.subject_id
        WHERE tt.teacher_id = _target_profile_id AND tt.school_id = _school_id AND tt.deleted_at IS NULL;
        GET DIAGNOSTICS v_cleared_tt = ROW_COUNT;

        UPDATE public.timetable
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- E. Online Classes
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT oc.school_id, oc.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'online_class', oc.subject_id, s.name, oc.class_id, c.name, oc.id, NULL, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('title', oc.title, 'scheduled_at', oc.scheduled_at, 'status', oc.status, 'source_row_created_at', oc.created_at)
        FROM public.online_classes oc
        LEFT JOIN public.subjects s ON s.id = oc.subject_id
        LEFT JOIN public.classes c ON c.id = oc.class_id
        WHERE oc.teacher_id = _target_profile_id AND oc.school_id = _school_id
          AND (oc.status = 'live' OR (oc.status = 'scheduled' AND oc.scheduled_at >= now()))
          AND oc.deleted_at IS NULL;
        GET DIAGNOSTICS v_cleared_oc = ROW_COUNT;

        UPDATE public.online_classes
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id
          AND school_id = _school_id
          AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now()))
          AND deleted_at IS NULL;
    END IF;

    -- 5. Revoke Active Staff Unlock Sessions for target user immediately
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions'
    ) THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'teacher_access_disabled'
        WHERE user_id = _target_profile_id
          AND is_revoked IS FALSE;
        GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;
    END IF;

    -- 6. Inactivate Employee Record
    IF v_existing_emp.id IS NOT NULL THEN
        UPDATE public.employees
        SET status = 'inactive'
        WHERE id = v_existing_emp.id;
    END IF;

    -- 7. Remove teacher from user_roles
    DELETE FROM public.user_roles
    WHERE user_id = _target_profile_id
      AND role = 'teacher';

    -- 8. Handle Primary Role Transition
    IF v_target_profile.role = 'teacher' THEN
        -- Check if user has active linked children
        SELECT COUNT(*) INTO v_active_children_count
        FROM public.parent_student
        WHERE parent_id = _target_profile_id
          AND school_id = _school_id
          AND status = 'active'
          AND student_id <> _target_profile_id;

        -- Check if user already has 'parent' in user_roles
        SELECT EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role = 'parent'
        ) INTO v_has_parent_role;

        IF v_active_children_count > 0 OR v_has_parent_role THEN
            -- Legitimate parent persona exists: transition primary role to 'parent'
            v_new_role := 'parent';
            UPDATE public.profiles
            SET role = 'parent',
                updated_at = now()
            WHERE id = _target_profile_id;
            v_primary_role_changed := TRUE;

            INSERT INTO public.user_roles (user_id, role)
            VALUES (_target_profile_id, 'parent')
            ON CONFLICT (user_id, role) DO NOTHING;

        ELSE
            -- No parent persona: check for any other valid remaining role in user_roles
            SELECT role INTO v_other_role
            FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role <> 'teacher'
            ORDER BY (
                CASE role
                    WHEN 'admin' THEN 1
                    WHEN 'principal' THEN 2
                    WHEN 'accountant' THEN 3
                    WHEN 'receptionist' THEN 4
                    WHEN 'staff' THEN 5
                    WHEN 'student' THEN 6
                    ELSE 7
                END
            ) ASC
            LIMIT 1;

            IF v_other_role IS NOT NULL THEN
                -- Promote the remaining valid role to primary (never make them parent without children)
                v_new_role := v_other_role;
                UPDATE public.profiles
                SET role = v_other_role,
                    updated_at = now()
                WHERE id = _target_profile_id;
                v_primary_role_changed := TRUE;
            ELSE
                -- Teacher only with no other persona exists -> REJECT
                RAISE EXCEPTION 'CANNOT_DISABLE_NO_OTHER_PERSONA: Cannot disable Teacher access on an account with no other active persona (e.g. parent, staff, or student). Reassign role or deactivate account.';
            END IF;
        END IF;
    END IF;

    -- 9. Canonical Audit Logging in admin_action_audit using `detail`
    INSERT INTO public.admin_action_audit (
        school_id,
        actor_id,
        actor_role,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        _school_id,
        _actor_profile_id,
        v_actor_role,
        _target_profile_id,
        'teacher_access_disabled',
        jsonb_build_object(
            'actor_id', _actor_profile_id,
            'actor_name', v_actor_name,
            'actor_role', v_actor_role,
            'target_user_id', _target_profile_id,
            'target_user_name', v_target_profile.full_name,
            'school_id', _school_id,
            'staff_identity', jsonb_build_object(
                'employee_id', v_existing_emp.id,
                'staff_person_name', v_existing_emp.staff_person_name,
                'designation', v_existing_emp.designation,
                'department', v_existing_emp.department
            ),
            'previous_primary_role', v_prev_role,
            'new_primary_role', v_new_role,
            'primary_role_changed', v_primary_role_changed,
            'employee_previous_status', v_existing_emp.status,
            'employee_new_status', 'inactive',
            'sessions_revoked', v_revoked_session_count,
            'assignments_archived', _clear_assignments,
            'assignments_cleared', _clear_assignments,
            'cleared_counts', jsonb_build_object(
                'classes', v_cleared_classes,
                'subjects', v_cleared_subjects,
                'subject_teachers', v_cleared_st,
                'timetable', v_cleared_tt,
                'online_classes', v_cleared_oc
            ),
            'timestamp', now()
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'previous_primary_role', v_prev_role,
        'new_primary_role', v_new_role,
        'primary_role_changed', v_primary_role_changed,
        'assignments_cleared', _clear_assignments,
        'cleared_classes', v_cleared_classes,
        'cleared_subjects', v_cleared_subjects,
        'cleared_subject_teachers', v_cleared_st,
        'cleared_timetable', v_cleared_tt,
        'cleared_online_classes', v_cleared_oc,
        'revoked_sessions_count', v_revoked_session_count
    );
END;
$$;

-- Secure access boundary: only callable by backend service role (e.g. from update_admin edge function)
REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) TO service_role, postgres;


-- ────────────────────────────────────────────────────────────────────
-- 3. HARDEN fn_update_guardian_relationship (Superadmin Tenant Context)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _school_id UUID,
    _link_id UUID,
    _relationship TEXT DEFAULT NULL,
    _is_primary BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_link RECORD;
    v_old_relationship TEXT;
    v_old_is_primary BOOLEAN;
    v_new_relationship TEXT;
    v_new_is_primary BOOLEAN;
    v_parent_id UUID;
    v_student_id UUID;
    v_student_name TEXT;
    v_parent_name TEXT;
    v_promoted_link_id UUID;
BEGIN
    v_caller_school := public.get_auth_school_id();

    SELECT * INTO v_link FROM public.parent_student WHERE id = _link_id;
    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Relationship link not found';
    END IF;

    -- Strict tenant validation
    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationship for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Validate that target guardian link belongs to effective school
    IF v_link.school_id IS NULL OR v_link.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Relationship link does not belong to school %', v_effective_school;
    END IF;

    v_parent_id := v_link.parent_id;
    v_student_id := v_link.student_id;
    v_old_relationship := v_link.relationship;
    v_old_is_primary := v_link.is_primary;

    v_new_relationship := COALESCE(NULLIF(TRIM(_relationship), ''), v_old_relationship);
    v_new_is_primary := COALESCE(_is_primary, v_old_is_primary);

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name INTO v_parent_name FROM public.profiles WHERE id = v_parent_id;

    -- Primary Child Invariant:
    IF v_new_is_primary AND NOT v_old_is_primary THEN
        -- When promoting this child, demote all other active children for the SAME parent in this school
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE parent_id = v_parent_id 
          AND school_id = v_effective_school 
          AND id <> _link_id 
          AND status = 'active'
          AND is_primary = TRUE;
    ELSIF NOT v_new_is_primary AND v_old_is_primary THEN
        -- Attempting to unset primary: an active family MUST have exactly one primary child.
        SELECT id INTO v_promoted_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_promoted_link_id IS NOT NULL THEN
            UPDATE public.parent_student
            SET is_primary = TRUE, updated_at = now()
            WHERE id = v_promoted_link_id;
        ELSE
            -- No other active child exists; this child MUST remain primary
            v_new_is_primary := TRUE;
        END IF;
    END IF;

    -- Apply update
    UPDATE public.parent_student
    SET relationship = v_new_relationship,
        is_primary = v_new_is_primary,
        updated_at = now()
    WHERE id = _link_id;

    -- Audit log
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
        'guardian_relationship_updated',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'old_relationship', v_old_relationship,
            'new_relationship', v_new_relationship,
            'old_is_primary', v_old_is_primary,
            'new_is_primary', v_new_is_primary,
            'promoted_sibling_link_id', v_promoted_link_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'link_id', _link_id,
        'relationship', v_new_relationship,
        'is_primary', v_new_is_primary,
        'promoted_sibling_link_id', v_promoted_link_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 4. HARDEN fn_admin_set_account_active (Superadmin Tenant Context)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_set_account_active(
    _school_id UUID,
    _target_user_id UUID,
    _is_active BOOLEAN,
    _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_target_profile RECORD;
    v_audit_action TEXT;
    v_protected_emails TEXT[] := ARRAY['admin@admin.com', 'superadmin@edunex.com'];
BEGIN
    v_caller_school := public.get_auth_school_id();

    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot modify account status for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Self-deactivation prevention
    IF auth.uid() = _target_user_id AND NOT _is_active THEN
        RAISE EXCEPTION 'You cannot deactivate your own account';
    END IF;

    -- Target user lookup
    SELECT id, email, full_name, role, school_id, is_active
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_user_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    -- Protected root accounts
    IF v_target_profile.email = ANY(v_protected_emails) AND NOT _is_active THEN
        RAISE EXCEPTION 'This root account is protected and cannot be deactivated';
    END IF;

    -- Tenant validation for both admin and superadmin:
    -- Target user must belong to the effective school (unless platform core user with NULL school_id)
    IF v_target_profile.school_id IS NOT NULL AND v_target_profile.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Access denied: target user belongs to school %, not selected school %', v_target_profile.school_id, v_effective_school;
    END IF;

    -- If no change needed, return current state
    IF v_target_profile.is_active = _is_active THEN
        RETURN jsonb_build_object(
            'success', true,
            'user_id', _target_user_id,
            'is_active', _is_active,
            'message', 'Account status was already ' || CASE WHEN _is_active THEN 'active' ELSE 'inactive' END
        );
    END IF;

    -- Update profiles.is_active
    UPDATE public.profiles
    SET is_active = _is_active,
        updated_at = now()
    WHERE id = _target_user_id;

    -- If deactivating, also immediately revoke any active staff unlock sessions
    IF NOT _is_active THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'account_deactivated'
        WHERE user_id = _target_user_id
          AND is_revoked IS FALSE;
    END IF;

    v_audit_action := CASE WHEN _is_active THEN 'account_activated' ELSE 'account_deactivated' END;

    -- Audit log
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
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_user_id', _target_user_id,
            'target_name', v_target_profile.full_name,
            'target_email', v_target_profile.email,
            'previous_is_active', v_target_profile.is_active,
            'new_is_active', _is_active,
            'reason', _reason
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', _target_user_id,
        'is_active', _is_active
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_set_account_active(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_account_active(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
