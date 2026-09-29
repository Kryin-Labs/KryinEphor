-- ====================================================================
-- MIGRATION: 20260925000000_post_phase21_critical_fixes.sql
-- Description: Targeted hardening pass resolving:
--   1. Drop RPC overloads for fn_admin_set_account_active and fn_disable_teacher_access_internal
--   2. Atomic Teacher-only removal rejection (CANNOT_DISABLE_NO_OTHER_PERSONA) and persona fallbacks
--   3. Validate target is real, active student in fn_link_student_guardian
--   4. Authoritative account deactivation in fn_can_access_student and operational RLS
--   5. Transactional tenant user setup RPC for create_tenant_admin (fn_setup_tenant_user_domain)
--   6. Canonical guardian relationship whitelist matching UI (Mother, Father, Guardian, Legal Guardian, etc.)
--   7. Staff PIN temporary/must_change enforcement, active staff target requirement, and tenant check in fn_check_staff_pin_status
--   8. Teacher assignment discovery and clearing soft-delete alignment and online class unassign without cancel
--   9. Homework RLS enrollment soft-delete and tenancy alignment
-- ====================================================================

-- ────────────────────────────────────────────────────────────────────
-- 1. DROP OBSOLETE OVERLOADS (Item 1)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_admin_set_account_active(UUID, UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID);

DROP FUNCTION IF EXISTS public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT);

