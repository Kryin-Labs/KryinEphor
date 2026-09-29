-- ====================================================================
-- Migration: 20260925010000_post_phase21_critical_hardening_followup.sql
-- Description: Post-Phase-21 Critical Security Follow-up:
--   1. Harden fn_admin_set_account_active:
--      - Require caller to be active (is_active = true) and not deleted (deleted_at IS NULL)
--      - Determine role via public.has_role() to support user_roles capabilities
--      - Prevent self-reactivation/deactivation by inactive accounts
--      - Enforce explicit _school_id context when Superadmin mutates school-owned users
--   2. Harden Staff PIN functions against deactivated accounts:
--      - fn_setup_or_change_staff_pin: requires caller is_active and deleted_at IS NULL
--      - fn_check_staff_pin_status: returns ACCOUNT_INACTIVE_OR_DELETED if caller deactivated
--      - fn_verify_staff_pin: returns ACCOUNT_INACTIVE_OR_DELETED if caller deactivated
--      - fn_validate_staff_session: returns ACCOUNT_INACTIVE_OR_DELETED if caller deactivated
--      - fn_revoke_staff_session: rejects inactive/deleted callers
--   3. Harden fn_setup_tenant_user_domain:
--      - Validate school tenant is not deleted and active
--      - Fix primary child default logic: COALESCE(_is_primary_guardian, FALSE)
-- ====================================================================

-- ────────────────────────────────────────────────────────────────────
-- 1. HARDEN fn_admin_set_account_active
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
    v_caller_rec RECORD;
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

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at
    INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Access denied: caller account is inactive or deleted';
    END IF;

    -- Determine authoritative role capability (supporting both profiles.role and user_roles)
    IF public.has_role(v_caller_id, 'superadmin') THEN
        v_caller_role := 'superadmin';
    ELSIF public.has_role(v_caller_id, 'admin') THEN
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;
    v_caller_school := v_caller_rec.school_id;

    -- Fetch target profile
    SELECT id, email, full_name, role, school_id, is_active, deleted_at
    INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_user_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user not found';
    END IF;

    -- Protected root accounts cannot be deactivated
    IF v_target_profile.email = ANY(v_protected_emails) AND NOT _is_active THEN
        RAISE EXCEPTION 'This root account is protected and cannot be deactivated';
    END IF;

    -- Prevent self-deactivation
    IF v_caller_id = _target_user_id AND NOT _is_active THEN
        RAISE EXCEPTION 'Self-deactivation is prohibited';
    END IF;

    -- Tenant boundary and explicit school context validation:
    IF v_caller_role = 'admin' THEN
        -- School Admin must NEVER manage NULL-school/platform profiles or users from other schools
        IF v_target_profile.school_id IS NULL OR v_caller_school IS NULL OR v_target_profile.school_id <> v_caller_school THEN
            RAISE EXCEPTION 'Access denied: school admin may only manage users belonging to their own school';
        END IF;
        v_effective_school := v_caller_school;
    ELSIF v_caller_role = 'superadmin' THEN
        -- Superadmin mutating a school-owned target MUST provide explicit _school_id context
        IF v_target_profile.school_id IS NOT NULL THEN
            IF _school_id IS NULL THEN
                RAISE EXCEPTION 'School context (_school_id) is required when managing school-owned user';
            END IF;
            IF v_target_profile.school_id <> _school_id THEN
                RAISE EXCEPTION 'Access denied: target user belongs to school %, not selected school %', v_target_profile.school_id, _school_id;
            END IF;
            v_effective_school := _school_id;
        ELSE
            -- Platform user (no school)
            v_effective_school := NULL;
        END IF;
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

    -- If deactivating, immediately revoke active staff unlock sessions with explicit revoked_at
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
-- 2. HARDEN fn_setup_or_change_staff_pin
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
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
    v_caller_role TEXT;
    v_existing_pin RECORD;
    v_new_hash TEXT;
    v_must_change BOOLEAN;
    v_is_temp BOOLEAN;
    v_revoked_count INT := 0;
    v_target_emp_id UUID;
    v_audit_action TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at
    INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Access denied: caller account is inactive or deleted';
    END IF;

    -- Determine caller role capability
    IF public.has_role(v_caller_id, 'superadmin') THEN
        v_caller_role := 'superadmin';
    ELSIF public.has_role(v_caller_id, 'admin') THEN
        v_caller_role := 'admin';
    ELSIF public.has_role(v_caller_id, 'teacher') THEN
        v_caller_role := 'teacher';
    ELSE
        v_caller_role := v_caller_rec.role;
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

    -- Superadmin & Admin must NOT be able to issue Staff PIN to target with no valid active employee record
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
            NULL; -- Superadmin can manage staff across schools
        ELSIF public.has_role(v_caller_id, 'admin') THEN
            IF v_caller_rec.school_id IS NULL OR v_caller_rec.school_id <> _school_id THEN
                RAISE EXCEPTION 'Access denied: cannot manage staff PIN for another school';
            END IF;
        ELSE
            RAISE EXCEPTION 'Access denied: administrator privileges required to change another user''s PIN';
        END IF;

        -- Admin-set PIN: default is_temporary = true, must_change = true
        v_is_temp := COALESCE(_is_temporary, TRUE);
        v_must_change := TRUE;
        v_audit_action := 'staff PIN reset by administrator';
    END IF;

    -- Compute bcrypt hash with cost factor 10
    v_new_hash := extensions.crypt(_new_pin, extensions.gen_salt('bf', 10));

    -- Upsert staff PIN record
    INSERT INTO public.staff_pins (
        user_id,
        school_id,
        pin_hash,
        must_change,
        failed_attempts,
        locked_until,
        is_temporary,
        updated_at
    ) VALUES (
        _target_user_id,
        _school_id,
        v_new_hash,
        v_must_change,
        0,
        null,
        v_is_temp,
        now()
    )
    ON CONFLICT (user_id, school_id) DO UPDATE SET
        pin_hash = EXCLUDED.pin_hash,
        must_change = EXCLUDED.must_change,
        failed_attempts = 0,
        locked_until = null,
        is_temporary = EXCLUDED.is_temporary,
        updated_at = now();

    -- Immediately revoke existing staff sessions with explicit revoked_at
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'PIN_CHANGED',
        revoked_at = now()
    WHERE user_id = _target_user_id
      AND school_id = _school_id
      AND is_revoked IS FALSE;

    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

    -- Audit log PIN modification
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


