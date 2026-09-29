-- ════════════════════════════════════════════════════════════════════
-- Phase 20 Migration: Student Lifecycle Separation & Deletion Hardening
-- 
-- Fixes findings for commit f9928de (Phase 10):
-- 1. Completely separates student lifecycle from profiles.is_active.
--    fn_set_student_status NEVER touches profiles.is_active.
-- 2. Preserves departed children in family history (fn_get_my_linked_students includes student_status).
-- 3. Creates locked service-only RPC fn_check_student_delete_eligibility_internal
--    deriving actor authorization from profiles.role + user_roles.
-- 4. Expands deletion dependency protection (additional_charges, all fee assignments,
--    class enrollment history, all family guardian links active or historical).
-- 5. Enforces explicit school context for Superadmin (_school_id IS NULL -> exception).
-- ════════════════════════════════════════════════════════════════════

-- 1. RPC: fn_set_student_status
-- NEVER touches profiles.is_active.
-- Enforces explicit school context for Superadmin.
-- Supports student capability via primary role or user_roles.
CREATE OR REPLACE FUNCTION public.fn_set_student_status(
    _school_id UUID,
    _student_id UUID,
    _new_status TEXT,
    _reason TEXT DEFAULT NULL,
    _notes TEXT DEFAULT NULL
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
    v_old_status TEXT;
    v_target_role TEXT;
    v_target_school UUID;
    v_student_name TEXT;
    v_audit_action TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot modify student status for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Validate new status
    IF _new_status NOT IN ('active', 'withdrawn', 'transferred', 'graduated', 'inactive', 'archived') THEN
        RAISE EXCEPTION 'Invalid student status: %. Must be active, withdrawn, transferred, graduated, inactive, or archived', _new_status;
    END IF;

    -- Fetch target student
    SELECT role, school_id, student_status, full_name
    INTO v_target_role, v_target_school, v_old_status, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Student not found';
    END IF;

    -- Check student capability (primary role or user_roles)
    IF v_target_role <> 'student' AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _student_id AND ur.role = 'student'
    ) THEN
        RAISE EXCEPTION 'Target user does not have student capability (role: %)', v_target_role;
    END IF;

    IF v_target_school IS NULL OR v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Update profile student_status and metadata departure info ONLY.
    -- NEVER modify profiles.is_active. Student lifecycle is independent from account/login authority.
    UPDATE public.profiles
    SET student_status = _new_status,
        metadata = jsonb_set(
            coalesce(metadata, '{}'::jsonb),
            '{departure_info}',
            jsonb_build_object(
                'status', _new_status,
                'previous_status', coalesce(v_old_status, 'active'),
                'reason', _reason,
                'notes', _notes,
                'updated_at', now(),
                'updated_by', auth.uid()
            )
        ),
        updated_at = now()
    WHERE id = _student_id;

    -- Determine canonical audit action name
    IF _new_status = 'archived' OR _new_status = 'inactive' THEN
        v_audit_action := 'student archived';
    ELSIF _new_status = 'withdrawn' THEN
        v_audit_action := 'student withdrawn';
    ELSE
        v_audit_action := 'student status changed';
    END IF;

    -- Canonical Audit log
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
        _student_id,
        v_audit_action,
        jsonb_build_object(
            'student_id', _student_id,
            'student_name', v_student_name,
            'previous_status', coalesce(v_old_status, 'active'),
            'new_status', _new_status,
            'reason', _reason,
            'notes', _notes
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', _student_id,
        'student_name', v_student_name,
        'previous_status', coalesce(v_old_status, 'active'),
        'new_status', _new_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;


-- 2. RPC: fn_check_student_delete_eligibility (Browser-facing authenticated check)
CREATE OR REPLACE FUNCTION public.fn_check_student_delete_eligibility(
    _school_id UUID,
    _student_id UUID
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
    v_target_role TEXT;
    v_target_school UUID;
    v_student_name TEXT;
    
    v_attendance_count INT := 0;
    v_exam_count INT := 0;
    v_invoice_count INT := 0;
    v_tx_count INT := 0;
    v_additional_charges_count INT := 0;
    v_enrollment_count INT := 0;
    v_hw_count INT := 0;
    v_fee_assignment_count INT := 0;
    v_guardian_count INT := 0;
    v_total_records INT := 0;
    v_reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot inspect student records for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Verify target student
    SELECT role, school_id, full_name
    INTO v_target_role, v_target_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    -- Check student capability (primary role or user_roles)
    IF v_target_role <> 'student' AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _student_id AND ur.role = 'student'
    ) THEN
        RAISE EXCEPTION 'Target user does not have student capability (role: %)', v_target_role;
    END IF;

    IF v_target_school IS NULL OR v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Check attendance
    SELECT COUNT(*) INTO v_attendance_count
    FROM public.attendance
    WHERE student_id = _student_id;

    -- Check exam results
    SELECT COUNT(*) INTO v_exam_count
    FROM public.exam_results
    WHERE student_id = _student_id;

    -- Check invoices
    SELECT COUNT(*) INTO v_invoice_count
    FROM public.invoices
    WHERE student_id = _student_id;

    -- Check transactions
    SELECT COUNT(*) INTO v_tx_count
    FROM public.transactions
    WHERE student_id = _student_id;

    -- Check additional charges
    SELECT COUNT(*) INTO v_additional_charges_count
    FROM public.additional_charges
    WHERE student_id = _student_id;

    -- Check class enrollments (all history)
    SELECT COUNT(*) INTO v_enrollment_count
    FROM public.class_enrollments
    WHERE student_id = _student_id;

    -- Check homework submissions
    SELECT COUNT(*) INTO v_hw_count
    FROM public.homework_submissions
    WHERE student_id = _student_id;

    -- Check fee assignments (all history, active or inactive)
    SELECT COUNT(*) INTO v_fee_assignment_count
    FROM public.student_fee_assignments
    WHERE student_id = _student_id;

    -- Check family guardian relationships (all history, active or inactive/unlinked)
    SELECT COUNT(*) INTO v_guardian_count
    FROM public.parent_student
    WHERE student_id = _student_id;

    IF v_attendance_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s attendance record(s)', v_attendance_count));
    END IF;
    IF v_exam_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s exam result(s)', v_exam_count));
    END IF;
    IF v_invoice_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s invoice(s)', v_invoice_count));
    END IF;
    IF v_tx_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s payment transaction(s)', v_tx_count));
    END IF;
    IF v_additional_charges_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s additional charge(s)', v_additional_charges_count));
    END IF;
    IF v_enrollment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s class enrollment(s)', v_enrollment_count));
    END IF;
    IF v_hw_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s homework submission(s)', v_hw_count));
    END IF;
    IF v_fee_assignment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s fee assignment(s)', v_fee_assignment_count));
    END IF;
    IF v_guardian_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s family guardian relationship(s) (active or historical)', v_guardian_count));
    END IF;

    -- v_total_records includes guardian relationships and all dependencies
    v_total_records := v_attendance_count + v_exam_count + v_invoice_count + v_tx_count + v_additional_charges_count + v_enrollment_count + v_hw_count + v_fee_assignment_count + v_guardian_count;

    RETURN jsonb_build_object(
        'can_delete', (v_total_records = 0),
        'student_id', _student_id,
        'student_name', v_student_name,
        'total_records', v_total_records,
        'record_counts', jsonb_build_object(
            'attendance', v_attendance_count,
            'exam_results', v_exam_count,
            'invoices', v_invoice_count,
            'transactions', v_tx_count,
            'additional_charges', v_additional_charges_count,
            'enrollments', v_enrollment_count,
            'homework', v_hw_count,
            'fee_assignments', v_fee_assignment_count,
            'guardians', v_guardian_count
        ),
        'reasons', v_reasons,
        'recommendation', CASE WHEN v_total_records > 0 THEN 'archive' ELSE 'delete_allowed' END,
        'summary', CASE 
            WHEN v_total_records > 0 THEN 
                format('Cannot delete student because %s exist. Archive student or change status instead.', array_to_string(v_reasons, ', '))
            ELSE 
                'No dependent academic, financial, or family records found. Hard deletion allowed.'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_student_delete_eligibility(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_student_delete_eligibility(UUID, UUID) TO authenticated;


-- 3. RPC: fn_check_student_delete_eligibility_internal (LOCKED SERVICE-ONLY FUNCTION)
-- Derives actor authorization from authoritative DB state (_actor_id).
-- REVOKED from PUBLIC, anon, authenticated. GRANTED to service_role ONLY.
CREATE OR REPLACE FUNCTION public.fn_check_student_delete_eligibility_internal(
    _school_id UUID,
    _student_id UUID,
    _actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_actor_profile RECORD;
    v_actor_roles TEXT[];
    v_effective_school UUID;
    v_target_role TEXT;
    v_target_school UUID;
    v_student_name TEXT;
    
    v_attendance_count INT := 0;
    v_exam_count INT := 0;
    v_invoice_count INT := 0;
    v_tx_count INT := 0;
    v_additional_charges_count INT := 0;
    v_enrollment_count INT := 0;
    v_hw_count INT := 0;
    v_fee_assignment_count INT := 0;
    v_guardian_count INT := 0;
    v_total_records INT := 0;
    v_reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF _actor_id IS NULL THEN
        RAISE EXCEPTION 'Actor ID is required';
    END IF;

    -- Fetch and validate actor profile
    SELECT role, school_id, is_active, deleted_at
    INTO v_actor_profile
    FROM public.profiles
    WHERE id = _actor_id;

    IF v_actor_profile.role IS NULL THEN
        RAISE EXCEPTION 'Actor profile not found';
    END IF;

    IF v_actor_profile.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Access denied: actor is deleted';
    END IF;

    IF v_actor_profile.is_active = FALSE THEN
        RAISE EXCEPTION 'Access denied: actor account is inactive';
    END IF;

    -- Derive all actor roles (primary + user_roles)
    SELECT ARRAY[v_actor_profile.role] || COALESCE(array_agg(ur.role), ARRAY[]::TEXT[])
    INTO v_actor_roles
    FROM public.user_roles ur
    WHERE ur.user_id = _actor_id;

    IF NOT ('superadmin' = ANY(v_actor_roles) OR 'admin' = ANY(v_actor_roles)) THEN
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    IF 'superadmin' = ANY(v_actor_roles) THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
        v_effective_school := _school_id;
    ELSE
        -- Admin role: check tenant match
        IF v_actor_profile.school_id IS NULL OR _school_id IS NULL OR _school_id <> v_actor_profile.school_id THEN
            RAISE EXCEPTION 'Access denied: cannot inspect student records for another school';
        END IF;
        v_effective_school := v_actor_profile.school_id;
    END IF;

    -- Verify target student
    SELECT role, school_id, full_name
    INTO v_target_role, v_target_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    -- Check student capability (primary role or user_roles)
    IF v_target_role <> 'student' AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _student_id AND ur.role = 'student'
    ) THEN
        RAISE EXCEPTION 'Target user does not have student capability (role: %)', v_target_role;
    END IF;

    IF v_target_school IS NULL OR v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Check attendance
    SELECT COUNT(*) INTO v_attendance_count
    FROM public.attendance
    WHERE student_id = _student_id;

    -- Check exam results
    SELECT COUNT(*) INTO v_exam_count
    FROM public.exam_results
    WHERE student_id = _student_id;

    -- Check invoices
    SELECT COUNT(*) INTO v_invoice_count
    FROM public.invoices
    WHERE student_id = _student_id;

    -- Check transactions
    SELECT COUNT(*) INTO v_tx_count
    FROM public.transactions
    WHERE student_id = _student_id;

    -- Check additional charges
    SELECT COUNT(*) INTO v_additional_charges_count
    FROM public.additional_charges
    WHERE student_id = _student_id;

    -- Check class enrollments (all history)
    SELECT COUNT(*) INTO v_enrollment_count
    FROM public.class_enrollments
    WHERE student_id = _student_id;

    -- Check homework submissions
    SELECT COUNT(*) INTO v_hw_count
    FROM public.homework_submissions
    WHERE student_id = _student_id;

    -- Check fee assignments (all history, active or inactive)
    SELECT COUNT(*) INTO v_fee_assignment_count
    FROM public.student_fee_assignments
    WHERE student_id = _student_id;

    -- Check family guardian relationships (all history, active or inactive/unlinked)
    SELECT COUNT(*) INTO v_guardian_count
    FROM public.parent_student
    WHERE student_id = _student_id;

    IF v_attendance_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s attendance record(s)', v_attendance_count));
    END IF;
    IF v_exam_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s exam result(s)', v_exam_count));
    END IF;
    IF v_invoice_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s invoice(s)', v_invoice_count));
    END IF;
    IF v_tx_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s payment transaction(s)', v_tx_count));
    END IF;
    IF v_additional_charges_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s additional charge(s)', v_additional_charges_count));
    END IF;
    IF v_enrollment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s class enrollment(s)', v_enrollment_count));
    END IF;
    IF v_hw_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s homework submission(s)', v_hw_count));
    END IF;
    IF v_fee_assignment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s fee assignment(s)', v_fee_assignment_count));
    END IF;
    IF v_guardian_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s family guardian relationship(s) (active or historical)', v_guardian_count));
    END IF;

    -- Total records includes guardian relationships and all dependencies
    v_total_records := v_attendance_count + v_exam_count + v_invoice_count + v_tx_count + v_additional_charges_count + v_enrollment_count + v_hw_count + v_fee_assignment_count + v_guardian_count;

    RETURN jsonb_build_object(
        'can_delete', (v_total_records = 0),
        'student_id', _student_id,
        'student_name', v_student_name,
        'total_records', v_total_records,
        'record_counts', jsonb_build_object(
            'attendance', v_attendance_count,
            'exam_results', v_exam_count,
            'invoices', v_invoice_count,
            'transactions', v_tx_count,
            'additional_charges', v_additional_charges_count,
            'enrollments', v_enrollment_count,
            'homework', v_hw_count,
            'fee_assignments', v_fee_assignment_count,
            'guardians', v_guardian_count
        ),
        'reasons', v_reasons,
        'recommendation', CASE WHEN v_total_records > 0 THEN 'archive' ELSE 'delete_allowed' END,
        'summary', CASE 
            WHEN v_total_records > 0 THEN 
                format('Cannot delete student because %s exist. Archive student or change status instead.', array_to_string(v_reasons, ', '))
            ELSE 
                'No dependent academic, financial, or family records found. Hard deletion allowed.'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_student_delete_eligibility_internal(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_student_delete_eligibility_internal(UUID, UUID, UUID) TO service_role;


-- 4. HARDEN fn_unlink_student_guardian FOR SUPERADMIN SCHOOL CONTEXT
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
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'Explicit school context required';
        END IF;
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

    IF v_link_school IS NULL OR v_link_school <> v_effective_school THEN
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

    -- Check remaining active children in the same school
    SELECT COUNT(*) INTO v_remaining_children
    FROM public.parent_student
    WHERE parent_id = v_parent_id
      AND school_id = v_effective_school
      AND status = 'active';

    -- If this was the primary child and other children remain, promote the next active child
    IF v_was_primary AND v_remaining_children > 0 THEN
        SELECT id INTO v_next_link_id
        FROM public.parent_student
        WHERE parent_id = v_parent_id
          AND school_id = v_effective_school
          AND status = 'active'
        ORDER BY updated_at DESC, created_at ASC
        LIMIT 1;

        IF v_next_link_id IS NOT NULL THEN
            UPDATE public.parent_student
            SET is_primary = true, updated_at = now()
            WHERE id = v_next_link_id;
        END IF;
    END IF;

    -- If 0 active children remain, evaluate other capabilities
    IF v_remaining_children = 0 THEN
        -- Check active teacher capability
        SELECT EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = v_parent_id
              AND e.school_id = v_effective_school
              AND e.status = 'active'
              AND e.is_active = TRUE
              AND e.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_parent_id AND ur.role = 'teacher')
        ) INTO v_has_active_teacher;

        -- Check other staff capabilities
        IF NOT v_has_active_teacher THEN
            SELECT ur.role INTO v_other_staff_role
            FROM public.user_roles ur
            WHERE ur.user_id = v_parent_id
              AND ur.role IN ('accountant', 'receptionist', 'admin', 'principal')
            LIMIT 1;
        END IF;

        IF v_has_active_teacher THEN
            v_new_primary_role := 'teacher';
            UPDATE public.profiles
            SET role = 'teacher', updated_at = now()
            WHERE id = v_parent_id;
            v_has_active_persona := true;
        ELSIF v_other_staff_role IS NOT NULL THEN
            v_new_primary_role := v_other_staff_role;
            UPDATE public.profiles
            SET role = v_other_staff_role, updated_at = now()
            WHERE id = v_parent_id;
            v_has_active_persona := true;
        ELSE
            -- No teacher, no staff, no children: no active school persona remaining
            v_has_active_persona := false;
        END IF;
    END IF;

    -- Canonical Audit log
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
            'other_staff_role', v_other_staff_role,
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


-- 5. PRESERVE DEPARTED CHILDREN IN FAMILY HISTORY (fn_get_my_linked_students)
-- Returns active guardian-student links and includes student_status.
-- Does NOT filter out non-active students so historical academic/financial info remains accessible.
DROP FUNCTION IF EXISTS public.fn_get_my_linked_students();
CREATE OR REPLACE FUNCTION public.fn_get_my_linked_students()
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  email TEXT,
  school_id UUID,
  relationship TEXT,
  is_primary BOOLEAN,
  status TEXT,
  avatar_url TEXT,
  class_name TEXT,
  section_name TEXT,
  student_status TEXT
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH authorized_students AS (
    -- Direct parent_student links: returns all active links regardless of student_status
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      ps.school_id,
      ps.relationship,
      ps.is_primary,
      ps.status,
      p.avatar_url,
      COALESCE(p.student_status, 'active') AS student_status
    FROM public.parent_student ps
    JOIN public.profiles p ON p.id = ps.student_id
    WHERE ps.parent_id = auth.uid()
      AND ps.status = 'active'
      AND p.deleted_at IS NULL

    UNION

    -- Backward compatibility for pure student account without self-link row yet
    SELECT
      p.id AS student_id,
      p.full_name,
      p.email,
      p.school_id,
      'self_student' AS relationship,
      TRUE AS is_primary,
      'active' AS status,
      p.avatar_url,
      COALESCE(p.student_status, 'active') AS student_status
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role = 'student' OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'student'))
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.parent_student ps WHERE ps.parent_id = auth.uid()
      )
  )
  SELECT
    s.student_id,
    s.full_name,
    s.email,
    s.school_id,
    s.relationship,
    s.is_primary,
    s.status,
    s.avatar_url,
    enrollment.class_name,
    enrollment.section_name,
    s.student_status
  FROM authorized_students s
  LEFT JOIN LATERAL (
    SELECT c.name AS class_name, c.section AS section_name
    FROM public.class_enrollments ce
    JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
    WHERE ce.student_id = s.student_id
      AND ce.deleted_at IS NULL
    ORDER BY ce.enrolled_at DESC NULLS LAST, c.created_at DESC NULLS LAST
    LIMIT 1
  ) enrollment ON TRUE
  ORDER BY s.is_primary DESC, s.full_name ASC, s.student_id ASC;
$$;

REVOKE ALL ON FUNCTION public.fn_get_my_linked_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_linked_students() TO authenticated;


-- 6. ENHANCE fn_get_my_persona_summary TO PASS student_status
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
    SELECT id, email, full_name, role, school_id, student_status
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

    -- Fetch linked students/children with class, section & student_status
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'student_id', s.student_id,
                'full_name', s.full_name,
                'email', s.email,
                'school_id', s.school_id,
                'relationship', s.relationship,
                'is_primary', s.is_primary,
                'status', s.status,
                'avatar_url', s.avatar_url,
                'class_name', s.class_name,
                'section_name', s.section_name,
                'student_status', s.student_status
            ) ORDER BY s.is_primary DESC, s.full_name ASC, s.student_id ASC
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
        'student_status', v_profile.student_status,
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
