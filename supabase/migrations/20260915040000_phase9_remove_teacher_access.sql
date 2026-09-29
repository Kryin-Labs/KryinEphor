-- Migration: 20260915040000_phase9_remove_teacher_access.sql
-- Description: Phase 9 - Safely disable/remove Teacher Access, snapshot assignment history, revoke unlocks, and deny stale JWT operations

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DYNAMIC CHECK CONSTRAINT ON employees.status & AUDIT TABLE STANDARDIZATION
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_con_def text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_con_def
    FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF v_con_def IS NOT NULL AND v_con_def NOT ILIKE '%inactive%' THEN
        ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_status_check;
        ALTER TABLE public.employees ADD CONSTRAINT employees_status_check
            CHECK (status IN ('active', 'inactive', 'resigned', 'terminated', 'on_leave', 'retired'));
    END IF;

    -- Ensure canonical staff_person_name column exists on employees
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'staff_person_name'
    ) THEN
        ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS staff_person_name TEXT;
    END IF;

    -- Ensure canonical admin_action_audit table columns exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'admin_action_audit' AND column_name = 'detail'
    ) THEN
        ALTER TABLE public.admin_action_audit ADD COLUMN IF NOT EXISTS detail JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Standardize: If `details` column exists from earlier migrations, migrate data into `detail` and drop `details`
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'admin_action_audit' AND column_name = 'details'
    ) THEN
        UPDATE public.admin_action_audit
        SET detail = COALESCE(detail, details)
        WHERE details IS NOT NULL AND (detail IS NULL OR detail = '{}'::jsonb);

        ALTER TABLE public.admin_action_audit DROP COLUMN IF EXISTS details;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'admin_action_audit' AND column_name = 'school_id'
    ) THEN
        ALTER TABLE public.admin_action_audit ADD COLUMN IF NOT EXISTS school_id UUID;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. HARDENED CENTRAL AUTHORIZATION HELPER (has_role)
-- Immediate denial of old browser JWTs: requires active role AND active employee record
-- Strictly evaluates Teacher eligibility without conflating Staff PIN / unlock state
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
    SELECT (
        CASE
            WHEN _role = 'teacher' THEN
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    JOIN public.employees e ON e.profile_id = p.id AND e.school_id = p.school_id
                    WHERE p.id = _user_id
                      AND p.is_active = true
                      AND p.deleted_at IS NULL
                      AND e.status = 'active'
                      AND e.deleted_at IS NULL
                      AND (
                          p.role = 'teacher'
                          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'teacher')
                      )
                )
            ELSE
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = _user_id
                      AND p.is_active = true
                      AND p.deleted_at IS NULL
                      AND (
                          p.role = _role
                          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = _role)
                      )
                )
        END
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ASSIGNMENT HISTORY TABLE (teacher_assignment_history)
-- ON DELETE SET NULL to preserve history even if profiles or classes are purged later
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.teacher_assignment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    teacher_name_at_time TEXT,
    employee_id_at_time UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    designation_at_time TEXT,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('class_teacher', 'subject', 'subject_teacher', 'timetable', 'online_class')),
    class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
    class_name_at_time TEXT,
    subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
    subject_name_at_time TEXT,
    source_assignment_id UUID,
    assigned_at TIMESTAMPTZ, -- NOT defaulted to now(). Sourced only when a genuine assignment start date exists, else NULL
    ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unassigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    unassigned_by_name_at_time TEXT,
    ended_reason TEXT NOT NULL DEFAULT 'teacher_access_disabled',
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignment_history_lookup
    ON public.teacher_assignment_history(school_id, teacher_id, ended_at);

ALTER TABLE public.teacher_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_assignment_history_school_select" ON public.teacher_assignment_history;
CREATE POLICY "teacher_assignment_history_school_select"
    ON public.teacher_assignment_history FOR SELECT TO authenticated
    USING (school_id = (SELECT school_id FROM public.profiles WHERE id = auth.uid()));

