-- ====================================================================
-- Migration: 20260915052000_phase17_staff_unlock_session_security.sql
-- Description: Phase 17 - Staff Unlock Session Security:
--              Device/session-bound unlocking, server-verifiable session
--              identity, active staff employment validation, complete
--              lifecycle tracking, and automated revocation triggers
--              (logout, teacher removal, PIN reset, account/employee deactivation).
-- ====================================================================

-- 1. EXTEND staff_unlock_sessions TABLE WITH TRACKING COLUMNS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions' AND column_name = 'auth_session_id'
    ) THEN
        ALTER TABLE public.staff_unlock_sessions ADD COLUMN auth_session_id UUID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions' AND column_name = 'staff_identity_id'
    ) THEN
        ALTER TABLE public.staff_unlock_sessions ADD COLUMN staff_identity_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions' AND column_name = 'unlocked_at'
    ) THEN
        ALTER TABLE public.staff_unlock_sessions ADD COLUMN unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions' AND column_name = 'revoked_at'
    ) THEN
        ALTER TABLE public.staff_unlock_sessions ADD COLUMN revoked_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'staff_unlock_sessions' AND column_name = 'failed_attempts'
    ) THEN
        ALTER TABLE public.staff_unlock_sessions ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_unlock_sessions_user_active_lookup
ON public.staff_unlock_sessions(user_id, is_revoked, expires_at);