DROP FUNCTION IF EXISTS public.fn_check_staff_pin_status(UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_update_guardian_relationship(UUID, UUID, TEXT, BOOLEAN);


-- ────────────────────────────────────────────────────────────────────
-- 2. CANONICAL fn_admin_set_account_active (Exactly 1 Function)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_set_account_active(
    _target_user_id UUID,
    _is_active BOOLEAN,
    _reason TEXT DEFAULT NULL,
    _school_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT;
    v_caller_school UUID;
    v_effective_school UUID;
    v_target_profile RECORD;
    v_protected_emails TEXT[] := ARRAY['support@kryinephor.com', 'admin@kryinephor.com', 'narcoroot@gmail.com', 'arth@gmail.com'];
    v_audit_action TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role NOT IN ('superadmin', 'admin') THEN
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    v_effective_school := COALESCE(_school_id, v_caller_school);

    SELECT id, email, full_name, role, school_id, is_active, deleted_at
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

    -- Prevent self-deactivation
    IF v_caller_id = _target_user_id AND NOT _is_active THEN
        RAISE EXCEPTION 'Self-deactivation is prohibited';
    END IF;

    -- Tenant boundary validation:
    -- School Admin must NEVER manage NULL-school/platform profiles or users from other schools
    IF v_caller_role = 'admin' THEN
        IF v_target_profile.school_id IS NULL OR v_caller_school IS NULL OR v_target_profile.school_id <> v_caller_school THEN
            RAISE EXCEPTION 'Access denied: school admin may only manage users belonging to their own school';
        END IF;
    ELSIF v_target_profile.school_id IS NOT NULL AND v_effective_school IS NOT NULL AND v_target_profile.school_id <> v_effective_school THEN
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

    -- If deactivating, also immediately revoke any active staff unlock sessions with explicit revoked_at
    IF NOT _is_active THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_at = now(),
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
        v_caller_id,
        v_caller_role,
        COALESCE(v_target_profile.school_id, v_effective_school),
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_user_id', _target_user_id,
            'target_email', v_target_profile.email,
            'target_name', v_target_profile.full_name,
            'target_role', v_target_profile.role,
            'is_active', _is_active,
            'reason', COALESCE(_reason, 'Admin action')
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', _target_user_id,
        'is_active', _is_active,
        'previous_state', v_target_profile.is_active,
        'reason', _reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_account_active(UUID, BOOLEAN, TEXT, UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 3. CANONICAL fn_disable_teacher_access_internal (Exactly 1 Function)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_disable_teacher_access_internal(
    _school_id UUID,
    _target_profile_id UUID,
    _actor_profile_id UUID,
    _clear_assignments BOOLEAN DEFAULT FALSE,
    _notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_target_profile RECORD;
    v_existing_emp RECORD;
    v_actor_role TEXT;
    v_actor_name TEXT;
    v_assigned_classes_count INT := 0;
    v_assigned_subjects_count INT := 0;
    v_assigned_subject_teachers_count INT := 0;
    v_assigned_timetable_count INT := 0;
    v_assigned_online_classes_count INT := 0;
    v_active_children_count INT := 0;
    v_has_parent_role BOOLEAN := FALSE;
    v_new_role TEXT := NULL;
    v_revoked_session_count INT := 0;
BEGIN
    SELECT id, email, full_name, role, school_id, is_active, deleted_at
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_profile_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    IF v_target_profile.school_id <> _school_id THEN
        RAISE EXCEPTION 'Target user belongs to school %, not %', v_target_profile.school_id, _school_id;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- ITEM 2: ATOMIC PERSONA CHECK BEFORE ANY MUTATION
    -- ─────────────────────────────────────────────────────────────────
    IF v_target_profile.role = 'teacher' THEN
        -- Check if user has a real parent persona (active linked children or parent capability in user_roles)
        SELECT COUNT(*) INTO v_active_children_count
        FROM public.parent_student
        WHERE parent_id = _target_profile_id
          AND school_id = _school_id
          AND status = 'active'
          AND student_id <> _target_profile_id;

        SELECT EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role = 'parent'
        ) INTO v_has_parent_role;

        IF v_active_children_count > 0 OR v_has_parent_role THEN
            v_new_role := 'parent';
        ELSE
            -- Check for other legitimate work personas in user_roles
            SELECT role INTO v_new_role
            FROM public.user_roles
            WHERE user_id = _target_profile_id AND role <> 'teacher'
            ORDER BY CASE role
                WHEN 'admin' THEN 1
                WHEN 'superadmin' THEN 2
                WHEN 'accountant' THEN 3
                WHEN 'receptionist' THEN 4
                WHEN 'student' THEN 5
                ELSE 6
            END ASC
            LIMIT 1;
        END IF;

        -- Teacher-only with no valid fallback persona MUST BE ATOMICALLY REJECTED
        IF v_new_role IS NULL THEN
            RAISE EXCEPTION 'CANNOT_DISABLE_NO_OTHER_PERSONA';
        END IF;
    ELSE
        -- Primary role is not teacher (e.g. parent who also had teacher role in user_roles)
        v_new_role := v_target_profile.role;
    END IF;

    SELECT full_name, role INTO v_actor_name, v_actor_role
    FROM public.profiles
    WHERE id = _actor_profile_id;

    SELECT * INTO v_existing_emp
    FROM public.employees
    WHERE profile_id = _target_profile_id 
      AND school_id = _school_id 
      AND deleted_at IS NULL;

    -- ─────────────────────────────────────────────────────────────────
    -- ITEM 8: ACTIVE ASSIGNMENT DISCOVERY (soft-delete aware)
    -- ─────────────────────────────────────────────────────────────────
    SELECT COUNT(*) INTO v_assigned_classes_count
    FROM public.classes
    WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_assigned_subjects_count
    FROM public.subjects
    WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_assigned_subject_teachers_count
    FROM public.subject_teachers
    WHERE teacher_id = _target_profile_id AND school_id = _school_id;

    SELECT COUNT(*) INTO v_assigned_timetable_count
    FROM public.timetable
    WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_assigned_online_classes_count
    FROM public.online_classes
    WHERE teacher_id = _target_profile_id 
      AND school_id = _school_id
      AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now()))
      AND deleted_at IS NULL;

    IF (v_assigned_classes_count > 0 OR 
        v_assigned_subjects_count > 0 OR 
        v_assigned_subject_teachers_count > 0 OR 
        v_assigned_timetable_count > 0 OR 
        v_assigned_online_classes_count > 0) AND NOT _clear_assignments THEN
        RAISE EXCEPTION 'Active assignments exist (% classes, % subjects, % subject-teacher links, % timetable slots, % active online classes). Cannot disable teacher without explicit assignment clearing authorization.',
            v_assigned_classes_count,
            v_assigned_subjects_count,
            v_assigned_subject_teachers_count,
            v_assigned_timetable_count,
            v_assigned_online_classes_count;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- ITEM 8: ACTIVE ASSIGNMENT CLEARING & HISTORY ARCHIVING
    -- ─────────────────────────────────────────────────────────────────
    IF _clear_assignments THEN
        -- A. Classes
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT c.school_id, c.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'class_teacher', c.id, c.name, c.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('name', c.name, 'section', c.section, 'grade_level', c.grade_level, 'source_row_created_at', c.created_at)
        FROM public.classes c
        WHERE c.teacher_id = _target_profile_id AND c.school_id = _school_id AND c.deleted_at IS NULL;

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
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('name', s.name, 'code', s.code, 'source_row_created_at', s.created_at)
        FROM public.subjects s
        LEFT JOIN public.classes c ON c.id = s.class_id
        WHERE s.teacher_id = _target_profile_id AND s.school_id = _school_id AND s.deleted_at IS NULL;

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
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('subject_id', st.subject_id, 'class_id', st.class_id, 'source_row_created_at', st.created_at)
        FROM public.subject_teachers st
        JOIN public.subjects s ON s.id = st.subject_id
        JOIN public.classes c ON c.id = st.class_id
        WHERE st.teacher_id = _target_profile_id AND st.school_id = _school_id;

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
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('day_of_week', tt.day_of_week, 'start_time', tt.start_time, 'end_time', tt.end_time, 'room', tt.room, 'source_row_created_at', tt.created_at)
        FROM public.timetable tt
        JOIN public.classes c ON c.id = tt.class_id
        JOIN public.subjects s ON s.id = tt.subject_id
        WHERE tt.teacher_id = _target_profile_id AND tt.school_id = _school_id AND tt.deleted_at IS NULL;

        UPDATE public.timetable
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- E. Online Classes: UNASSIGN ONLY, DO NOT CANCEL (Item 8)
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT oc.school_id, oc.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'online_class', oc.subject_id, s.name, oc.class_id, c.name, oc.id, NULL, now(),
               _actor_profile_id, v_actor_name, COALESCE(_notes, 'teacher_access_disabled'),
               jsonb_build_object('title', oc.title, 'scheduled_at', oc.scheduled_at, 'status', oc.status, 'source_row_created_at', oc.created_at)
        FROM public.online_classes oc
        LEFT JOIN public.subjects s ON s.id = oc.subject_id
        LEFT JOIN public.classes c ON c.id = oc.class_id
        WHERE oc.teacher_id = _target_profile_id AND oc.school_id = _school_id
          AND (oc.status = 'live' OR (oc.status = 'scheduled' AND oc.scheduled_at >= now()))
          AND oc.deleted_at IS NULL;

        UPDATE public.online_classes 
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id 
          AND school_id = _school_id
          AND (status = 'live' OR (status = 'scheduled' AND scheduled_at >= now()))
          AND deleted_at IS NULL;
    END IF;

    -- Revoke Active Staff Unlock Sessions with explicit revoked_at
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions'
    ) THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_at = now(),
            revoked_reason = 'teacher_access_disabled'
        WHERE user_id = _target_profile_id
          AND is_revoked IS FALSE;
        GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;
    END IF;

    IF v_existing_emp.id IS NOT NULL THEN
        UPDATE public.employees
        SET status = 'inactive'
        WHERE id = v_existing_emp.id;
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = _target_profile_id
      AND role = 'teacher';

    -- Update primary profile role to the resolved fallback persona
    IF v_target_profile.role = 'teacher' AND v_new_role IS NOT NULL THEN
        UPDATE public.profiles
        SET role = v_new_role, updated_at = now()
        WHERE id = _target_profile_id;
    END IF;

    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        _actor_profile_id,
        v_actor_role,
        _school_id,
        _target_profile_id,
        'teacher_access_disabled',
        jsonb_build_object(
            'target_user_id', _target_profile_id,
            'cleared_assignments', _clear_assignments,
            'cleared_classes', v_assigned_classes_count,
            'cleared_subjects', v_assigned_subjects_count,
            'cleared_subject_teachers', v_assigned_subject_teachers_count,
            'cleared_timetable', v_assigned_timetable_count,
            'cleared_online_classes', v_assigned_online_classes_count,
            'revoked_sessions', v_revoked_session_count,
            'old_primary_role', v_target_profile.role,
            'new_primary_role', v_new_role,
            'primary_role_changed', (v_target_profile.role <> v_new_role),
            'notes', _notes
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'target_user_id', _target_profile_id,
        'new_primary_role', v_new_role,
        'primary_role_changed', (v_target_profile.role <> v_new_role),
        'cleared_assignments', _clear_assignments,
        'cleared_classes', v_assigned_classes_count,
        'cleared_subjects', v_assigned_subjects_count,
        'cleared_subject_teachers', v_assigned_subject_teachers_count,
        'cleared_timetable', v_assigned_timetable_count,
        'cleared_online_classes', v_assigned_online_classes_count,
        'revoked_sessions', v_revoked_session_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN, TEXT) TO service_role;


