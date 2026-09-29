-- ==============================================================================
-- Migration: 20260924230000_post_phase20_security_definer_and_account_deactivation.sql
-- Description: Post-Phase 20 Security Hardening:
--   1. Drop obsolete fn_verify_staff_pin(uuid, text, jsonb) overload.
--   2. Harmonize fn_revoke_staff_session to single canonical signature with
--      strict REVOKE ALL FROM PUBLIC, anon and GRANT TO authenticated.
--   3. Ensure fn_admin_set_account_active sets revoked_at = NOW() on deactivation.
--   4. Re-affirm distinct account deactivation vs student/teacher/guardian lifecycle.
-- ==============================================================================

-- 1. DROP OBSOLETE OVERLOADS
DROP FUNCTION IF EXISTS public.fn_verify_staff_pin(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.fn_revoke_staff_session(TEXT);

-- 2. CANONICAL fn_revoke_staff_session
CREATE OR REPLACE FUNCTION public.fn_revoke_staff_session(
    _session_token TEXT,
    _reason TEXT DEFAULT 'manual_lock'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session RECORD;
BEGIN
    IF _session_token IS NULL OR trim(_session_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session token required');
    END IF;

    SELECT id, user_id, is_revoked
    INTO v_session
    FROM public.staff_unlock_sessions
    WHERE session_token = _session_token;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session not found');
    END IF;

    -- Only allow the session owner or an admin/superadmin to revoke
    IF auth.uid() <> v_session.user_id AND 
       NOT public.has_role(auth.uid(), 'admin') AND 
       NOT public.has_role(auth.uid(), 'superadmin') THEN
        RAISE EXCEPTION 'Access denied: cannot revoke another user''s staff unlock session';
    END IF;

    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_at = now(),
        revoked_reason = COALESCE(_reason, 'manual_lock')
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Staff session revoked successfully'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_revoke_staff_session(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revoke_staff_session(TEXT, TEXT) TO authenticated;

-- 3. HARDEN fn_admin_set_account_active TO RECORD revoked_at
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

-- 4. HARDEN fn_update_guardian_relationship TRANSIENT PRIMARY UNIQUENESS
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
            -- First demote the current link to avoid transient uniqueness conflict with uq_parent_student_active_primary
            UPDATE public.parent_student
            SET is_primary = FALSE, updated_at = now()
            WHERE id = _link_id;

            -- Then promote the sibling
            UPDATE public.parent_student
            SET is_primary = TRUE, updated_at = now()
            WHERE id = v_promoted_link_id;
        ELSE
            -- No other active child exists; this child MUST remain primary
            v_new_is_primary := TRUE;
        END IF;
    END IF;

    -- Apply update to the target link
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

-- 5. HARDEN fn_setup_or_change_staff_pin (Staff capability enforcement)
CREATE OR REPLACE FUNCTION public.fn_setup_or_change_staff_pin(
    _school_id UUID,
    _target_user_id UUID,
    _new_pin TEXT,
    _current_pin TEXT DEFAULT NULL,
    _is_temporary BOOLEAN DEFAULT false
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
    v_revoked_count INT;
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

    -- Must have an active staff employment record or superadmin
    IF v_target_emp_id IS NULL AND NOT public.has_role(v_caller_id, 'superadmin') THEN
        RAISE EXCEPTION 'Access denied: staff PIN can only be configured for active staff members';
    END IF;

    -- Lookup existing PIN
    SELECT * INTO v_existing_pin
    FROM public.staff_pins
    WHERE user_id = _target_user_id AND school_id = _school_id;

    -- Check caller permissions
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

        v_must_change := FALSE;
    ELSE
        -- Admin reset
        IF NOT public.has_role(v_caller_id, 'admin') AND NOT public.has_role(v_caller_id, 'superadmin') THEN
            RAISE EXCEPTION 'Access denied: administrator privileges required to reset staff PIN';
        END IF;
        v_must_change := TRUE;
        v_audit_action := 'staff PIN reset';
    END IF;

    -- Generate secure hash using blowfish salt (NEVER log this)
    v_new_hash := extensions.crypt(_new_pin, extensions.gen_salt('bf', 10));

    -- Upsert PIN
    INSERT INTO public.staff_pins (
        user_id,
        school_id,
        pin_hash,
        failed_attempts,
        locked_until,
        is_temporary,
        must_change,
        updated_at
    ) VALUES (
        _target_user_id,
        _school_id,
        v_new_hash,
        0,
        NULL,
        _is_temporary,
        v_must_change,
        now()
    )
    ON CONFLICT (user_id, school_id) DO UPDATE SET
        pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = NULL,
        is_temporary = EXCLUDED.is_temporary,
        must_change = EXCLUDED.must_change,
        updated_at = now();

    -- Revoke all existing active unlock sessions for this user on PIN change
    WITH revoked AS (
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'PIN_CHANGED',
            revoked_at = now()
        WHERE user_id = _target_user_id
          AND is_revoked IS FALSE
        RETURNING id
    )
    SELECT count(*) INTO v_revoked_count FROM revoked;

    -- Canonical Audit log (zero sensitive exposure)
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
            'is_self_setup', (v_caller_id = _target_user_id),
            'is_temporary', _is_temporary,
            'must_change', v_must_change,
            'target_staff_identity', v_target_emp_id,
            'prior_sessions_revoked', v_revoked_count,
            'school_id', _school_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'must_change', v_must_change
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;