GRANT SELECT ON public.teacher_assignment_history TO authenticated;
GRANT ALL ON public.teacher_assignment_history TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ACTIVE ASSIGNMENTS DISCOVERY RPC
-- Inspects all 5 operational teaching areas with strict tenant security
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_get_teacher_active_assignments(
    _school_id UUID,
    _teacher_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_superadmin BOOLEAN := FALSE;
    v_is_school_admin BOOLEAN := FALSE;
    v_caller_school_id UUID;
    v_effective_school UUID;
    v_classes JSONB := '[]'::JSONB;
    v_subjects JSONB := '[]'::JSONB;
    v_subject_teachers JSONB := '[]'::JSONB;
    v_timetable JSONB := '[]'::JSONB;
    v_online_classes JSONB := '[]'::JSONB;
    v_total_count INT := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Strict tenant authorization check:
    -- Superadmin can inspect specified school or their own.
    -- School admin / Principal may ONLY inspect their own school (cross-school probe strictly rejected).
    SELECT 
        (p.role = 'superadmin' OR EXISTS (
            SELECT 1 FROM public.user_roles ur 
            WHERE ur.user_id = v_caller_id AND ur.role = 'superadmin'
        )),
        (p.role IN ('admin', 'principal') OR EXISTS (
            SELECT 1 FROM public.user_roles ur 
            WHERE ur.user_id = v_caller_id AND ur.role IN ('admin', 'principal')
        )),
        p.school_id
    INTO v_is_superadmin, v_is_school_admin, v_caller_school_id
    FROM public.profiles p
    WHERE p.id = v_caller_id;

    IF v_is_superadmin THEN
        v_effective_school := COALESCE(_school_id, v_caller_school_id);
    ELSIF v_is_school_admin THEN
        IF _school_id IS NOT NULL AND _school_id <> v_caller_school_id THEN
            RAISE EXCEPTION 'Unauthorized: School admin cannot access teacher assignments for another school';
        END IF;
        v_effective_school := v_caller_school_id;
    ELSE
        RAISE EXCEPTION 'Unauthorized: only school administrators may inspect teacher assignments';
    END IF;

    IF v_effective_school IS NULL THEN
        RAISE EXCEPTION 'School context required';
    END IF;

    -- 1. Classes where this user is Class Teacher
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'class_id', c.id,
                'name', c.name,
                'section', c.section,
                'grade_level', c.grade_level,
                'room_number', c.room_number
            ) ORDER BY c.grade_level ASC, c.name ASC
        ),
        '[]'::JSONB
    )
    INTO v_classes
    FROM public.classes c
    WHERE c.teacher_id = _teacher_profile_id
      AND c.school_id = v_effective_school
      AND c.deleted_at IS NULL;

    -- 2. Subjects directly referencing this teacher
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'subject_id', s.id,
                'name', s.name,
                'code', s.code,
                'class_id', s.class_id,
                'class_name', c.name,
                'class_section', c.section
            ) ORDER BY s.name ASC
        ),
        '[]'::JSONB
    )
    INTO v_subjects
    FROM public.subjects s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.teacher_id = _teacher_profile_id
      AND s.school_id = v_effective_school
      AND s.deleted_at IS NULL;

    -- 3. Subject-Teachers mappings
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', st.id,
                'subject_id', st.subject_id,
                'subject_name', s.name,
                'class_id', st.class_id,
                'class_name', c.name,
                'class_section', c.section,
                'is_primary', st.is_primary
            ) ORDER BY c.name ASC, s.name ASC
        ),
        '[]'::JSONB
    )
    INTO v_subject_teachers
    FROM public.subject_teachers st
    JOIN public.subjects s ON s.id = st.subject_id
    JOIN public.classes c ON c.id = st.class_id
    WHERE st.teacher_id = _teacher_profile_id
      AND st.school_id = v_effective_school;

    -- 4. Timetable slots
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', tt.id,
                'day_of_week', tt.day_of_week,
                'start_time', tt.start_time,
                'end_time', tt.end_time,
                'room', tt.room,
                'class_name', c.name,
                'class_section', c.section,
                'subject_name', s.name
            ) ORDER BY tt.day_of_week ASC, tt.start_time ASC
        ),
        '[]'::JSONB
    )
    INTO v_timetable
    FROM public.timetable tt
    JOIN public.classes c ON c.id = tt.class_id
    JOIN public.subjects s ON s.id = tt.subject_id
    WHERE tt.teacher_id = _teacher_profile_id
      AND tt.school_id = v_effective_school
      AND tt.deleted_at IS NULL;

    -- 5. Active/Live/Future scheduled online classes
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', oc.id,
                'title', oc.title,
                'scheduled_at', oc.scheduled_at,
                'duration_minutes', oc.duration_minutes,
                'platform', oc.platform,
                'status', oc.status,
                'class_name', c.name,
                'subject_name', s.name
            ) ORDER BY oc.scheduled_at ASC
        ),
        '[]'::JSONB
    )
    INTO v_online_classes
    FROM public.online_classes oc
    JOIN public.classes c ON c.id = oc.class_id
    LEFT JOIN public.subjects s ON s.id = oc.subject_id
    WHERE oc.teacher_id = _teacher_profile_id
      AND oc.school_id = v_effective_school
      AND (oc.status = 'live' OR (oc.status = 'scheduled' AND oc.scheduled_at >= now()))
      AND oc.deleted_at IS NULL;

    v_total_count := jsonb_array_length(v_classes) +
                     jsonb_array_length(v_subjects) +
                     jsonb_array_length(v_subject_teachers) +
                     jsonb_array_length(v_timetable) +
                     jsonb_array_length(v_online_classes);

    RETURN jsonb_build_object(
        'has_active_assignments', (v_total_count > 0),
        'total_count', v_total_count,
        'classes', v_classes,
        'subjects', v_subjects,
        'subject_teachers', v_subject_teachers,
        'timetable', v_timetable,
        'online_classes', v_online_classes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_teacher_active_assignments(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_teacher_active_assignments(UUID, UUID) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LOCKED-DOWN INTERNAL TRANSACTIONAL TEACHER DISABLE RPC
-- Strictly accessible ONLY to service_role / postgres from update_admin
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

    -- Fetch actor full name for snapshot attribution
    SELECT full_name INTO v_actor_name
    FROM public.profiles
    WHERE id = _actor_profile_id;

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
        -- assigned_at is set to NULL because classes.created_at is when the class was created, NOT when this teacher was assigned
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
        -- assigned_at is set to NULL because subjects.created_at is not the teacher assignment timestamp
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
        -- subject_teachers is a dedicated assignment join table; its created_at IS the assignment timestamp
        INSERT INTO public.teacher_assignment_history (
            school_id, teacher_id, teacher_name_at_time, employee_id_at_time, designation_at_time,
            assignment_type, subject_id, subject_name_at_time, class_id, class_name_at_time, source_assignment_id, assigned_at, ended_at,
            unassigned_by, unassigned_by_name_at_time, ended_reason, metadata
        )
        SELECT st.school_id, st.teacher_id, COALESCE(v_existing_emp.staff_person_name, v_target_profile.full_name), v_existing_emp.id, v_existing_emp.designation,
               'subject_teacher', st.subject_id, s.name, st.class_id, c.name, st.id, st.created_at, now(),
               _actor_profile_id, v_actor_name, 'teacher_access_disabled',
               jsonb_build_object('academic_year_id', st.academic_year_id, 'is_primary', st.is_primary)
        FROM public.subject_teachers st
        LEFT JOIN public.subjects s ON s.id = st.subject_id
        LEFT JOIN public.classes c ON c.id = st.class_id
        WHERE st.teacher_id = _target_profile_id AND st.school_id = _school_id;
        GET DIAGNOSTICS v_cleared_st = ROW_COUNT;

        DELETE FROM public.subject_teachers
        WHERE teacher_id = _target_profile_id AND school_id = _school_id;

        -- D. Timetable
        -- assigned_at is set to NULL because timetable.created_at is slot creation, not teacher assignment
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
        LEFT JOIN public.subjects s ON s.id = tt.subject_id
        LEFT JOIN public.classes c ON c.id = tt.class_id
        WHERE tt.teacher_id = _target_profile_id AND tt.school_id = _school_id AND tt.deleted_at IS NULL;
        GET DIAGNOSTICS v_cleared_tt = ROW_COUNT;

        UPDATE public.timetable
        SET teacher_id = NULL
        WHERE teacher_id = _target_profile_id AND school_id = _school_id AND deleted_at IS NULL;

        -- E. Online Classes (Clears operational sessions without alias bugs)
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
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'teacher_access_disabled'
    WHERE user_id = _target_profile_id
      AND is_revoked IS FALSE;
    GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;

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
          AND status = 'active';

        -- Check if user already has 'parent' role explicitly in user_roles
        SELECT EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role = 'parent'
        ) INTO v_has_parent_role;

        IF v_active_children_count > 0 OR v_has_parent_role THEN
            -- Legitimate parent persona exists: transition primary role to parent
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

    -- 9. Canonical Audit Logging in admin_action_audit using `detail`
    INSERT INTO public.admin_action_audit (
        actor_id,
        actor_role,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        _actor_profile_id,
        'admin',
        _target_profile_id,
        'teacher_access_disabled',
        jsonb_build_object(
            'actor_id', _actor_profile_id,
            'actor_name', v_actor_name,
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
        'success', true,
        'previous_primary_role', v_prev_role,
        'new_primary_role', v_new_role,
        'primary_role_changed', v_primary_role_changed,
        'assignments_cleared', _clear_assignments,
        'revoked_sessions_count', v_revoked_session_count,
        'cleared_classes', v_cleared_classes,
        'cleared_subjects', v_cleared_subjects,
        'cleared_subject_teachers', v_cleared_st,
        'cleared_timetable', v_cleared_tt,
        'cleared_online_classes', v_cleared_oc
    );
END;
$$;

-- STRICT LOCKDOWN: Internal function only callable by service_role / postgres
REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disable_teacher_access_internal(UUID, UUID, UUID, BOOLEAN) TO service_role, postgres;