-- 2. HARDEN fn_setup_or_change_staff_pin
-- Sets or changes PIN, revokes existing sessions with revoked_at timestamp, logs to detail column.
CREATE OR REPLACE FUNCTION public.fn_setup_or_change_staff_pin(
    _school_id UUID,
    _target_user_id UUID,
    _new_pin TEXT,
    _current_pin TEXT DEFAULT NULL,
    _is_temporary BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT := public.get_auth_role();
    v_existing_pin RECORD;
    v_new_hash TEXT;
    v_must_change BOOLEAN := FALSE;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Validate PIN length and characters (must be 6-8 digits)
    IF _new_pin IS NULL OR length(_new_pin) < 6 OR length(_new_pin) > 8 OR _new_pin !~ '^\d+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN must be between 6 and 8 numeric digits');
    END IF;

    -- Authorization check:
    IF v_caller_id = _target_user_id THEN
        SELECT * INTO v_existing_pin
        FROM public.staff_pins
        WHERE user_id = v_caller_id AND school_id = _school_id;

        IF FOUND THEN
            IF _current_pin IS NULL OR _current_pin = '' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Current PIN is required to change Staff PIN');
            END IF;

            IF extensions.crypt(_current_pin, v_existing_pin.pin_hash) != v_existing_pin.pin_hash THEN
                RETURN jsonb_build_object('success', false, 'error', 'Incorrect current PIN');
            END IF;
        END IF;

        v_must_change := FALSE;
    ELSE
        IF v_caller_role NOT IN ('superadmin', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
        END IF;
        v_must_change := TRUE;
    END IF;

    -- Generate secure hash using blowfish salt
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
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'PIN_CHANGED',
        revoked_at = now()
    WHERE user_id = _target_user_id
      AND is_revoked IS FALSE;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        actor_id,
        school_id,
        target_user_id,
        action,
        detail,
        created_at
    ) VALUES (
        v_caller_id,
        _school_id,
        _target_user_id,
        'STAFF_PIN_SET',
        jsonb_build_object(
            'is_self_setup', (v_caller_id = _target_user_id),
            'is_temporary', _is_temporary,
            'must_change', v_must_change
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'must_change', v_must_change
    );
END;
$$;


-- 3. HARDEN fn_verify_staff_pin

-- Enforces active staff identity, extracts auth_session_id, populates Phase 17 tracking fields.
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

    -- 1. Check if user has teacher or admin capability via canonical has_role
    v_has_staff_role := (
        public.has_role(v_caller_id, 'teacher')
        OR public.has_role(v_caller_id, 'admin')
        OR public.has_role(v_caller_id, 'superadmin')
    );



    IF NOT v_has_staff_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'User does not possess teacher or staff privileges.');
    END IF;

    -- 2. Verify active staff employment in this school (Phase 17 active staff identity mandate)
    IF public.get_auth_role() <> 'superadmin' THEN
        SELECT id, status, designation, staff_person_name
        INTO v_staff_emp
        FROM public.employees
        WHERE profile_id = v_caller_id
          AND school_id = _school_id
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'NO_ACTIVE_STAFF_IDENTITY',
                'message', 'Teacher mode requires an active staff employment record.'
            );
        END IF;
    END IF;

    -- 3. Fetch staff_pins record
    SELECT * INTO v_pin_row
    FROM public.staff_pins
    WHERE user_id = v_caller_id AND school_id = _school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NO_PIN_CONFIGURED',
            'message', 'Staff PIN has not been configured yet. Please set up your PIN to unlock Teacher mode.'
        );
    END IF;

    -- 4. Check lockout
    IF v_pin_row.locked_until IS NOT NULL AND v_pin_row.locked_until > now() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ACCOUNT_LOCKED',
            'message', 'Too many failed attempts. Staff mode is locked.',
            'locked_until', v_pin_row.locked_until,
            'attempts_remaining', 0
        );
    END IF;

    -- 5. Verify PIN with pgcrypto crypt
    IF extensions.crypt(_pin, v_pin_row.pin_hash) != v_pin_row.pin_hash THEN
        v_new_failed := v_pin_row.failed_attempts + 1;

        IF v_new_failed >= 5 THEN
            v_locked_time := now() + INTERVAL '15 minutes';
            UPDATE public.staff_pins
            SET failed_attempts = v_new_failed,
                locked_until = v_locked_time,
                updated_at = now()
            WHERE id = v_pin_row.id;

            -- Audit log lockout
            INSERT INTO public.admin_action_audit (
                actor_id, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_caller_id, _school_id, v_caller_id,
                'STAFF_PIN_LOCKOUT',
                jsonb_build_object('failed_attempts', v_new_failed, 'locked_until', v_locked_time),
                now()
            );

            RETURN jsonb_build_object(
                'success', false,
                'error', 'ACCOUNT_LOCKED',
                'message', 'Maximum attempts exceeded. Staff mode locked for 15 minutes.',
                'locked_until', v_locked_time,
                'attempts_remaining', 0
            );
        ELSE
            UPDATE public.staff_pins
            SET failed_attempts = v_new_failed,
                updated_at = now()
            WHERE id = v_pin_row.id;

            RETURN jsonb_build_object(
                'success', false,
                'error', 'INVALID_PIN',
                'message', 'Incorrect Staff PIN.',
                'attempts_remaining', (5 - v_new_failed)
            );
        END IF;
    END IF;

    -- 6. Success! Reset failed attempts & lockout
    UPDATE public.staff_pins
    SET failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = v_pin_row.id;

    -- 7. Extract auth session ID if available from JWT
    BEGIN
        v_auth_session_id := COALESCE(
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
            (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
        );
    EXCEPTION WHEN OTHERS THEN
        v_auth_session_id := NULL;
    END;

    -- Generate cryptographically random session token (32 bytes hex)
    v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires_at := now() + INTERVAL '2 hours';

    -- 8. Insert active session with Phase 17 metadata
    INSERT INTO public.staff_unlock_sessions (
        user_id,
        school_id,
        auth_session_id,
        staff_identity_id,
        session_token,
        device_info,
        unlocked_at,
        expires_at,
        created_at,
        last_activity_at
    ) VALUES (
        v_caller_id,
        _school_id,
        v_auth_session_id,
        v_staff_emp.id,
        v_session_token,
        _device_info,
        now(),
        v_expires_at,
        now(),
        now()
    );

    -- 9. Audit log
    INSERT INTO public.admin_action_audit (
        actor_id, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        v_caller_id, _school_id, v_caller_id,
        'STAFF_PIN_UNLOCKED',
        jsonb_build_object(
            'expires_at', v_expires_at, 
            'device_info', _device_info,
            'staff_identity_id', v_staff_emp.id,
            'auth_session_id', v_auth_session_id
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'expires_at', v_expires_at,
        'must_change', v_pin_row.must_change
    );
END;
$$;


-- 3. HARDEN fn_validate_staff_session
-- Checks token, expiration, revocation, active employee status, and session binding.
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
    v_session RECORD;
    v_emp_active BOOLEAN;
    v_jwt_session_id UUID;
BEGIN
    IF v_caller_id IS NULL OR _session_token IS NULL OR _session_token = '' THEN
        RETURN jsonb_build_object('is_valid', false);
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

    -- Verify active staff identity requirement (unless superadmin)
    IF public.get_auth_role() <> 'superadmin' THEN
        SELECT (status = 'active') INTO v_emp_active
        FROM public.employees
        WHERE profile_id = v_caller_id
          AND school_id = v_session.school_id
          AND deleted_at IS NULL
        LIMIT 1;

        IF v_emp_active IS NOT TRUE THEN
            -- Inactive employee: automatically revoke on the fly
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'EMPLOYEE_INACTIVE',
                revoked_at = now()
            WHERE id = v_session.id;

            RETURN jsonb_build_object('is_valid', false, 'reason', 'EMPLOYEE_INACTIVE');
        END IF;
    END IF;

    -- Device / auth session binding verification if auth_session_id was recorded
    IF v_session.auth_session_id IS NOT NULL THEN
        BEGIN
            v_jwt_session_id := COALESCE(
                (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
                (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
            );
            IF v_jwt_session_id IS NOT NULL AND v_jwt_session_id <> v_session.auth_session_id THEN
                -- Session mismatch across auth sessions
                RETURN jsonb_build_object('is_valid', false, 'reason', 'SESSION_MISMATCH');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    -- Update last activity timestamp
    UPDATE public.staff_unlock_sessions
    SET last_activity_at = now()
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'is_valid', true,
        'school_id', v_session.school_id,
        'expires_at', v_session.expires_at,
        'must_change', COALESCE(v_session.must_change, false)
    );
END;
$$;


-- 4. HARDEN fn_revoke_staff_session & ADD fn_revoke_all_staff_sessions
CREATE OR REPLACE FUNCTION public.fn_revoke_staff_session(
    _session_token TEXT,
    _reason TEXT DEFAULT 'USER_REVOKED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    IF v_caller_id IS NULL OR _session_token IS NULL OR _session_token = '' THEN
        RETURN jsonb_build_object('success', false);
    END IF;

    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = COALESCE(_reason, 'USER_REVOKED'),
        revoked_at = now()
    WHERE session_token = _session_token
      AND user_id = v_caller_id
      AND is_revoked IS FALSE;

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_revoke_all_staff_sessions(
    _target_user_id UUID,
    _reason TEXT DEFAULT 'SECURITY_RESET'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT := public.get_auth_role();
    v_revoked_count INT := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Caller can revoke their own sessions, or admin/superadmin can revoke for staff
    IF v_caller_id <> _target_user_id THEN
        IF v_caller_role NOT IN ('superadmin', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
        END IF;

        IF v_caller_role = 'admin' THEN
            -- Verify same school
            IF NOT EXISTS (
                SELECT 1 FROM public.profiles p1, public.profiles p2
                WHERE p1.id = v_caller_id AND p2.id = _target_user_id
                  AND p1.school_id IS NOT NULL AND p1.school_id = p2.school_id
            ) THEN
                RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
            END IF;
        END IF;
    END IF;

    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = COALESCE(_reason, 'SECURITY_RESET'),
        revoked_at = now()
    WHERE user_id = _target_user_id
      AND is_revoked IS FALSE;
    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'revoked_count', v_revoked_count);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_revoke_all_staff_sessions(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revoke_all_staff_sessions(UUID, TEXT) TO authenticated, service_role;


-- 5. AUTOMATED DATABASE TRIGGERS FOR LIFECYCLE REVOCATION

-- Trigger A: Account Deactivation / Soft Delete
CREATE OR REPLACE FUNCTION public.fn_trg_profile_deactivated_revoke_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF (OLD.is_active IS TRUE AND NEW.is_active IS FALSE) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'ACCOUNT_DEACTIVATED',
            revoked_at = now()
        WHERE user_id = NEW.id
          AND is_revoked IS FALSE;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_deactivated_revoke_sessions ON public.profiles;
CREATE TRIGGER trg_profile_deactivated_revoke_sessions
AFTER UPDATE OF is_active, deleted_at ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_profile_deactivated_revoke_sessions();


-- Trigger B: Employee Deactivation / Soft Delete
CREATE OR REPLACE FUNCTION public.fn_trg_employee_deactivated_revoke_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF (OLD.status = 'active' AND NEW.status <> 'active') OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
        UPDATE public.staff_unlock_sessions
        SET is_revoked = TRUE,
            revoked_reason = 'EMPLOYEE_DEACTIVATED',
            revoked_at = now()
        WHERE user_id = NEW.profile_id
          AND is_revoked IS FALSE;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_deactivated_revoke_sessions ON public.employees;
CREATE TRIGGER trg_employee_deactivated_revoke_sessions
AFTER UPDATE OF status, deleted_at ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_employee_deactivated_revoke_sessions();


-- Trigger C: Teacher Role Removal
CREATE OR REPLACE FUNCTION public.fn_trg_user_roles_teacher_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF OLD.role = 'teacher' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id AND p.role = 'teacher'
        ) AND NOT EXISTS (
            SELECT 1 FROM public.user_roles ur WHERE ur.user_id = OLD.user_id AND ur.role = 'teacher'
        ) THEN
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'TEACHER_REMOVED',
                revoked_at = now()
            WHERE user_id = OLD.user_id
              AND is_revoked IS FALSE;
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_teacher_removed ON public.user_roles;
CREATE TRIGGER trg_user_roles_teacher_removed
AFTER DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.fn_trg_user_roles_teacher_removed();

