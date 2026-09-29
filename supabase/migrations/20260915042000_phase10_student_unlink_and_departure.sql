-- ════════════════════════════════════════════════════════════════════
-- Phase 10 Migration: Remove or Unlink a Child
-- 
-- 1. Adds student_status to profiles (active, withdrawn, transferred, graduated, inactive)
-- 2. Fixes fn_unlink_student_guardian audit insertion (detail column, actor_role, omits id)
-- 3. Creates fn_set_student_status for controlled departure / status transitions
-- 4. Creates fn_check_student_delete_eligibility to guard against destroying academic history
-- ════════════════════════════════════════════════════════════════════

-- 1. ADD student_status TO PROFILES
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS student_status TEXT DEFAULT 'active'
CHECK (student_status IN ('active', 'withdrawn', 'transferred', 'graduated', 'inactive'));

-- Backfill student_status based on is_active for students
UPDATE public.profiles
SET student_status = CASE WHEN is_active = false THEN 'inactive' ELSE 'active' END
WHERE role = 'student' AND (student_status IS NULL OR student_status = 'active');

CREATE INDEX IF NOT EXISTS idx_profiles_student_status
ON public.profiles(school_id, student_status)
WHERE role = 'student';


-- 2. FIX fn_unlink_student_guardian (AUDIT INSERTION & RECORD PRESERVATION)
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


-- 3. RPC: fn_set_student_status (OPERATION B — STUDENT LEAVES SCHOOL)
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
    v_is_active BOOLEAN;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
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
    IF _new_status NOT IN ('active', 'withdrawn', 'transferred', 'graduated', 'inactive') THEN
        RAISE EXCEPTION 'Invalid student status: %. Must be active, withdrawn, transferred, graduated, or inactive', _new_status;
    END IF;

    -- Fetch target student
    SELECT role, school_id, student_status, full_name
    INTO v_target_role, v_target_school, v_old_status, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Student not found';
    END IF;

    IF v_target_role <> 'student' THEN
        RAISE EXCEPTION 'Target user is not a student (role: %)', v_target_role;
    END IF;

    IF v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    v_is_active := (_new_status = 'active');

    -- Update profile status and metadata departure info (academic records remain untouched)
    UPDATE public.profiles
    SET student_status = _new_status,
        is_active = v_is_active,
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
        _student_id,
        'student_status_changed',
        jsonb_build_object(
            'student_id', _student_id,
            'student_name', v_student_name,
            'previous_status', coalesce(v_old_status, 'active'),
            'new_status', _new_status,
            'reason', _reason,
            'notes', _notes,
            'is_active', v_is_active
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', _student_id,
        'student_name', v_student_name,
        'previous_status', coalesce(v_old_status, 'active'),
        'new_status', _new_status,
        'is_active', v_is_active
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_student_status(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;


-- 4. RPC: fn_check_student_delete_eligibility (OPERATION C — GUARDED HARD DELETE)
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

    IF v_target_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Check attendance (non-deleted)
    SELECT COUNT(*) INTO v_attendance_count
    FROM public.attendance
    WHERE student_id = _student_id AND deleted_at IS NULL;

    -- Check exam results (non-deleted)
    SELECT COUNT(*) INTO v_exam_count
    FROM public.exam_results
    WHERE student_id = _student_id AND deleted_at IS NULL;

    -- Check invoices (non-deleted)
    SELECT COUNT(*) INTO v_invoice_count
    FROM public.invoices
    WHERE student_id = _student_id AND deleted_at IS NULL;

    -- Check transactions
    SELECT COUNT(*) INTO v_tx_count
    FROM public.transactions
    WHERE student_id = _student_id;

    -- Check class enrollments (non-deleted)
    SELECT COUNT(*) INTO v_enrollment_count
    FROM public.class_enrollments
    WHERE student_id = _student_id AND deleted_at IS NULL;

    -- Check homework submissions
    SELECT COUNT(*) INTO v_hw_count
    FROM public.homework_submissions
    WHERE student_id = _student_id;

    -- Check fee assignments (active)
    SELECT COUNT(*) INTO v_fee_assignment_count
    FROM public.student_fee_assignments
    WHERE student_id = _student_id AND is_active = true;

    -- Check active parent/guardian links
    SELECT COUNT(*) INTO v_guardian_count
    FROM public.parent_student
    WHERE student_id = _student_id AND status = 'active';

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
    IF v_enrollment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s active class enrollment(s)', v_enrollment_count));
    END IF;
    IF v_hw_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s homework submission(s)', v_hw_count));
    END IF;
    IF v_fee_assignment_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s active fee assignment(s)', v_fee_assignment_count));
    END IF;
    IF v_guardian_count > 0 THEN
        v_reasons := array_append(v_reasons, format('%s linked family guardian(s)', v_guardian_count));
    END IF;

    v_total_records := v_attendance_count + v_exam_count + v_invoice_count + v_tx_count + v_enrollment_count + v_hw_count + v_fee_assignment_count;

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
            'enrollments', v_enrollment_count,
            'homework', v_hw_count,
            'fee_assignments', v_fee_assignment_count,
            'active_guardians', v_guardian_count
        ),
        'reasons', v_reasons,
        'recommendation', CASE WHEN v_total_records > 0 THEN 'archive' ELSE 'delete_allowed' END,
        'summary', CASE 
            WHEN v_total_records > 0 THEN 
                format('Cannot delete student because %s exist. Archive student or change status instead.', array_to_string(v_reasons, ', '))
            ELSE 
                'No dependent academic or financial records found. Hard deletion allowed.'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_student_delete_eligibility(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_student_delete_eligibility(UUID, UUID) TO authenticated;
