-- Migration: 20260915010000_phase5_secure_staff_pin.sql
-- Description: Phase 5 - Secure Teacher Mode / Staff PIN authentication, failed-attempt tracking, temporary lockout, server-side session unlocking

-- 1. ENSURE PGCRYPTO EXTENSION
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. STAFF PINS TABLE
CREATE TABLE IF NOT EXISTS public.staff_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
    must_change BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT staff_pins_user_school_unique UNIQUE (user_id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_pins_user_school ON public.staff_pins(user_id, school_id);

-- 3. STAFF UNLOCK SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.staff_unlock_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    device_info TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_unlock_sessions_token ON public.staff_unlock_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_staff_unlock_sessions_user_active ON public.staff_unlock_sessions(user_id, expires_at) WHERE is_revoked IS FALSE;

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.staff_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_unlock_sessions ENABLE ROW LEVEL SECURITY;

-- Deny direct access to staff_pins; all management goes through security-definer RPCs
DROP POLICY IF EXISTS "staff_pins_no_direct_access" ON public.staff_pins;
CREATE POLICY "staff_pins_no_direct_access" ON public.staff_pins
    FOR ALL TO authenticated
    USING (FALSE);

-- Staff unlock sessions: users can read their own non-revoked session records
DROP POLICY IF EXISTS "staff_unlock_sessions_user_select" ON public.staff_unlock_sessions;
CREATE POLICY "staff_unlock_sessions_user_select" ON public.staff_unlock_sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND is_revoked IS FALSE);

-- 5. RPC: CHECK STAFF PIN STATUS
CREATE OR REPLACE FUNCTION public.fn_check_staff_pin_status(
    _school_id UUID,
    _target_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_caller_role TEXT := public.get_auth_role();
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
        -- Admin / Superadmin can check status of any staff member in their school
        IF v_caller_role NOT IN ('superadmin', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
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
        'is_temporary', v_pin_row.is_temporary
    );
END;
$$;

-- 6. RPC: SETUP OR CHANGE STAFF PIN
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
    -- Either caller is changing their own PIN, or caller is admin/superadmin setting a temporary/reset PIN
    IF v_caller_id = _target_user_id THEN
        -- Check if PIN already exists
        SELECT * INTO v_existing_pin
        FROM public.staff_pins
        WHERE user_id = v_caller_id AND school_id = _school_id;

        IF FOUND THEN
            -- If user already has a PIN, require valid current PIN
            IF _current_pin IS NULL OR _current_pin = '' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Current PIN is required to change Staff PIN');
            END IF;

            IF extensions.crypt(_current_pin, v_existing_pin.pin_hash) != v_existing_pin.pin_hash THEN
                RETURN jsonb_build_object('success', false, 'error', 'Incorrect current PIN');
            END IF;
        END IF;

        v_must_change := FALSE;
    ELSE
        -- Admin setting PIN for staff member
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
        revoked_reason = 'PIN_CHANGED'
    WHERE user_id = _target_user_id
      AND is_revoked IS FALSE;

    -- Audit log
    INSERT INTO public.admin_action_audit (
        id,
        actor_id,
        school_id,
        target_user_id,
        action,
        details,
        created_at
    ) VALUES (
        gen_random_uuid(),
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

-- 7. RPC: VERIFY STAFF PIN AND UNLOCK SESSION
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
    v_session_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_new_failed INT;
    v_locked_time TIMESTAMPTZ;
BEGIN
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
    END IF;

    -- Check if user has teacher or admin role in profile or user_roles or memberships
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_caller_id
          AND (
            p.role IN ('teacher', 'admin', 'superadmin')
            OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('teacher', 'admin', 'superadmin'))
            OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.profile_id = p.id AND m.school_id = _school_id AND m.role IN ('teacher', 'admin', 'superadmin'))
          )
    ) INTO v_has_staff_role;

    IF NOT v_has_staff_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'User does not possess teacher or staff privileges.');
    END IF;

    -- Fetch staff_pins record
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

    -- Check lockout
    IF v_pin_row.locked_until IS NOT NULL AND v_pin_row.locked_until > now() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ACCOUNT_LOCKED',
            'message', 'Too many failed attempts. Staff mode is locked.',
            'locked_until', v_pin_row.locked_until,
            'attempts_remaining', 0
        );
    END IF;

    -- Verify PIN with pgcrypto crypt
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
                id, actor_id, school_id, target_user_id, action, details, created_at
            ) VALUES (
                gen_random_uuid(), v_caller_id, _school_id, v_caller_id,
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

    -- Success! Reset failed attempts & lockout
    UPDATE public.staff_pins
    SET failed_attempts = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = v_pin_row.id;

    -- Generate cryptographically random session token (32 bytes hex)
    v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires_at := now() + INTERVAL '2 hours';

    -- Insert active session
    INSERT INTO public.staff_unlock_sessions (
        user_id,
        school_id,
        session_token,
        device_info,
        expires_at,
        created_at,
        last_activity_at
    ) VALUES (
        v_caller_id,
        _school_id,
        v_session_token,
        _device_info,
        v_expires_at,
        now(),
        now()
    );

    -- Audit log
    INSERT INTO public.admin_action_audit (
        id, actor_id, school_id, target_user_id, action, details, created_at
    ) VALUES (
        gen_random_uuid(), v_caller_id, _school_id, v_caller_id,
        'STAFF_PIN_UNLOCKED',
        jsonb_build_object('expires_at', v_expires_at, 'device_info', _device_info),
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

-- 8. RPC: VALIDATE STAFF UNLOCK SESSION
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
    v_must_change BOOLEAN := FALSE;
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

-- 9. RPC: REVOKE STAFF UNLOCK SESSION
CREATE OR REPLACE FUNCTION public.fn_revoke_staff_session(
    _session_token TEXT
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
        revoked_reason = 'USER_REVOKED'
    WHERE session_token = _session_token
      AND user_id = v_caller_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 10. SERVER-SIDE HELPER: IS STAFF UNLOCKED
CREATE OR REPLACE FUNCTION public.fn_is_staff_unlocked(
    _school_id UUID,
    _session_token TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
STABLE
AS $$
    SELECT (
        -- Superadmins bypass PIN unlock
        public.get_auth_role() = 'superadmin'
        OR EXISTS (
            SELECT 1
            FROM public.staff_unlock_sessions
            WHERE session_token = _session_token
              AND user_id = auth.uid()
              AND school_id = _school_id
              AND is_revoked IS FALSE
              AND expires_at > now()
        )
    );
$$;

-- Revoke execute from public/anon, grant to authenticated
REVOKE ALL ON FUNCTION public.fn_check_staff_pin_status(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_check_staff_pin_status(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_setup_or_change_staff_pin(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_validate_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_staff_session(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_revoke_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revoke_staff_session(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_is_staff_unlocked(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_staff_unlocked(UUID, TEXT) TO authenticated;
