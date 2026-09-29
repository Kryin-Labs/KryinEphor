-- Migration: 20260915041000_phase9_post_verification_hardening.sql
-- Description: Phase 9 Post-Verification Hardening
-- 1. Restrict teacher_assignment_history SELECT RLS exclusively to Superadmin and same-school Admin/Principal.
-- 2. Accurately attribute fn_disable_teacher_access_internal audit events with dynamic actor_role and top-level school_id.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. RESTRICT teacher_assignment_history SELECT RLS
-- Disallow ordinary students and parents; allow only Superadmin and same-school Admin/Principal
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "teacher_assignment_history_school_select" ON public.teacher_assignment_history;
DROP POLICY IF EXISTS "teacher_assignment_history_admin_select" ON public.teacher_assignment_history;

CREATE POLICY "teacher_assignment_history_admin_select"
    ON public.teacher_assignment_history FOR SELECT TO authenticated
    USING (
        -- Platform Superadmin
        public.has_role(auth.uid(), 'superadmin')
        OR (
            -- School Admin or Principal of the same school
            school_id = (
                SELECT p.school_id FROM public.profiles p
                WHERE p.id = auth.uid() AND p.deleted_at IS NULL
            )
            AND (
                public.has_role(auth.uid(), 'admin')
                OR public.has_role(auth.uid(), 'principal')
            )
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. HARDEN fn_disable_teacher_access_internal AUDIT ATTRIBUTION
-- Dynamically fetch actor_role from profiles and populate top-level school_id
-- ═══════════════════════════════════════════════════════════════════════════
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
                -- Promote the remaining valid role to primary (never make them parent!)
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

    -- 9. Canonical Audit Logging in admin_action_audit using `detail` with correct actor_role and school_id
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

REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) TO service_role, postgres;