-- ────────────────────────────────────────────────────────────────────
-- 3. HARDEN fn_check_staff_pin_status
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_check_staff_pin_status(_school_id UUID, _target_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
    v_pin_row RECORD;
    v_is_locked BOOLEAN := FALSE;
    v_remaining_attempts INT := 5;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE_OR_DELETED');
    END IF;

    -- Default to caller if target not provided
    IF _target_user_id IS NULL OR _target_user_id = v_caller_id THEN
        v_user_id := v_caller_id;
    ELSE
        -- Admin / Superadmin can check status of staff members
        IF NOT (public.has_role(v_caller_id, 'superadmin') OR public.has_role(v_caller_id, 'admin')) THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
        END IF;

        -- School Admin may inspect only same-school staff
        IF NOT public.has_role(v_caller_id, 'superadmin') THEN
            IF v_caller_rec.school_id IS NULL OR v_caller_rec.school_id <> _school_id THEN
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
-- 4. HARDEN fn_verify_staff_pin
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_verify_staff_pin(
    _school_id UUID,
    _pin TEXT,
    _device_info TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
    v_pin_row RECORD;
    v_has_staff_role BOOLEAN := FALSE;
    v_staff_emp RECORD;
    v_session_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_new_failed INT;
    v_locked_time TIMESTAMPTZ;
    v_auth_session_id UUID;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACCOUNT_INACTIVE_OR_DELETED');
    END IF;

    -- Check if user has teacher, admin, or superadmin capability
    v_has_staff_role := (
        public.has_role(v_caller_id, 'teacher')
        OR public.has_role(v_caller_id, 'admin')
        OR public.has_role(v_caller_id, 'superadmin')
    );

    IF NOT v_has_staff_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'User does not possess teacher or staff privileges.');
    END IF;

    -- Verify active staff employment in this school (unless superadmin)
    IF NOT public.has_role(v_caller_id, 'superadmin') THEN
        SELECT id, status, designation, staff_person_name
        INTO v_staff_emp
        FROM public.employees
        WHERE profile_id = v_caller_id
          AND school_id = _school_id
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Active staff employment record not found for this school.');
        END IF;
    END IF;

    -- Fetch staff_pins record
    SELECT * INTO v_pin_row
    FROM public.staff_pins
    WHERE user_id = v_caller_id AND school_id = _school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Staff PIN is not configured.');
    END IF;

    -- Check lockout
    IF v_pin_row.locked_until IS NOT NULL AND v_pin_row.locked_until > now() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'PIN is temporarily locked due to too many failed attempts.',
            'locked_until', v_pin_row.locked_until,
            'is_locked', true
        );
    END IF;

    -- Extract auth_session_id claim from JWT
    BEGIN
        v_auth_session_id := ((current_setting('request.jwt.claims', true)::jsonb)->>'session_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_auth_session_id := NULL;
    END;

    IF v_auth_session_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Authentication session ID missing from token. PIN unlock cannot be bound.',
            'code', 'MISSING_AUTH_SESSION_CLAIM'
        );
    END IF;

    -- Verify PIN hash
    IF extensions.crypt(_pin, v_pin_row.pin_hash) != v_pin_row.pin_hash THEN
        v_new_failed := v_pin_row.failed_attempts + 1;
        IF v_new_failed >= 5 THEN
            v_locked_time := now() + INTERVAL '15 minutes';
            UPDATE public.staff_pins
            SET failed_attempts = v_new_failed,
                locked_until = v_locked_time,
                updated_at = now()
            WHERE id = v_pin_row.id;

            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_caller_id, v_caller_rec.role, _school_id, v_caller_id,
                'STAFF_PIN_LOCKOUT',
                jsonb_build_object('failed_attempts', v_new_failed, 'locked_until', v_locked_time),
                now()
            );

            RETURN jsonb_build_object(
                'success', false,
                'error', 'Too many failed attempts. PIN locked for 15 minutes.',
                'locked_until', v_locked_time,
                'is_locked', true,
                'attempts_remaining', 0
            );
        ELSE
            UPDATE public.staff_pins
            SET failed_attempts = v_new_failed,
                updated_at = now()
            WHERE id = v_pin_row.id;

            RETURN jsonb_build_object(
                'success', false,
                'error', 'Incorrect PIN. ' || (5 - v_new_failed) || ' attempts remaining.',
                'attempts_remaining', (5 - v_new_failed),
                'is_locked', false
            );
        END IF;
    END IF;

    -- PIN is correct: reset failed attempts
    UPDATE public.staff_pins
    SET failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = v_pin_row.id;

    -- Revoke any existing active unlock sessions for this user/school
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_at = now(),
        revoked_reason = 'SUPERSEDED_BY_NEW_UNLOCK'
    WHERE user_id = v_caller_id
      AND school_id = _school_id
      AND is_revoked IS FALSE;

    -- Generate a cryptographically secure 2-hour session token
    v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires_at := now() + INTERVAL '2 hours';

    INSERT INTO public.staff_unlock_sessions (
        user_id,
        school_id,
        session_token,
        auth_session_id,
        device_info,
        expires_at,
        is_revoked,
        created_at
    ) VALUES (
        v_caller_id,
        _school_id,
        v_session_token,
        v_auth_session_id,
        _device_info,
        v_expires_at,
        FALSE,
        now()
    );

    INSERT INTO public.admin_action_audit (
        actor_id, actor_role, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        v_caller_id, v_caller_rec.role, _school_id, v_caller_id,
        'STAFF_PIN_UNLOCKED',
        jsonb_build_object(
            'expires_at', v_expires_at,
            'auth_session_id', v_auth_session_id,
            'device_info', _device_info
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'expires_at', v_expires_at,
        'must_change', v_pin_row.must_change,
        'is_temporary', COALESCE(v_pin_row.is_temporary, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 5. HARDEN fn_validate_staff_session
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validate_staff_session(
    _session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
    v_session RECORD;
    v_emp_active BOOLEAN;
    v_jwt_session_id UUID;
BEGIN
    IF v_caller_id IS NULL OR _session_token IS NULL OR _session_token = '' THEN
        RETURN jsonb_build_object('is_valid', false);
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'ACCOUNT_INACTIVE_OR_DELETED');
    END IF;

    SELECT s.*, p.must_change
    INTO v_session
    FROM public.staff_unlock_sessions s
    LEFT JOIN public.staff_pins p ON p.user_id = s.user_id AND p.school_id = s.school_id
    WHERE s.session_token = _session_token
      AND s.user_id = v_caller_id
      AND s.is_revoked IS FALSE
      AND s.expires_at > now();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_valid', false);
    END IF;

    -- Sessions lacking auth_session_id must fail and be revoked
    IF v_session.auth_session_id IS NULL THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'LEGACY_NULL_AUTH_SESSION',
            revoked_at = now()
        WHERE id = v_session.id;

        RETURN jsonb_build_object('is_valid', false, 'reason', 'LEGACY_NULL_AUTH_SESSION');
    END IF;

    -- Verify active staff employment in employees (unless superadmin)
    IF NOT public.has_role(v_caller_id, 'superadmin') THEN
        SELECT (status = 'active') INTO v_emp_active
        FROM public.employees
        WHERE profile_id = v_caller_id
          AND school_id = v_session.school_id
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_emp_active IS NOT TRUE THEN
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'EMPLOYEE_INACTIVE',
                revoked_at = now()
            WHERE id = v_session.id;

            RETURN jsonb_build_object('is_valid', false, 'reason', 'EMPLOYEE_INACTIVE');
        END IF;
    END IF;

    -- Bind unlock session to current JWT auth session
    BEGIN
        v_jwt_session_id := ((current_setting('request.jwt.claims', true)::jsonb)->>'session_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_jwt_session_id := NULL;
    END;

    IF v_jwt_session_id IS NOT NULL AND v_session.auth_session_id <> v_jwt_session_id THEN
        RETURN jsonb_build_object('is_valid', false, 'reason', 'SESSION_MISMATCH');
    END IF;

    RETURN jsonb_build_object(
        'is_valid', true,
        'user_id', v_session.user_id,
        'school_id', v_session.school_id,
        'expires_at', v_session.expires_at,
        'must_change', COALESCE(v_session.must_change, false)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_staff_session(TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 6. HARDEN fn_revoke_staff_session
-- ────────────────────────────────────────────────────────────────────
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
    v_caller_id UUID := auth.uid();
    v_caller_rec RECORD;
BEGIN
    IF _session_token IS NULL OR trim(_session_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session token required');
    END IF;

    -- Caller MUST be an active, non-deleted profile
    SELECT id, role, school_id, is_active, deleted_at INTO v_caller_rec
    FROM public.profiles
    WHERE id = v_caller_id;

    IF v_caller_rec.id IS NULL OR v_caller_rec.is_active IS NOT TRUE OR v_caller_rec.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Access denied: account is inactive or deleted';
    END IF;

    SELECT id, user_id, school_id, is_revoked
    INTO v_session
    FROM public.staff_unlock_sessions
    WHERE session_token = _session_token;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session not found');
    END IF;

    -- Only allow the session owner or an admin/superadmin to revoke
    IF v_caller_id <> v_session.user_id THEN
        IF public.has_role(v_caller_id, 'superadmin') THEN
            NULL; -- Allowed
        ELSIF public.has_role(v_caller_id, 'admin') THEN
            IF v_caller_rec.school_id IS NULL OR v_caller_rec.school_id <> v_session.school_id THEN
                RAISE EXCEPTION 'Access denied: cannot revoke staff session for another school';
            END IF;
        ELSE
            RAISE EXCEPTION 'Access denied: cannot revoke another user''s staff unlock session';
        END IF;
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


-- ────────────────────────────────────────────────────────────────────
-- 7. HARDEN fn_setup_tenant_user_domain
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

    -- Validate target school is not deleted and active
    IF _school_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.schools
            WHERE id = _school_id
              AND deleted_at IS NULL
              AND (status IS NULL OR status = 'active' OR status = 'Active')
        ) THEN
            RAISE EXCEPTION 'Target school % is deleted or not active', _school_id;
        END IF;
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
        ON CONFLICT (profile_id) DO UPDATE SET
            school_id = EXCLUDED.school_id,
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

            -- Validate relationship against canonical whitelist
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

            -- Primary Child Default Invariant:
            -- First child linked is primary. Subsequent children are NOT primary unless explicitly requested as true.
            v_should_be_primary := (v_other_children_count = 0) OR COALESCE(_is_primary_guardian, FALSE);

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
