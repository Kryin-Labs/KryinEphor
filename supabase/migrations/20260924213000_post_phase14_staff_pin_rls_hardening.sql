-- ════════════════════════════════════════════════════════════════════
-- Post-Phase-14 Duplicate Detection, Staff PIN Server Boundary & RLS Hardening
-- Migration: 20260924213000_post_phase14_staff_pin_rls_hardening.sql
-- 
-- 1. Phase 14 Hardening:
--    - fn_detect_duplicate_identities: validates _role, preserves cross-role
--      matching, returns rich candidate capability info and contextual ranking.
--    - fn_audit_duplicate_decision: server-authoritative candidate verification;
--      validates target school boundary; derives canonical name/email/roles;
--      client notes isolated in client_context.
--
-- 2. Phase 15–17 Staff PIN Server Boundary:
--    - fn_has_valid_staff_unlock: central STABLE security helper verifying
--      Teacher capability, active employee record, valid auth session claim,
--      and active unexpired unlock session. Fails closed.
--    - fn_validate_staff_session: hardened fail-closed auth-session binding;
--      revokes sessions on employee inactivation or role loss.
--    - fn_verify_staff_pin: requires auth_session_id claim; enforces 2-hour
--      lifetime; supersedes old sessions; audits without secrets.
--
-- 3. Phase 16 RLS Read/Write Scope Hardening:
--    - fn_is_assigned_teacher_for_homework: assignment helper.
--    - attendance, exam_results, homework, homework_submissions, class_enrollments:
--      Teacher access strictly requires valid Staff unlock AND assignment scope.
--    - Admins/superadmins and students/guardians retain canonical access.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1. HARDEN fn_detect_duplicate_identities
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_detect_duplicate_identities(
    _school_id UUID,
    _name TEXT DEFAULT NULL,
    _email TEXT DEFAULT NULL,
    _phone TEXT DEFAULT NULL,
    _admission_number TEXT DEFAULT NULL,
    _employee_number TEXT DEFAULT NULL,
    _role TEXT DEFAULT NULL
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
    v_clean_name TEXT;
    v_clean_email TEXT;
    v_clean_phone TEXT;
    v_clean_adm TEXT;
    v_clean_emp TEXT;
    v_target_role TEXT;
    v_results JSONB;
    v_valid_roles TEXT[] := ARRAY['admin', 'teacher', 'student', 'parent', 'accountant', 'receptionist'];
BEGIN
    v_caller_school := public.get_auth_school_id();

    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'School context is required for duplicate detection';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot check duplicates for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    -- Validate target role argument if provided
    IF _role IS NOT NULL AND btrim(_role) <> '' THEN
        v_target_role := lower(btrim(_role));
        IF NOT (v_target_role = ANY(v_valid_roles)) THEN
            RAISE EXCEPTION 'Invalid target role for duplicate detection: %. Must be one of %', _role, v_valid_roles;
        END IF;
    END IF;

    v_clean_name := NULLIF(btrim(_name), '');
    v_clean_email := NULLIF(lower(btrim(_email)), '');
    v_clean_phone := NULLIF(btrim(_phone), '');
    v_clean_adm := NULLIF(lower(btrim(_admission_number)), '');
    v_clean_emp := NULLIF(lower(btrim(_employee_number)), '');

    -- If no search terms provided, return empty
    IF v_clean_name IS NULL AND v_clean_email IS NULL AND v_clean_phone IS NULL AND v_clean_adm IS NULL AND v_clean_emp IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    WITH candidate_matches AS (
        SELECT 
            p.id,
            p.full_name,
            p.email,
            p.role AS primary_role,
            COALESCE(
                (SELECT array_agg(ur.role ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id = p.id),
                ARRAY[p.role]
            ) AS current_roles,
            p.phone,
            p.login_id,
            p.is_active,
            p.student_status,
            e.id AS employee_id,
            e.employee_code,
            e.designation,
            e.department,
            (e.id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL) AS has_active_employee,
            cls.class_name,
            cls.section_name,
            ARRAY_REMOVE(ARRAY[
                CASE WHEN v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email) THEN 'Exact email match: ' || p.email ELSE NULL END,
                CASE WHEN v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone) THEN 'Exact phone match: ' || p.phone ELSE NULL END,
                CASE WHEN v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm THEN 'Exact admission number / Login ID match: ' || p.login_id ELSE NULL END,
                CASE WHEN v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp THEN 'Exact employee code match: ' || e.employee_code ELSE NULL END,
                CASE WHEN v_clean_name IS NOT NULL AND length(v_clean_name) >= 3 AND lower(btrim(p.full_name)) = lower(v_clean_name) THEN 'Probable match: identical full name in school' ELSE NULL END,
                CASE 
                    WHEN v_target_role IS NOT NULL AND v_target_role = ANY(
                        COALESCE((SELECT array_agg(ur.role) FROM public.user_roles ur WHERE ur.user_id = p.id), ARRAY[p.role])
                    ) THEN 'Role conflict: candidate already has ' || v_target_role || ' capability'
                    WHEN v_target_role IS NOT NULL THEN 'Cross-role match: existing ' || p.role || ' account can be linked to ' || v_target_role
                    ELSE NULL
                END
            ], NULL) AS match_reasons,
            CASE 
                WHEN (v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email))
                  OR (v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone))
                  OR (v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm)
                  OR (v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp)
                THEN 'exact'
                ELSE 'probable'
            END AS match_strength,
            CASE
                WHEN v_target_role IS NOT NULL AND v_target_role = ANY(
                    COALESCE((SELECT array_agg(ur.role) FROM public.user_roles ur WHERE ur.user_id = p.id), ARRAY[p.role])
                ) THEN 1
                ELSE 2
            END AS role_priority
        FROM public.profiles p
        LEFT JOIN public.employees e ON e.profile_id = p.id AND e.school_id = v_effective_school AND e.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT c.name AS class_name, c.section AS section_name
            FROM public.class_enrollments ce
            JOIN public.classes c ON c.id = ce.class_id AND c.deleted_at IS NULL
            WHERE ce.student_id = p.id AND ce.school_id = v_effective_school AND ce.deleted_at IS NULL
            ORDER BY ce.enrolled_at DESC
            LIMIT 1
        ) cls ON true
        WHERE p.school_id = v_effective_school
          AND p.deleted_at IS NULL
          AND (
               (v_clean_email IS NOT NULL AND (lower(p.email) = v_clean_email OR lower(COALESCE(p.recovery_email, '')) = v_clean_email))
            OR (v_clean_phone IS NOT NULL AND (btrim(COALESCE(p.phone, '')) = v_clean_phone OR btrim(COALESCE(p.emergency_contact, '')) = v_clean_phone))
            OR (v_clean_adm IS NOT NULL AND lower(COALESCE(p.login_id, '')) = v_clean_adm)
            OR (v_clean_emp IS NOT NULL AND lower(COALESCE(e.employee_code, '')) = v_clean_emp)
            OR (v_clean_name IS NOT NULL AND length(v_clean_name) >= 3 AND lower(btrim(p.full_name)) = lower(v_clean_name))
          )
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', cm.id,
        'full_name', cm.full_name,
        'email', cm.email,
        'primary_role', cm.primary_role,
        'current_roles', cm.current_roles,
        'phone', cm.phone,
        'login_id', cm.login_id,
        'employee_code', cm.employee_code,
        'designation', cm.designation,
        'department', cm.department,
        'has_active_employee', cm.has_active_employee,
        'class_name', cm.class_name,
        'section_name', cm.section_name,
        'is_active', cm.is_active,
        'student_status', cm.student_status,
        'match_strength', cm.match_strength,
        'match_reasons', cm.match_reasons,
        'target_role_context', v_target_role
    ) ORDER BY 
        CASE WHEN cm.match_strength = 'exact' THEN 0 ELSE 1 END,
        cm.role_priority ASC,
        cm.full_name ASC
    ), '[]'::jsonb)
    INTO v_results
    FROM candidate_matches cm;

    RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_duplicate_identities(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_detect_duplicate_identities(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 2. HARDEN fn_audit_duplicate_decision (SERVER-AUTHORITATIVE VERIFICATION)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_audit_duplicate_decision(
    _school_id UUID,
    _resolution TEXT,
    _candidate_id UUID DEFAULT NULL,
    _candidate_name TEXT DEFAULT NULL,
    _input_name TEXT DEFAULT NULL,
    _input_email TEXT DEFAULT NULL,
    _match_reasons JSONB DEFAULT '[]'::jsonb,
    _detail_notes TEXT DEFAULT NULL
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
    v_candidate RECORD;
    v_canonical_roles TEXT[];
BEGIN
    v_caller_school := public.get_auth_school_id();

    IF public.has_role(auth.uid(), 'superadmin') THEN
        IF _school_id IS NULL THEN
            RAISE EXCEPTION 'School context is required for duplicate audit';
        END IF;
        v_effective_school := _school_id;
        v_caller_role := 'superadmin';
    ELSIF public.has_role(auth.uid(), 'admin') THEN
        IF v_caller_school IS NULL OR (_school_id IS NOT NULL AND _school_id <> v_caller_school) THEN
            RAISE EXCEPTION 'Access denied: cannot audit duplicate decision for another school';
        END IF;
        v_effective_school := v_caller_school;
        v_caller_role := 'admin';
    ELSE
        RAISE EXCEPTION 'Access denied: administrator privileges required';
    END IF;

    IF _resolution NOT IN ('link_existing', 'create_new_person', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid resolution: %. Must be link_existing, create_new_person, or cancelled', _resolution;
    END IF;

    -- Canonical Server Verification of Candidate:
    -- If candidate_id is supplied, load candidate from DB and verify tenant boundary.
    -- Do NOT trust client-supplied candidate_name or match details as canonical truth.
    IF _candidate_id IS NOT NULL THEN
        SELECT id, full_name, email, role, school_id, is_active
        INTO v_candidate
        FROM public.profiles
        WHERE id = _candidate_id AND deleted_at IS NULL;

        IF v_candidate.id IS NULL THEN
            RAISE EXCEPTION 'Candidate profile % not found', _candidate_id;
        END IF;

        IF v_candidate.school_id <> v_effective_school THEN
            RAISE EXCEPTION 'Access denied: candidate belongs to another school';
        END IF;

        SELECT array_agg(ur.role ORDER BY ur.role)
        INTO v_canonical_roles
        FROM public.user_roles ur
        WHERE ur.user_id = _candidate_id;
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
        auth.uid(),
        v_caller_role,
        v_effective_school,
        COALESCE(_candidate_id, auth.uid()),
        'duplicate_detection_resolution',
        jsonb_build_object(
            'resolution', _resolution,
            'candidate_id', _candidate_id,
            'canonical_candidate', CASE WHEN v_candidate.id IS NOT NULL THEN jsonb_build_object(
                'id', v_candidate.id,
                'name', v_candidate.full_name,
                'email', v_candidate.email,
                'primary_role', v_candidate.role,
                'roles', COALESCE(v_canonical_roles, ARRAY[v_candidate.role]),
                'is_active', v_candidate.is_active
            ) ELSE NULL END,
            'input_name', _input_name,
            'input_email', _input_email,
            'client_context', jsonb_build_object(
                'client_provided_candidate_name', _candidate_name,
                'client_match_reasons', _match_reasons,
                'notes', _detail_notes
            )
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true, 
        'resolution', _resolution,
        'candidate_id', _candidate_id,
        'verified_canonical_name', v_candidate.full_name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_duplicate_decision(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_duplicate_decision(UUID, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 3. CENTRAL STAFF UNLOCK AUTHORIZATION HELPER
-- ────────────────────────────────────────────────────────────────────
-- Performance index for auth-session-bound staff unlock lookups
CREATE INDEX IF NOT EXISTS idx_staff_unlock_sessions_auth_lookup
ON public.staff_unlock_sessions(user_id, school_id, auth_session_id)
WHERE is_revoked IS FALSE;

CREATE OR REPLACE FUNCTION public.fn_has_valid_staff_unlock(_school_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_uid UUID;
    v_effective_school UUID;
    v_jwt_session_id UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Superadmin platform bypass
    IF public.has_role(v_uid, 'superadmin') THEN
        RETURN TRUE;
    END IF;

    v_effective_school := COALESCE(_school_id, public.get_auth_school_id());
    IF v_effective_school IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Verify current user has Teacher capability (primary role or user_roles)
    IF NOT (
        public.has_role(v_uid, 'teacher')
        OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'teacher')
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.role = 'teacher')
    ) THEN
        RETURN FALSE;
    END IF;

    -- Active employee record in requested school
    IF NOT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.profile_id = v_uid
          AND e.school_id = v_effective_school
          AND e.status = 'active'
          AND e.deleted_at IS NULL
    ) THEN
        RETURN FALSE;
    END IF;

    -- Extract current Supabase auth session ID from JWT claims
    BEGIN
        v_jwt_session_id := COALESCE(
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
            (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Fail closed on parsing failure
    END;

    -- FAIL CLOSED: Cannot determine current auth session -> FALSE
    IF v_jwt_session_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check staff_unlock_sessions for active, unexpired session bound to this auth session
    RETURN EXISTS (
        SELECT 1 FROM public.staff_unlock_sessions s
        WHERE s.user_id = v_uid
          AND s.school_id = v_effective_school
          AND s.auth_session_id = v_jwt_session_id
          AND s.is_revoked IS FALSE
          AND s.expires_at > now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_has_valid_staff_unlock(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_has_valid_staff_unlock(UUID) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────
-- 4. HARDEN fn_validate_staff_session (FAIL-CLOSED AUTH SESSION BINDING)
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

    -- Verify active staff employment in employees (unless superadmin)
    IF NOT public.has_role(v_caller_id, 'superadmin') THEN
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

        -- Verify user still has teacher/staff capability
        IF NOT (
            public.has_role(v_caller_id, 'teacher')
            OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_caller_id AND ur.role = 'teacher')
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'teacher')
        ) THEN
            UPDATE public.staff_unlock_sessions
            SET is_revoked = TRUE,
                revoked_reason = 'ROLE_REVOKED',
                revoked_at = now()
            WHERE id = v_session.id;

            RETURN jsonb_build_object('is_valid', false, 'reason', 'ROLE_REVOKED');
        END IF;
    END IF;

    -- Fail-closed Auth session binding verification:
    -- If the unlock session recorded an auth_session_id, current auth session MUST match.
    IF v_session.auth_session_id IS NOT NULL THEN
        BEGIN
            v_jwt_session_id := COALESCE(
                (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
                (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
            );
        EXCEPTION WHEN OTHERS THEN
            v_jwt_session_id := NULL;
        END;

        IF v_jwt_session_id IS NULL OR v_jwt_session_id <> v_session.auth_session_id THEN
            RETURN jsonb_build_object('is_valid', false, 'reason', 'SESSION_MISMATCH');
        END IF;
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

REVOKE ALL ON FUNCTION public.fn_validate_staff_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_staff_session(TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 5. HARDEN fn_verify_staff_pin (FAIL-CLOSED AUTH SESSION BINDING & 2H EXPIRATION)
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

    -- 1. Check if user has teacher, admin, or superadmin capability
    v_has_staff_role := (
        public.has_role(v_caller_id, 'teacher')
        OR public.has_role(v_caller_id, 'admin')
        OR public.has_role(v_caller_id, 'superadmin')
        OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_caller_id AND ur.role = 'teacher')
    );

    IF NOT v_has_staff_role THEN
        RETURN jsonb_build_object('success', false, 'error', 'User does not possess teacher or staff privileges.');
    END IF;

    -- 2. Verify active staff employment in this school (unless superadmin)
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

            -- Audit log lockout (never log raw PIN or hash)
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

    -- 7. Extract current Supabase auth session ID from JWT claims
    BEGIN
        v_auth_session_id := COALESCE(
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid,
            (nullif(current_setting('request.jwt.claim.session_id', true), ''))::uuid
        );
    EXCEPTION WHEN OTHERS THEN
        v_auth_session_id := NULL;
    END;

    -- FAIL CLOSED: An active auth session is strictly required to bind staff unlock
    IF v_auth_session_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'AUTH_SESSION_REQUIRED',
            'message', 'Cannot determine current auth session. Please re-authenticate.'
        );
    END IF;

    -- Supersede any existing active unlock sessions for this user in this school
    UPDATE public.staff_unlock_sessions
    SET is_revoked = TRUE,
        revoked_reason = 'SUPERSEDED_BY_NEW_UNLOCK',
        revoked_at = now()
    WHERE user_id = v_caller_id
      AND school_id = _school_id
      AND is_revoked IS FALSE;

    -- Generate cryptographically random session token (32 bytes hex)
    -- Authoritative lifetime is 2 hours
    v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires_at := now() + INTERVAL '2 hours';

    -- 8. Insert active session (Auth-session-bound Staff unlock)
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

    -- 9. Audit log unlock (non-secret metadata only)
    INSERT INTO public.admin_action_audit (
        actor_id, school_id, target_user_id, action, detail, created_at
    ) VALUES (
        v_caller_id, _school_id, v_caller_id,
        'STAFF_PIN_UNLOCKED',
        jsonb_build_object(
            'expires_at', v_expires_at,
            'staff_identity_id', v_staff_emp.id,
            'auth_session_id', v_auth_session_id,
            'has_device_info', (_device_info IS NOT NULL)
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

REVOKE ALL ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_verify_staff_pin(UUID, TEXT, TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 6. HOMEWORK ASSIGNMENT HELPER FUNCTION
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_assigned_teacher_for_homework(_homework_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework h
    WHERE h.id = _homework_id
      AND h.school_id = public.get_auth_school_id()
      AND (
        h.teacher_id = auth.uid()
        OR public.fn_is_assigned_teacher_for_class(h.class_id)
        OR EXISTS (
          SELECT 1 FROM public.subject_teachers st
          WHERE st.class_id = h.class_id
            AND st.subject_id = h.subject_id
            AND st.teacher_id = auth.uid()
            AND st.school_id = public.get_auth_school_id()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_assigned_teacher_for_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_assigned_teacher_for_homework(UUID) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────
-- 7. PHASE 16 RLS HARDENING: TEACHER READ & WRITE SCOPE + PIN BOUNDARY
-- ────────────────────────────────────────────────────────────────────

-- Table A: ATTENDANCE
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
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );

DROP POLICY IF EXISTS "attendance_insert_policy" ON public.attendance;
CREATE POLICY "attendance_insert_policy"
  ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
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
  );

DROP POLICY IF EXISTS "attendance_update_policy" ON public.attendance;
CREATE POLICY "attendance_update_policy"
  ON public.attendance FOR UPDATE TO authenticated
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
  )
  WITH CHECK (
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
  );


-- Table B: EXAM_RESULTS
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
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );

DROP POLICY IF EXISTS "exam_results_insert_policy" ON public.exam_results;
CREATE POLICY "exam_results_insert_policy"
  ON public.exam_results FOR INSERT TO authenticated
  WITH CHECK (
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
  );

DROP POLICY IF EXISTS "exam_results_update_policy" ON public.exam_results;
CREATE POLICY "exam_results_update_policy"
  ON public.exam_results FOR UPDATE TO authenticated
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
  )
  WITH CHECK (
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
  );


-- Table C: HOMEWORK
DROP POLICY IF EXISTS "homework_insert_policy" ON public.homework;
CREATE POLICY "homework_insert_policy"
  ON public.homework FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "homework_update_policy" ON public.homework;
CREATE POLICY "homework_update_policy"
  ON public.homework FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS "homework_delete_policy" ON public.homework;
CREATE POLICY "homework_delete_policy"
  ON public.homework FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_class(class_id)
        )
      )
    )
  );


-- Table D: HOMEWORK_SUBMISSIONS
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
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );

DROP POLICY IF EXISTS "tenant_update" ON public.homework_submissions;
DROP POLICY IF EXISTS "homework_submissions_update" ON public.homework_submissions;
CREATE POLICY "homework_submissions_update"
  ON public.homework_submissions FOR UPDATE TO authenticated
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
        OR (
          student_id = auth.uid()
          AND public.has_role(auth.uid(), 'student')
        )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND public.fn_is_assigned_teacher_for_homework(homework_id)
        )
        OR (
          student_id = auth.uid()
          AND public.has_role(auth.uid(), 'student')
        )
      )
    )
  );


-- Table E: CLASS_ENROLLMENTS (Student Rosters)
DROP POLICY IF EXISTS "tenant_select" ON public.class_enrollments;
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
    OR student_id = auth.uid()
    OR public.fn_can_access_student(student_id)
  );


-- Table F: CLASSES (Teacher Room / Detail Updates)
DROP POLICY IF EXISTS "classes_update" ON public.classes;
CREATE POLICY "classes_update"
  ON public.classes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND teacher_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin')
    OR (
      school_id = public.get_auth_school_id()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR (
          public.fn_has_valid_staff_unlock(school_id)
          AND teacher_id = auth.uid()
        )
      )
    )
  );