-- ────────────────────────────────────────────────────────────────────
-- 4. HARDEN fn_link_student_guardian & fn_update_guardian_relationship
--    (Items 3 & 6: Student Verification + Canonical Relationship Whitelist)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_link_student_guardian(
    _school_id UUID,
    _parent_id UUID,
    _student_id UUID,
    _relationship TEXT DEFAULT 'Parent',
    _is_primary BOOLEAN DEFAULT false
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
    v_parent_role TEXT;
    v_parent_school UUID;
    v_student_role TEXT;
    v_student_school UUID;
    v_student_deleted_at TIMESTAMPTZ;
    v_link_id UUID;
    v_link_status TEXT;
    v_was_reactivated BOOLEAN := FALSE;
    v_student_name TEXT;
    v_parent_name TEXT;
    v_active_children_count INT := 0;
    v_make_primary BOOLEAN;
    v_norm_rel TEXT;
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
            RAISE EXCEPTION 'Access denied: cannot link students for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Prevent self-linking
    IF _parent_id = _student_id THEN
        RAISE EXCEPTION 'A user cannot be linked to themselves as a guardian';
    END IF;

    -- Item 6: Server-validate relationship value against canonical whitelist (reject self_student)
    v_norm_rel := LOWER(TRIM(COALESCE(_relationship, '')));
    IF v_norm_rel = 'self_student' THEN
        RAISE EXCEPTION 'Invalid relationship: self_student is reserved for internal accounts';
    END IF;

    IF v_norm_rel NOT IN (
        'mother', 'father', 'guardian', 'legal guardian', 'parent',
        'son', 'daughter', 'child', 'ward', 'other authorized guardian',
        'primary guardian', 'emergency contact'
    ) THEN
        RAISE EXCEPTION 'Invalid relationship: %. Must be one of: Mother, Father, Guardian, Legal Guardian, Parent, Son, Daughter, Child, Ward, Other authorized guardian, Primary guardian, Emergency contact', _relationship;
    END IF;

    -- ─────────────────────────────────────────────────────────────────
    -- ITEM 3: RESTORE STUDENT VERIFICATION
    -- Must prove _student_id is actually a student, non-deleted, and same school
    -- ─────────────────────────────────────────────────────────────────
    SELECT role, school_id, full_name, deleted_at 
    INTO v_student_role, v_student_school, v_student_name, v_student_deleted_at
    FROM public.profiles
    WHERE id = _student_id;

    IF v_student_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    IF v_student_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot link deleted student profile';
    END IF;

    IF v_student_school IS NULL OR v_student_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Ensure target is actually a student
    IF v_student_role <> 'student' AND NOT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = _student_id AND role = 'student'
    ) THEN
        RAISE EXCEPTION 'Target user % is not a student (role: %)', _student_id, v_student_role;
    END IF;

    -- Validate target parent
    SELECT role, school_id, full_name INTO v_parent_role, v_parent_school, v_parent_name
    FROM public.profiles
    WHERE id = _parent_id AND deleted_at IS NULL;

    IF v_parent_role IS NULL THEN
        RAISE EXCEPTION 'Parent profile not found';
    END IF;

    IF v_parent_school IS NULL OR v_parent_school <> v_effective_school THEN
        RAISE EXCEPTION 'Parent does not belong to school %', v_effective_school;
    END IF;

    -- Check for existing link
    SELECT id, status INTO v_link_id, v_link_status
    FROM public.parent_student
    WHERE parent_id = _parent_id AND student_id = _student_id;

    -- Primary Child Invariant:
    SELECT COUNT(*) INTO v_active_children_count
    FROM public.parent_student
    WHERE parent_id = _parent_id 
      AND school_id = v_effective_school 
      AND status = 'active'
      AND student_id <> _student_id;

    v_make_primary := CASE 
        WHEN v_active_children_count = 0 THEN TRUE 
        ELSE COALESCE(_is_primary, FALSE) 
    END;

    IF v_make_primary THEN
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE parent_id = _parent_id 
          AND school_id = v_effective_school 
          AND student_id <> _student_id 
          AND is_primary = TRUE;
    END IF;

    IF v_link_id IS NOT NULL THEN
        IF v_link_status = 'unlinked' THEN
            v_was_reactivated := TRUE;
        END IF;

        UPDATE public.parent_student
        SET status = 'active',
            relationship = _relationship,
            is_primary = v_make_primary,
            school_id = v_effective_school,
            updated_at = now()
        WHERE id = v_link_id;
    ELSE
        INSERT INTO public.parent_student (
            parent_id,
            student_id,
            relationship,
            is_primary,
            school_id,
            status,
            created_by,
            created_at,
            updated_at
        ) VALUES (
            _parent_id,
            _student_id,
            _relationship,
            v_make_primary,
            v_effective_school,
            'active',
            auth.uid(),
            now(),
            now()
        )
        RETURNING id INTO v_link_id;
    END IF;

    -- Ensure guardian has parent role capability in user_roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_parent_id, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;

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
        'child linked',
        jsonb_build_object(
            'link_id', v_link_id,
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'relationship', _relationship,
            'is_primary', v_make_primary,
            'reactivated', v_was_reactivated
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'link_id', v_link_id,
        'reactivated', v_was_reactivated,
        'is_primary', v_make_primary,
        'student_id', _student_id,
        'parent_id', _parent_id,
        'relationship', _relationship
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_link_student_guardian(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_update_guardian_relationship(
    _link_id UUID,
    _school_id UUID,
    _relationship TEXT,
    _is_primary BOOLEAN
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
    v_new_relationship TEXT;
    v_old_is_primary BOOLEAN;
    v_new_is_primary BOOLEAN;
    v_parent_id UUID;
    v_student_id UUID;
    v_parent_name TEXT;
    v_student_name TEXT;
    v_promoted_link_id UUID;
    v_norm_rel TEXT;
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

    IF v_link.school_id IS NULL OR v_link.school_id <> v_effective_school THEN
        RAISE EXCEPTION 'Relationship link does not belong to school %', v_effective_school;
    END IF;

    v_parent_id := v_link.parent_id;
    v_student_id := v_link.student_id;
    v_old_relationship := v_link.relationship;
    v_old_is_primary := v_link.is_primary;

    v_new_relationship := COALESCE(NULLIF(TRIM(_relationship), ''), v_old_relationship);
    v_new_is_primary := COALESCE(_is_primary, v_old_is_primary);

    -- Item 6: Server-validate relationship value against canonical whitelist (reject self_student)
    v_norm_rel := LOWER(TRIM(v_new_relationship));
    IF v_norm_rel = 'self_student' THEN
        RAISE EXCEPTION 'Invalid relationship: self_student is reserved for internal accounts';
    END IF;

    IF v_norm_rel NOT IN (
        'mother', 'father', 'guardian', 'legal guardian', 'parent',
        'son', 'daughter', 'child', 'ward', 'other authorized guardian',
        'primary guardian', 'emergency contact'
    ) THEN
        RAISE EXCEPTION 'Invalid relationship: %. Must be one of: Mother, Father, Guardian, Legal Guardian, Parent, Son, Daughter, Child, Ward, Other authorized guardian, Primary guardian, Emergency contact', v_new_relationship;
    END IF;

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name INTO v_parent_name FROM public.profiles WHERE id = v_parent_id;

    -- Primary Child Invariant:
    IF v_new_is_primary = TRUE THEN
        UPDATE public.parent_student
        SET is_primary = FALSE,
            updated_at = now()
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND id <> _link_id
          AND is_primary = TRUE;
    ELSE
        -- If user tried to set is_primary = FALSE, check if another active primary child exists
        IF NOT EXISTS (
            SELECT 1 FROM public.parent_student
            WHERE parent_id = v_parent_id
              AND school_id = v_effective_school
              AND id <> _link_id
              AND status = 'active'
              AND is_primary = TRUE
        ) THEN
            -- Automatically promote the oldest remaining active child to preserve primary invariant
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
                SET is_primary = TRUE,
                    updated_at = now()
                WHERE id = v_promoted_link_id;
            ELSE
                -- No other active children exist: this single child MUST remain primary
                v_new_is_primary := TRUE;
            END IF;
        END IF;
    END IF;

    UPDATE public.parent_student
    SET relationship = v_new_relationship,
        is_primary = v_new_is_primary,
        updated_at = now()
    WHERE id = _link_id;

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
        'guardian relationship updated',
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
-- 5. HARDEN fn_can_access_student (Item 4: Authoritative Active Check)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_access_student(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_actor_school UUID;
    v_is_superadmin BOOLEAN;
    v_is_active BOOLEAN;
BEGIN
    IF v_actor_id IS NULL OR target_student_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check actor profile, active status, and school
    SELECT school_id, (role = 'superadmin'), is_active
    INTO v_actor_school, v_is_superadmin, v_is_active
    FROM public.profiles
    WHERE id = v_actor_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Deactivated caller CANNOT access any student data regardless of old JWT
    IF v_is_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- Superadmin has system-wide access
    IF v_is_superadmin IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- Non-superadmin must belong to a valid school tenant
    IF v_actor_school IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Case 1: Caller is the student directly
    IF target_student_id = v_actor_id THEN
        RETURN EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = v_actor_id
              AND p.is_active IS TRUE
              AND (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
              AND p.school_id = v_actor_school
              AND p.deleted_at IS NULL
        );
    END IF;

    -- Case 2: Parent/Guardian relationship in public.parent_student
    RETURN EXISTS (
        SELECT 1
        FROM public.parent_student ps
        JOIN public.profiles s ON s.id = ps.student_id AND s.deleted_at IS NULL
        WHERE ps.parent_id = v_actor_id
          AND ps.student_id = target_student_id
          AND ps.status = 'active'
          AND ps.school_id = v_actor_school
          AND s.school_id = v_actor_school
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_can_access_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_access_student(UUID) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────
-- 6. HARDEN HOMEWORK SELECT & OPERATIONAL POLICIES (Items 4 & 9)
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "homework_select_policy" ON public.homework;
CREATE POLICY "homework_select_policy"
  ON public.homework FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND (
            teacher_id = auth.uid()
            OR public.fn_is_assigned_teacher_for_class(class_id)
            OR EXISTS (
              SELECT 1 FROM public.subject_teachers st
              WHERE st.class_id = homework.class_id
                AND st.subject_id = homework.subject_id
                AND st.teacher_id = auth.uid()
                AND st.school_id = public.get_auth_school_id()
            )
          )
        )
      )
    )
    OR (
      school_id = public.get_auth_school_id()
      AND EXISTS (
        SELECT 1 FROM public.class_enrollments ce
        WHERE ce.class_id = homework.class_id
          AND ce.school_id = homework.school_id
          AND ce.deleted_at IS NULL
          AND public.fn_can_access_student(ce.student_id)
      )
    )
  );

-- Table: ATTENDANCE SELECT (remove unvalidated student_id = auth.uid() bypass)
DROP POLICY IF EXISTS "attendance_select_policy" ON public.attendance;
CREATE POLICY "attendance_select_policy"
  ON public.attendance FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'receptionist')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
    OR public.fn_can_access_student(student_id)
  );

