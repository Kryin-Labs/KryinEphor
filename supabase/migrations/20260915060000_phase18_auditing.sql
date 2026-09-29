-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260915060000_phase18_auditing.sql
-- DESCRIPTION: Phase 18 — Auditing (Identity & Access)
--
-- Audits all 20 security-sensitive events defined in Phase 18:
--   1. teacher added
--   2. teacher removed
--   3. teacher activated
--   4. teacher deactivated
--   5. staff PIN configured
--   6. staff PIN reset
--   7. staff PIN changed
--   8. staff unlock failed
--   9. staff unlock locked
--  10. staff unlock succeeded
--  11. child linked
--  12. child unlinked
--  13. guardian relationship edited
--  14. student archived
--  15. student withdrawn
--  16. student deletion attempted
--  17. student deleted if exceptionally allowed
--  18. account activated
--  19. account deactivated
--  20. role/capability changes
--
-- Metadata captured:
--   - actor user ID (actor_id)
--   - actor role (actor_role)
--   - target account (target_user_id)
--   - target student / staff identity (in detail)
--   - school ID (school_id)
--   - previous state (in detail: previous_state)
--   - new state (in detail: new_state)
--   - timestamp (created_at = now())
--   - session / request metadata (ip_address, device_info, auth_session_id)
--
-- Zero plaintext PINs, hashes, or passwords logged.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure indices on admin_action_audit for efficient audit trail filtering
CREATE INDEX IF NOT EXISTS idx_admin_action_audit_school_action 
ON public.admin_action_audit(school_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_target_created 
ON public.admin_action_audit(target_user_id, created_at DESC);

-- Ensure profiles_student_status_check allows 'archived'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_student_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_student_status_check 
CHECK (student_status IS NULL OR student_status = ANY (ARRAY['active'::text, 'withdrawn'::text, 'transferred'::text, 'graduated'::text, 'inactive'::text, 'archived'::text]));

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DATABASE TRIGGERS FOR DIRECT/LIFECYCLE STATE CHANGES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1.1 Trigger on profiles: account activated, account deactivated, role/capability changes
CREATE OR REPLACE FUNCTION public.fn_trg_audit_profile_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
BEGIN
    v_actor_id := auth.uid();
    v_actor_role := CASE WHEN v_actor_id IS NULL THEN 'system' ELSE COALESCE(public.get_auth_role(), 'admin') END;

    -- A. Account Activated / Deactivated
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        INSERT INTO public.admin_action_audit (
            actor_id, actor_role, school_id, target_user_id, action, detail, created_at
        ) VALUES (
            v_actor_id,
            v_actor_role,
            NEW.school_id,
            NEW.id,
            CASE WHEN NEW.is_active THEN 'account activated' ELSE 'account deactivated' END,
            jsonb_build_object(
                'previous_state', jsonb_build_object('is_active', OLD.is_active),
                'new_state', jsonb_build_object('is_active', NEW.is_active),
                'target_name', NEW.full_name,
                'target_role', NEW.role
            ),
            now()
        );
    END IF;

    -- B. Primary Role Change
    IF OLD.role IS DISTINCT FROM NEW.role THEN
        INSERT INTO public.admin_action_audit (
            actor_id, actor_role, school_id, target_user_id, action, detail, created_at
        ) VALUES (
            v_actor_id,
            v_actor_role,
            NEW.school_id,
            NEW.id,
            'role/capability changes',
            jsonb_build_object(
                'previous_state', jsonb_build_object('role', OLD.role),
                'new_state', jsonb_build_object('role', NEW.role),
                'target_name', NEW.full_name
            ),
            now()
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_changes ON public.profiles;
CREATE TRIGGER trg_audit_profile_changes
    AFTER UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_audit_profile_changes();


-- 1.2 Trigger on employees: teacher activated, teacher deactivated
CREATE OR REPLACE FUNCTION public.fn_trg_audit_employee_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_school_id UUID;
BEGIN
    v_actor_id := auth.uid();
    v_actor_role := CASE WHEN v_actor_id IS NULL THEN 'system' ELSE COALESCE(public.get_auth_role(), 'admin') END;
    v_school_id := NEW.school_id;

    -- On Status Change
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'active' THEN
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                NEW.profile_id,
                'teacher activated',
                jsonb_build_object(
                    'target_staff_identity', NEW.id,
                    'staff_person_name', NEW.staff_person_name,
                    'designation', NEW.designation,
                    'previous_state', jsonb_build_object('status', OLD.status),
                    'new_state', jsonb_build_object('status', NEW.status)
                ),
                now()
            );
        ELSIF OLD.status = 'active' AND NEW.status <> 'active' THEN
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                NEW.profile_id,
                'teacher deactivated',
                jsonb_build_object(
                    'target_staff_identity', NEW.id,
                    'staff_person_name', NEW.staff_person_name,
                    'designation', NEW.designation,
                    'previous_state', jsonb_build_object('status', OLD.status),
                    'new_state', jsonb_build_object('status', NEW.status)
                ),
                now()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_employee_changes ON public.employees;
CREATE TRIGGER trg_audit_employee_changes
    AFTER UPDATE ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_audit_employee_changes();


-- 1.3 Trigger on user_roles: teacher added, teacher removed, role/capability changes
CREATE OR REPLACE FUNCTION public.fn_trg_audit_user_roles_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_target_user_id UUID;
    v_school_id UUID;
BEGIN
    v_actor_id := auth.uid();
    v_actor_role := CASE WHEN v_actor_id IS NULL THEN 'system' ELSE COALESCE(public.get_auth_role(), 'admin') END;
    v_target_user_id := COALESCE(NEW.user_id, OLD.user_id);

    SELECT school_id INTO v_school_id
    FROM public.profiles
    WHERE id = v_target_user_id;

    IF TG_OP = 'INSERT' THEN
        IF NEW.role = 'teacher' THEN
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                NEW.user_id,
                'teacher added',
                jsonb_build_object(
                    'role', NEW.role,
                    'operation', 'INSERT',
                    'new_state', 'granted'
                ),
                now()
            );
        ELSE
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                NEW.user_id,
                'role/capability changes',
                jsonb_build_object(
                    'role', NEW.role,
                    'operation', 'INSERT',
                    'new_state', 'granted'
                ),
                now()
            );
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.role = 'teacher' THEN
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                OLD.user_id,
                'teacher removed',
                jsonb_build_object(
                    'role', OLD.role,
                    'operation', 'DELETE',
                    'new_state', 'revoked'
                ),
                now()
            );
        ELSE
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_actor_id,
                v_actor_role,
                v_school_id,
                OLD.user_id,
                'role/capability changes',
                jsonb_build_object(
                    'role', OLD.role,
                    'operation', 'DELETE',
                    'new_state', 'revoked'
                ),
                now()
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles_changes ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles_changes
    AFTER INSERT OR DELETE ON public.user_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_audit_user_roles_changes();


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DOMAIN RPC AUDIT UPDATES (STAFF PIN & UNLOCK SESSIONS)
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1 fn_setup_or_change_staff_pin: audits 'staff PIN configured', 'staff PIN reset', 'staff PIN changed'
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
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    -- Validate format: 4 to 8 numeric digits
    IF _new_pin !~ '^[0-9]{4,8}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_FORMAT', 'message', 'PIN must be between 4 and 8 numeric digits');
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
                RETURN jsonb_build_object('success', false, 'error', 'Current PIN is required to change Staff PIN');
            END IF;

            IF extensions.crypt(_current_pin, v_existing_pin.pin_hash) != v_existing_pin.pin_hash THEN
                RETURN jsonb_build_object('success', false, 'error', 'Incorrect current PIN');
            END IF;
            v_audit_action := 'staff PIN changed';
        ELSE
            v_audit_action := 'staff PIN configured';
        END IF;

        v_must_change := FALSE;
    ELSE
        -- Admin reset
        IF v_caller_role NOT IN ('superadmin', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
        END IF;
        v_must_change := TRUE;
        v_audit_action := 'staff PIN reset';
    END IF;

    -- Fetch employee identity
    SELECT id INTO v_target_emp_id
    FROM public.employees
    WHERE profile_id = _target_user_id AND school_id = _school_id
    LIMIT 1;

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


-- 2.2 fn_verify_staff_pin: audits 'staff unlock failed', 'staff unlock locked', 'staff unlock succeeded'
CREATE OR REPLACE FUNCTION public.fn_verify_staff_pin(
    _school_id UUID,
    _pin TEXT,
    _device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_pin_row RECORD;
    v_new_failed INT;
    v_locked_time TIMESTAMPTZ;
    v_session_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_staff_emp RECORD;
    v_auth_session_id UUID;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_auth_role();

    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    -- 1. Check teacher role capability
    IF NOT public.has_role(v_caller_id, 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'error', 'NOT_A_TEACHER', 'message', 'Account does not have Teacher role access.');
    END IF;

    -- 2. Require active staff identity
    SELECT id, status INTO v_staff_emp
    FROM public.employees
    WHERE profile_id = v_caller_id
      AND school_id = _school_id
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_staff_emp.id IS NULL OR v_staff_emp.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'STAFF_INACTIVE', 'message', 'Staff identity is inactive or does not exist.');
    END IF;

    -- 3. Lookup PIN record
    SELECT * INTO v_pin_row
    FROM public.staff_pins
    WHERE user_id = v_caller_id AND school_id = _school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_NOT_SET', 'message', 'Staff PIN has not been configured yet.');
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

            -- Audit log: staff unlock locked
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_caller_id, v_caller_role, _school_id, v_caller_id,
                'staff unlock locked',
                jsonb_build_object(
                    'failed_attempts', v_new_failed,
                    'locked_until', v_locked_time,
                    'device_info', _device_info,
                    'target_staff_identity', v_staff_emp.id
                ),
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

            -- Audit log: staff unlock failed
            INSERT INTO public.admin_action_audit (
                actor_id, actor_role, school_id, target_user_id, action, detail, created_at
            ) VALUES (
                v_caller_id, v_caller_role, _school_id, v_caller_id,
                'staff unlock failed',
                jsonb_build_object(
                    'failed_attempts', v_new_failed,
                    'attempts_remaining', (5 - v_new_failed),
                    'device_info', _device_info,
                    'target_staff_identity', v_staff_emp.id
                ),
                now()
            );

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

    -- 8. Insert active session
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

    -- 9. Audit log: staff unlock succeeded
    INSERT INTO public.admin_action_audit (
        actor_id, actor_role, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        v_caller_id, v_caller_role, _school_id, v_caller_id,
        'staff unlock succeeded',
        jsonb_build_object(
            'expires_at', v_expires_at,
            'device_info', _device_info,
            'staff_identity_id', v_staff_emp.id,
            'target_staff_identity', v_staff_emp.id,
            'auth_session_id', v_auth_session_id,
            'session_token_prefix', substring(v_session_token FROM 1 FOR 8)
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'expires_at', v_expires_at,
        'must_change', coalesce(v_pin_row.must_change, false)
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. DOMAIN RPC AUDIT UPDATES (FAMILY & RELATIONSHIP MANAGEMENT)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1 fn_link_student_guardian: audits 'child linked'
CREATE OR REPLACE FUNCTION public.fn_link_student_guardian(
    _school_id UUID,
    _parent_id UUID,
    _student_id UUID,
    _relationship TEXT DEFAULT 'Parent',
    _is_primary BOOLEAN DEFAULT FALSE
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
    v_link_id UUID;
    v_link_status TEXT;
    v_was_reactivated BOOLEAN := FALSE;
    v_student_name TEXT;
    v_parent_name TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot link students for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Prevent self-linking
    IF _parent_id = _student_id THEN
        RAISE EXCEPTION 'A user cannot be linked to themselves as a guardian';
    END IF;

    -- Validate target student
    SELECT role, school_id, full_name INTO v_student_role, v_student_school, v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    IF v_student_role IS NULL THEN
        RAISE EXCEPTION 'Student profile not found';
    END IF;

    IF v_student_role <> 'student' THEN
        RAISE EXCEPTION 'Target user is not a student (role: %)', v_student_role;
    END IF;

    IF v_student_school <> v_effective_school THEN
        RAISE EXCEPTION 'Student does not belong to school %', v_effective_school;
    END IF;

    -- Validate target parent
    SELECT role, school_id, full_name INTO v_parent_role, v_parent_school, v_parent_name
    FROM public.profiles
    WHERE id = _parent_id;

    IF v_parent_role IS NULL THEN
        RAISE EXCEPTION 'Parent profile not found';
    END IF;

    IF v_parent_school <> v_effective_school THEN
        RAISE EXCEPTION 'Parent does not belong to school %', v_effective_school;
    END IF;

    -- Check for existing link
    SELECT id, status INTO v_link_id, v_link_status
    FROM public.parent_student
    WHERE parent_id = _parent_id AND student_id = _student_id;

    IF _is_primary THEN
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE student_id = _student_id AND is_primary = TRUE;
    END IF;

    IF v_link_id IS NOT NULL THEN
        UPDATE public.parent_student
        SET status = 'active',
            relationship = _relationship,
            is_primary = _is_primary,
            school_id = v_effective_school,
            updated_at = now()
        WHERE id = v_link_id;
        v_was_reactivated := (v_link_status = 'unlinked');
    ELSE
        INSERT INTO public.parent_student (
            parent_id,
            student_id,
            school_id,
            relationship,
            is_primary,
            status,
            created_at,
            updated_at
        ) VALUES (
            _parent_id,
            _student_id,
            v_effective_school,
            _relationship,
            _is_primary,
            'active',
            now(),
            now()
        )
        RETURNING id INTO v_link_id;
        v_was_reactivated := FALSE;
    END IF;

    -- Ensure 'parent' role in user_roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_parent_id, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Ensure guardian profile active
    UPDATE public.profiles
    SET is_active = TRUE, updated_at = now()
    WHERE id = _parent_id AND is_active = FALSE;

    -- Canonical Audit log: child linked
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
            'parent_id', _parent_id,
            'parent_name', v_parent_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'target_student_identity', _student_id,
            'relationship', _relationship,
            'is_primary', _is_primary,
            'was_reactivated', v_was_reactivated,
            'previous_state', CASE WHEN v_was_reactivated THEN 'unlinked' ELSE 'none' END,
            'new_state', 'linked'
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_link_id,
        'was_reactivated', v_was_reactivated,
        'parent_id', _parent_id,
        'student_id', _student_id,
        'relationship', _relationship,
        'is_primary', _is_primary
    );
END;
$$;


-- 3.2 fn_unlink_student_guardian: audits 'child unlinked'
CREATE OR REPLACE FUNCTION public.fn_unlink_student_guardian(
    _link_id UUID DEFAULT NULL,
    _student_id UUID DEFAULT NULL,
    _parent_id UUID DEFAULT NULL
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
    v_remaining_count INT;
    v_has_active_teacher BOOLEAN := FALSE;
    v_has_other_staff BOOLEAN := FALSE;
    v_other_staff_role TEXT;
    v_new_primary_role TEXT := NULL;
    v_has_active_persona BOOLEAN := TRUE;
    v_parent_id UUID;
    v_parent_profile RECORD;
    v_student_name TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF _link_id IS NOT NULL THEN
        SELECT * INTO v_link FROM public.parent_student WHERE id = _link_id;
    ELSIF _student_id IS NOT NULL AND _parent_id IS NOT NULL THEN
        SELECT * INTO v_link FROM public.parent_student 
        WHERE student_id = _student_id AND parent_id = _parent_id AND status = 'active';
    ELSE
        RAISE EXCEPTION 'Either _link_id or both _student_id and _parent_id must be provided';
    END IF;

    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Active link between student and guardian not found';
    END IF;

    v_parent_id := v_link.parent_id;
    _student_id := v_link.student_id;
    v_effective_school := v_link.school_id;

    IF v_caller_role = 'superadmin' THEN
        NULL;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (v_effective_school IS NOT NULL AND v_effective_school <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot unlink students for another school';
        END IF;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = _student_id;
    SELECT * INTO v_parent_profile FROM public.profiles WHERE id = v_parent_id;

    -- Unlink relation
    UPDATE public.parent_student
    SET status = 'unlinked', updated_at = now()
    WHERE id = v_link.id;

    -- Count remaining active children
    SELECT COUNT(*) INTO v_remaining_count
    FROM public.parent_student
    WHERE parent_id = v_parent_id 
      AND status = 'active'
      AND (v_effective_school IS NULL OR school_id = v_effective_school);

    -- Phase 11 capability evaluation if last child unlinked
    IF v_remaining_count = 0 THEN
        IF EXISTS (
            SELECT 1 FROM public.employees e
            JOIN public.user_roles ur ON ur.user_id = e.profile_id AND ur.role = 'teacher'
            WHERE e.profile_id = v_parent_id
              AND e.status = 'active'
              AND (v_effective_school IS NULL OR e.school_id = v_effective_school)
        ) THEN
            v_has_active_teacher := TRUE;
        END IF;

        IF NOT v_has_active_teacher THEN
            SELECT ur.role INTO v_other_staff_role
            FROM public.user_roles ur
            WHERE ur.user_id = v_parent_id 
              AND ur.role IN ('accountant', 'receptionist', 'admin', 'principal')
            LIMIT 1;
            IF v_other_staff_role IS NOT NULL THEN
                v_has_other_staff := TRUE;
            END IF;
        END IF;

        IF v_has_active_teacher THEN
            v_new_primary_role := 'teacher';
            IF v_parent_profile.role = 'parent' THEN
                UPDATE public.profiles
                SET role = 'teacher', updated_at = now()
                WHERE id = v_parent_id;
            END IF;
            v_has_active_persona := TRUE;
        ELSIF v_has_other_staff THEN
            v_new_primary_role := v_other_staff_role;
            IF v_parent_profile.role = 'parent' THEN
                UPDATE public.profiles
                SET role = v_other_staff_role, updated_at = now()
                WHERE id = v_parent_id;
            END IF;
            v_has_active_persona := TRUE;
        ELSE
            v_has_active_persona := FALSE;
            v_new_primary_role := NULL;
        END IF;
    END IF;

    -- Canonical Audit log: child unlinked
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
        'child unlinked',
        jsonb_build_object(
            'parent_id', v_parent_id,
            'parent_name', v_parent_profile.full_name,
            'student_id', _student_id,
            'student_name', v_student_name,
            'target_student_identity', _student_id,
            'relationship', v_link.relationship,
            'remaining_children_count', v_remaining_count,
            'has_active_teacher', v_has_active_teacher,
            'new_primary_role', v_new_primary_role,
            'has_active_persona', v_has_active_persona,
            'previous_state', 'linked',
            'new_state', 'unlinked'
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'unlinked_link_id', v_link.id,
        'parent_id', v_parent_id,
        'student_id', _student_id,
        'remaining_children_count', v_remaining_count,
        'has_active_teacher', v_has_active_teacher,
        'new_primary_role', v_new_primary_role,
        'has_active_persona', v_has_active_persona
    );
END;
$$;


-- 3.3 fn_update_guardian_relationship: audits 'guardian relationship edited'
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
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    SELECT * INTO v_link FROM public.parent_student WHERE id = _link_id;
    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Relationship link not found';
    END IF;

    v_parent_id := v_link.parent_id;
    v_student_id := v_link.student_id;
    v_old_relationship := v_link.relationship;
    v_old_is_primary := v_link.is_primary;
    v_effective_school := v_link.school_id;

    IF v_caller_role = 'superadmin' THEN
        NULL;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (v_effective_school IS NOT NULL AND v_effective_school <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot update relationship for another school';
        END IF;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    v_new_relationship := COALESCE(NULLIF(TRIM(_relationship), ''), v_old_relationship);
    v_new_is_primary := COALESCE(_is_primary, v_old_is_primary);

    SELECT full_name INTO v_student_name FROM public.profiles WHERE id = v_student_id;
    SELECT full_name INTO v_parent_name FROM public.profiles WHERE id = v_parent_id;

    IF v_new_is_primary AND NOT v_old_is_primary THEN
        UPDATE public.parent_student
        SET is_primary = FALSE, updated_at = now()
        WHERE student_id = v_student_id AND id <> _link_id AND is_primary = TRUE;
    END IF;

    UPDATE public.parent_student
    SET relationship = v_new_relationship,
        is_primary = v_new_is_primary,
        updated_at = now()
    WHERE id = _link_id;

    -- Canonical Audit log: guardian relationship edited
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
        'guardian relationship edited',
        jsonb_build_object(
            'link_id', _link_id,
            'parent_id', v_parent_id,
            'parent_name', v_parent_name,
            'student_id', v_student_id,
            'student_name', v_student_name,
            'target_student_identity', v_student_id,
            'previous_state', jsonb_build_object(
                'relationship', v_old_relationship,
                'is_primary', v_old_is_primary
            ),
            'new_state', jsonb_build_object(
                'relationship', v_new_relationship,
                'is_primary', v_new_is_primary
            )
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', _link_id,
        'parent_id', v_parent_id,
        'student_id', v_student_id,
        'relationship', v_new_relationship,
        'is_primary', v_new_is_primary,
        'previous_relationship', v_old_relationship,
        'previous_is_primary', v_old_is_primary
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. DOMAIN RPC AUDIT UPDATES (STUDENT STATUS & TEACHER REMOVAL)
-- ═══════════════════════════════════════════════════════════════════════════

-- 4.1 fn_set_student_status: audits 'student archived', 'student withdrawn'
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
    v_audit_action TEXT;
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
            'target_student_identity', _student_id,
            'student_name', v_student_name,
            'previous_state', jsonb_build_object('status', coalesce(v_old_status, 'active')),
            'new_state', jsonb_build_object('status', _new_status, 'is_active', v_is_active),
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
        'new_status', _new_status,
        'is_active', v_is_active
    );
END;
$$;


-- 4.2 fn_remove_teacher_access: audits 'teacher removed'
CREATE OR REPLACE FUNCTION public.fn_remove_teacher_access(
    _school_id UUID,
    _target_profile_id UUID,
    _actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_name TEXT;
    v_actor_role TEXT;
    v_target_profile RECORD;
    v_existing_emp RECORD;
    v_other_role TEXT;
    v_new_role TEXT;
    v_primary_role_changed BOOLEAN := FALSE;
    v_unassigned_classes_count INT := 0;
    v_unassigned_subjects_count INT := 0;
    v_classes_cur CURSOR FOR SELECT id, name FROM public.classes WHERE teacher_id = _target_profile_id;
    v_class_rec RECORD;
BEGIN
    IF _actor_profile_id IS NULL THEN
        _actor_profile_id := auth.uid();
    END IF;

    IF _actor_profile_id IS NOT NULL THEN
        SELECT full_name, role INTO v_actor_name, v_actor_role
        FROM public.profiles
        WHERE id = _actor_profile_id;
    ELSE
        v_actor_name := 'System Service';
        v_actor_role := 'superadmin';
    END IF;

    SELECT * INTO v_target_profile
    FROM public.profiles
    WHERE id = _target_profile_id;

    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Target user profile not found for id: %', _target_profile_id;
    END IF;

    SELECT * INTO v_existing_emp
    FROM public.employees
    WHERE profile_id = _target_profile_id
      AND (school_id = _school_id OR _school_id IS NULL)
      AND deleted_at IS NULL
    LIMIT 1;

    -- Deactivate employee record
    IF v_existing_emp.id IS NOT NULL THEN
        UPDATE public.employees
        SET status = 'inactive',
            updated_at = now()
        WHERE id = v_existing_emp.id;
    END IF;

    -- Unassign from classes
    FOR v_class_rec IN v_classes_cur LOOP
        UPDATE public.classes
        SET teacher_id = NULL,
            updated_at = now()
        WHERE id = v_class_rec.id;
        v_unassigned_classes_count := v_unassigned_classes_count + 1;
    END LOOP;

    -- Delete subject teacher links
    WITH deleted_subjects AS (
        DELETE FROM public.subject_teachers
        WHERE teacher_id = _target_profile_id
        RETURNING id
    )
    SELECT count(*) INTO v_unassigned_subjects_count FROM deleted_subjects;

    -- Revoke teacher role from user_roles
    DELETE FROM public.user_roles
    WHERE user_id = _target_profile_id
      AND role = 'teacher';

    -- Handle primary role transition
    IF v_target_profile.role = 'teacher' THEN
        IF EXISTS (
            SELECT 1 FROM public.parent_student
            WHERE parent_id = _target_profile_id
              AND status = 'active'
              AND (school_id = _school_id OR _school_id IS NULL)
        ) THEN
            v_new_role := 'parent';
            UPDATE public.profiles
            SET role = 'parent', updated_at = now()
            WHERE id = _target_profile_id;
            v_primary_role_changed := TRUE;
        ELSE
            SELECT role INTO v_other_role
            FROM public.user_roles
            WHERE user_id = _target_profile_id
              AND role <> 'teacher'
            ORDER BY (
                CASE role
                    WHEN 'superadmin' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'principal' THEN 3
                    WHEN 'accountant' THEN 4
                    WHEN 'receptionist' THEN 5
                    WHEN 'student' THEN 6
                    ELSE 7
                END
            ) ASC
            LIMIT 1;

            IF v_other_role IS NOT NULL THEN
                v_new_role := v_other_role;
                UPDATE public.profiles
                SET role = v_other_role, updated_at = now()
                WHERE id = _target_profile_id;
                v_primary_role_changed := TRUE;
            ELSE
                RAISE EXCEPTION 'CANNOT_DISABLE_NO_OTHER_PERSONA: Cannot disable Teacher access on an account with no other active persona. Reassign role or deactivate account.';
            END IF;
        END IF;
    END IF;

    -- Canonical Audit log: teacher removed
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
        COALESCE(v_actor_role, 'admin'),
        _target_profile_id,
        'teacher removed',
        jsonb_build_object(
            'actor_id', _actor_profile_id,
            'actor_name', v_actor_name,
            'actor_role', v_actor_role,
            'target_user_id', _target_profile_id,
            'target_user_name', v_target_profile.full_name,
            'target_staff_identity', v_existing_emp.id,
            'school_id', _school_id,
            'previous_state', jsonb_build_object(
                'had_teacher', true,
                'employee_status', 'active'
            ),
            'new_state', jsonb_build_object(
                'had_teacher', false,
                'employee_status', 'inactive',
                'new_primary_role', v_new_role
            ),
            'unassigned_classes_count', v_unassigned_classes_count,
            'unassigned_subjects_count', v_unassigned_subjects_count,
            'legacy_action', 'teacher_access_disabled'
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'target_profile_id', _target_profile_id,
        'new_primary_role', v_new_role,
        'primary_role_changed', v_primary_role_changed,
        'unassigned_classes_count', v_unassigned_classes_count,
        'unassigned_subjects_count', v_unassigned_subjects_count
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. STUDENT DELETION AUDIT HELPER & SECURE AUDIT QUERY RPC
-- ═══════════════════════════════════════════════════════════════════════════

-- 5.1 fn_audit_student_deletion_attempt
CREATE OR REPLACE FUNCTION public.fn_audit_student_deletion_attempt(
    _school_id UUID,
    _student_id UUID,
    _blocked BOOLEAN,
    _reasons TEXT[] DEFAULT NULL,
    _notes TEXT DEFAULT NULL
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
    v_student_name TEXT;
    v_action TEXT;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot audit student deletion for another school';
        END IF;
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    SELECT full_name INTO v_student_name
    FROM public.profiles
    WHERE id = _student_id;

    v_action := CASE 
        WHEN _blocked THEN 'student deletion attempted' 
        ELSE 'student deleted if exceptionally allowed' 
    END;

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
        v_action,
        jsonb_build_object(
            'target_student_identity', _student_id,
            'student_name', v_student_name,
            'blocked', _blocked,
            'reasons', _reasons,
            'notes', _notes
        ),
        now()
    );

    RETURN jsonb_build_object('success', true, 'action', v_action);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_student_deletion_attempt(UUID, UUID, BOOLEAN, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_student_deletion_attempt(UUID, UUID, BOOLEAN, TEXT[], TEXT) TO authenticated;


-- 5.2 fn_get_admin_action_audit
CREATE OR REPLACE FUNCTION public.fn_get_admin_action_audit(
    _school_id UUID DEFAULT NULL,
    _target_user_id UUID DEFAULT NULL,
    _action TEXT DEFAULT NULL,
    _limit INT DEFAULT 50,
    _offset INT DEFAULT 0
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
    v_result JSONB;
BEGIN
    v_caller_role := public.get_auth_role();
    v_caller_school := public.get_auth_school_id();

    IF v_caller_role = 'superadmin' THEN
        v_effective_school := _school_id;
    ELSIF v_caller_role = 'admin' THEN
        v_effective_school := v_caller_school;
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    SELECT jsonb_agg(row_to_json(a))
    INTO v_result
    FROM (
        SELECT 
            audit.id,
            audit.school_id,
            audit.actor_id,
            audit.actor_role,
            actor.full_name AS actor_name,
            actor.email AS actor_email,
            audit.target_user_id,
            target.full_name AS target_name,
            target.email AS target_email,
            audit.action,
            audit.detail,
            audit.ip_address,
            audit.created_at
        FROM public.admin_action_audit audit
        LEFT JOIN public.profiles actor ON actor.id = audit.actor_id
        LEFT JOIN public.profiles target ON target.id = audit.target_user_id
        WHERE (v_effective_school IS NULL OR audit.school_id = v_effective_school)
          AND (_target_user_id IS NULL OR audit.target_user_id = _target_user_id)
          AND (_action IS NULL OR audit.action ILIKE '%' || _action || '%')
        ORDER BY audit.created_at DESC
        LIMIT _limit
        OFFSET _offset
    ) a;

    RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_admin_action_audit(UUID, UUID, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_admin_action_audit(UUID, UUID, TEXT, INT, INT) TO authenticated;