-- Table: EXAM_RESULTS SELECT (remove unvalidated student_id = auth.uid() bypass)
DROP POLICY IF EXISTS "exam_results_select_policy" ON public.exam_results;
CREATE POLICY "exam_results_select_policy"
  ON public.exam_results FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_exam_subject(exam_subject_id)
        )
      )
    )
    OR public.fn_can_access_student(student_id)
  );

-- Table: CLASS_ENROLLMENTS SELECT (remove unvalidated student_id = auth.uid() bypass)
DROP POLICY IF EXISTS "class_enrollments_select_policy" ON public.class_enrollments;
CREATE POLICY "class_enrollments_select_policy"
  ON public.class_enrollments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'receptionist')
        OR public.has_role(auth.uid(), 'accountant')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
    OR public.fn_can_access_student(student_id)
  );

-- Table: HOMEWORK_SUBMISSIONS SELECT (remove unvalidated student_id = auth.uid() bypass)
DROP POLICY IF EXISTS "homework_submissions_select" ON public.homework_submissions;
CREATE POLICY "homework_submissions_select"
  ON public.homework_submissions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_homework(homework_id)
        )
      )
    )
    OR public.fn_can_access_student(student_id)
  );


-- ────────────────────────────────────────────────────────────────────
-- 7. STAFF PIN RPCs (Item 7)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_setup_or_change_staff_pin(
    _school_id UUID,
    _target_user_id UUID,
    _new_pin TEXT,
    _current_pin TEXT DEFAULT NULL,
    _is_temporary BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_existing_pin RECORD;
    v_new_hash TEXT;
    v_must_change BOOLEAN;
    v_is_temp BOOLEAN;
    v_revoked_count INT := 0;
    v_target_emp_id UUID;
    v_audit_action TEXT;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_auth_role();

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    -- Validate format: 4 to 8 numeric digits
    IF _new_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'Invalid format: PIN must be between 4 and 8 numeric digits';
    END IF;

    -- Fetch employee identity and verify active staff status
    SELECT id INTO v_target_emp_id
    FROM public.employees
    WHERE profile_id = _target_user_id 
      AND school_id = _school_id
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1;

    -- Superadmin must NOT be able to issue Staff PIN to target with no valid active employee record
    IF v_target_emp_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: staff PIN can only be configured for active staff members';
    END IF;

    -- Lookup existing PIN
    SELECT * INTO v_existing_pin
    FROM public.staff_pins
    WHERE user_id = _target_user_id AND school_id = _school_id;

    -- Check caller permissions & tenant boundary
    IF v_caller_id = _target_user_id THEN
        -- Self setup or change
        IF v_existing_pin.id IS NOT NULL THEN
            IF _current_pin IS NULL OR _current_pin = '' THEN
                RAISE EXCEPTION 'Current PIN is required to change Staff PIN';
            END IF;

            IF extensions.crypt(_current_pin, v_existing_pin.pin_hash) != v_existing_pin.pin_hash THEN
                RAISE EXCEPTION 'Incorrect current PIN';
            END IF;
            v_audit_action := 'staff PIN changed';
        ELSE
            v_audit_action := 'staff PIN configured';
        END IF;

        -- Self-chosen PIN: is_temporary = false, must_change = false (unless explicitly temporary)
        v_is_temp := COALESCE(_is_temporary, FALSE);
        v_must_change := CASE WHEN v_is_temp THEN TRUE ELSE FALSE END;
    ELSE
        -- Admin reset: enforce strict tenant boundary
        IF public.has_role(v_caller_id, 'superadmin') THEN
            NULL; -- Superadmin allowed across tenants
        ELSIF public.has_role(v_caller_id, 'admin') THEN
            IF public.get_auth_school_id() IS NULL OR public.get_auth_school_id() <> _school_id THEN
                RAISE EXCEPTION 'Access denied: cannot reset staff PIN for another school';
            END IF;
        ELSE
            RAISE EXCEPTION 'Access denied: administrator privileges required to reset staff PIN';
        END IF;

        -- Admin-issued PIN: is_temporary = true, must_change = true
        v_must_change := TRUE;
        v_is_temp := COALESCE(_is_temporary, TRUE);
        v_audit_action := 'staff PIN reset';
    END IF;

    -- Generate secure hash using blowfish salt (NEVER log raw PIN or hash)
    v_new_hash := extensions.crypt(_new_pin, extensions.gen_salt('bf', 10));

    -- Upsert PIN with is_temporary and must_change explicitly populated
    INSERT INTO public.staff_pins (
        user_id,
        school_id,
        pin_hash,
        must_change,
        is_temporary,
        failed_attempts,
        locked_until,
        created_at,
        updated_at
    ) VALUES (
        _target_user_id,
        _school_id,
        v_new_hash,
        v_must_change,
        v_is_temp,
        0,
        NULL,
        now(),
        now()
    )
    ON CONFLICT (user_id, school_id) DO UPDATE SET
        pin_hash = EXCLUDED.pin_hash,
        must_change = EXCLUDED.must_change,
        is_temporary = EXCLUDED.is_temporary,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = now();

    -- Invalidate all existing unlock sessions upon PIN change/reset with revoked_at populated
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'PIN_CHANGED',
        revoked_at = now()
    WHERE user_id = _target_user_id
      AND school_id = _school_id
      AND is_revoked IS FALSE;

    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

    -- Audit log PIN modification (no PIN or hash in detail)
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        v_caller_id,
        v_caller_role,
        _school_id,
        _target_user_id,
        v_audit_action,
        jsonb_build_object(
            'target_user_id', _target_user_id,
            'is_self_service', (v_caller_id = _target_user_id),
            'must_change', v_must_change,
            'is_temporary', v_is_temp,
            'sessions_revoked', v_revoked_count
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE WHEN v_caller_id = _target_user_id THEN 'Staff PIN successfully updated' ELSE 'Staff PIN reset by administrator' END,
        'must_change', v_must_change,
        'is_temporary', v_is_temp,
        'sessions_revoked', v_revoked_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;


CREATE OR REPLACE FUNCTION public.fn_check_staff_pin_status(_school_id UUID, _target_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT := public.get_auth_role();
    v_caller_school UUID := public.get_auth_school_id();
    v_pin_row RECORD;
    v_is_locked BOOLEAN := FALSE;
    v_remaining_attempts INT := 5;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Default to caller if target not provided
    IF _target_user_id IS NULL OR _target_user_id = v_caller_id THEN
        v_user_id := v_caller_id;
    ELSE
        -- Admin / Superadmin can check status of staff members
        IF v_caller_role NOT IN ('superadmin', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
        END IF;

        -- School Admin may inspect only same-school staff
        IF v_caller_role = 'admin' THEN
            IF v_caller_school IS NULL OR v_caller_school <> _school_id THEN
                RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_CROSS_SCHOOL');
            END IF;
        END IF;

        -- Verify target user belongs to this school
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = _target_user_id AND school_id = _school_id AND deleted_at IS NULL
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'TARGET_NOT_IN_SCHOOL');
        END IF;

        v_user_id := _target_user_id;
    END IF;

    SELECT * INTO v_pin_row
    FROM public.staff_pins
    WHERE user_id = v_user_id AND school_id = _school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'has_pin', false,
            'must_change', false,
            'is_locked', false,
            'locked_until', null,
            'attempts_remaining', 5,
            'is_temporary', false
        );
    END IF;

    IF v_pin_row.locked_until IS NOT NULL AND v_pin_row.locked_until > now() THEN
        v_is_locked := TRUE;
        v_remaining_attempts := 0;
    ELSE
        v_is_locked := FALSE;
        v_remaining_attempts := GREATEST(0, 5 - v_pin_row.failed_attempts);
    END IF;

    RETURN jsonb_build_object(
        'has_pin', true,
        'must_change', v_pin_row.must_change,
        'is_locked', v_is_locked,
        'locked_until', v_pin_row.locked_until,
        'attempts_remaining', v_remaining_attempts,
        'is_temporary', COALESCE(v_pin_row.is_temporary, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_staff_pin_status(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_staff_pin_status(UUID, UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 8. TRANSACTIONAL TENANT USER SETUP RPC (Item 5)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_setup_tenant_user_domain(
    _user_id UUID,
    _email TEXT,
    _full_name TEXT,
    _role TEXT,
    _school_id UUID,
    _caller_id UUID,
    _class_id UUID DEFAULT NULL,
    _guardian_id UUID DEFAULT NULL,
    _guardian_relationship TEXT DEFAULT 'Parent',
    _is_primary_guardian BOOLEAN DEFAULT NULL,
    _combined_account BOOLEAN DEFAULT FALSE,
    _employee_designation TEXT DEFAULT NULL,
    _employee_department TEXT DEFAULT NULL,
    _employee_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_school UUID;
    v_norm_rel TEXT;
    v_guardian_profile RECORD;
    v_system_role RECORD;
    v_other_children_count INT := 0;
    v_should_be_primary BOOLEAN;
BEGIN
    SELECT role, school_id INTO v_caller_role, v_caller_school
    FROM public.profiles
    WHERE id = _caller_id AND is_active IS TRUE AND deleted_at IS NULL;

    IF v_caller_role NOT IN ('superadmin', 'admin') THEN
        RAISE EXCEPTION 'Access denied: admin authorization required';
    END IF;

    IF v_caller_role = 'admin' AND (v_caller_school IS NULL OR v_caller_school <> _school_id) THEN
        RAISE EXCEPTION 'Access denied: school admin may only configure users for their own school';
    END IF;

    -- 1. Profile Upsert
    INSERT INTO public.profiles (
        id, email, login_id, full_name, role, school_id, is_active, created_at, updated_at
    ) VALUES (
        _user_id, _email, _email, _full_name, _role, _school_id, true, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        login_id = EXCLUDED.login_id,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        school_id = EXCLUDED.school_id,
        is_active = true,
        updated_at = now();

    -- 2. Combined parent-student account
    IF _combined_account THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (_user_id, 'parent')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    -- 3. Membership
    IF _school_id IS NOT NULL THEN
        SELECT id INTO v_system_role
        FROM public.roles
        WHERE name = _role AND is_system IS TRUE
        LIMIT 1;

        INSERT INTO public.memberships (user_id, school_id, role_id, status)
        VALUES (_user_id, _school_id, v_system_role.id, 'active')
        ON CONFLICT (user_id, school_id) DO UPDATE SET
            role_id = EXCLUDED.role_id,
            status = 'active';
    END IF;

    -- 4. Teacher employee record
    IF _role = 'teacher' THEN
        INSERT INTO public.employees (
            profile_id, school_id, designation, department, status, staff_person_name
        ) VALUES (
            _user_id,
            _school_id,
            COALESCE(NULLIF(TRIM(_employee_designation), ''), 'Teacher'),
            COALESCE(NULLIF(TRIM(_employee_department), ''), 'Academics'),
            'active',
            COALESCE(NULLIF(TRIM(_employee_name), ''), _full_name)
        )
        ON CONFLICT (profile_id, school_id) DO UPDATE SET
            designation = EXCLUDED.designation,
            department = EXCLUDED.department,
            status = 'active',
            staff_person_name = EXCLUDED.staff_person_name;
    END IF;

    -- 5. Student domain setup (Self-link & Guardian link)
    IF _role = 'student' THEN
        -- Self-link
        INSERT INTO public.parent_student (
            parent_id, student_id, school_id, relationship, is_primary, status, created_at, updated_at
        ) VALUES (
            _user_id, _user_id, _school_id, 'self_student', true, 'active', now(), now()
        )
        ON CONFLICT (parent_id, student_id) DO UPDATE SET
            status = 'active',
            is_primary = true,
            updated_at = now();

        -- Guardian link
        IF _guardian_id IS NOT NULL THEN
            SELECT id, school_id, is_active, deleted_at INTO v_guardian_profile
            FROM public.profiles
            WHERE id = _guardian_id;

            IF v_guardian_profile.id IS NULL THEN
                RAISE EXCEPTION 'Selected guardian not found';
            END IF;

            IF v_guardian_profile.deleted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Selected guardian account is deleted';
            END IF;

            IF v_guardian_profile.school_id IS NULL OR v_guardian_profile.school_id <> _school_id THEN
                RAISE EXCEPTION 'Selected guardian belongs to a different school';
            END IF;

            -- Validate relationship
            v_norm_rel := LOWER(TRIM(COALESCE(_guardian_relationship, '')));
            IF v_norm_rel = 'self_student' OR v_norm_rel NOT IN (
                'mother', 'father', 'guardian', 'legal guardian', 'parent',
                'son', 'daughter', 'child', 'ward', 'other authorized guardian',
                'primary guardian', 'emergency contact'
            ) THEN
                RAISE EXCEPTION 'Invalid guardian relationship: %', _guardian_relationship;
            END IF;

            SELECT COUNT(*) INTO v_other_children_count
            FROM public.parent_student
            WHERE parent_id = _guardian_id
              AND school_id = _school_id
              AND status = 'active';

            v_should_be_primary := (v_other_children_count = 0) OR (_is_primary_guardian IS NOT FALSE);

            IF v_should_be_primary THEN
                UPDATE public.parent_student
                SET is_primary = FALSE, updated_at = now()
                WHERE parent_id = _guardian_id
                  AND school_id = _school_id
                  AND status = 'active'
                  AND is_primary = TRUE;
            END IF;

            INSERT INTO public.parent_student (
                parent_id, student_id, school_id, relationship, is_primary, status, created_by, created_at, updated_at
            ) VALUES (
                _guardian_id, _user_id, _school_id, _guardian_relationship, v_should_be_primary, 'active', _caller_id, now(), now()
            )
            ON CONFLICT (parent_id, student_id) DO UPDATE SET
                relationship = EXCLUDED.relationship,
                is_primary = EXCLUDED.is_primary,
                status = 'active',
                updated_at = now();

            INSERT INTO public.user_roles (user_id, role)
            VALUES (_guardian_id, 'parent')
            ON CONFLICT (user_id, role) DO NOTHING;

            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                _caller_id,
                v_caller_role,
                _school_id,
                _guardian_id,
                'child linked',
                jsonb_build_object(
                    'parent_id', _guardian_id,
                    'student_id', _user_id,
                    'student_name', _full_name,
                    'relationship', _guardian_relationship,
                    'is_primary', v_should_be_primary,
                    'created_new_student', true
                ),
                now()
            );
        END IF;
    END IF;

    -- 6. Class enrollment (if provided)
    IF _class_id IS NOT NULL THEN
        -- Verify class belongs to this school and is not deleted
        IF NOT EXISTS (
            SELECT 1 FROM public.classes
            WHERE id = _class_id AND school_id = _school_id AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Target class % not found or not active in this school', _class_id;
        END IF;

        INSERT INTO public.class_enrollments (class_id, school_id, student_id, created_at)
        VALUES (_class_id, _school_id, _user_id, now())
        ON CONFLICT (class_id, student_id) DO UPDATE SET
            deleted_at = NULL;
    END IF;

    -- 7. Audit log user creation
    INSERT INTO public.admin_action_audit (
        actor_id, actor_role, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        _caller_id,
        v_caller_role,
        _school_id,
        _user_id,
        'user_created',
        jsonb_build_object(
            'target_user_id', _user_id,
            'email', _email,
            'full_name', _full_name,
            'role', _role,
            'school_id', _school_id,
            'class_id', _class_id,
            'guardian_id', _guardian_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', _user_id,
        'role', _role,
        'school_id', _school_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_setup_tenant_user_domain(UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT) TO service_role;
